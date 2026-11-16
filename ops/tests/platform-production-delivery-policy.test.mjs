import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateProof, verifyCandidateProof, verifyProductionApproval, verifyPreparedRelease,verifyImagePreparationApproval,verifyImagePreparationEvidence,CI_PATH } from '../platform-production/policy.mjs';
import {createCIProof,REQUIRED_CI_JOBS} from '../ci-release-identity.mjs';

const sha = c => c.repeat(40), hash = c => c.repeat(64);
const report = role => ({schemaVersion:1, role, controlSha:sha('a'), runId:'11', manifestSha256:hash('b'),
  sourceSha:sha(role==='backend'?'c':role==='satin'?'d':'e'), treeSha:sha('f'), passed:true,
  runtime:{node:'22.23.1',platform:'linux',arch:'x64'}, archiveSha256:hash('1'),
  ...(role==='backend'?{unitTests:182,databaseTests:13,postgresVersion:'16.15',migrationChain:{baseline:42,patched:43,future:48,preserved:true,canonical:true},audit:{high:0,critical:0}}:{tests:role==='satin'?129:118,audit:{high:0,critical:0},platformApi:'https://platform.fleetum.it/platform-api'})});
const sources=()=>Object.fromEntries(['backend','satin','fallback'].map(role=>[role,{sourceSha:report(role).sourceSha,treeSha:sha('f'),archiveName:role+'.source.tar.gz',archiveSha256:hash('1')}]))
function fixture(){
 const backend=report('backend'),satin=report('satin'),fallback=report('fallback');
 const source={schemaVersion:1,kind:'platform-production-source-export',controlSha:sha('a'),runId:'11',manifestSha256:hash('b'),sources:sources()};
 const image={...report('backend'),role:'image',imageId:'sha256:'+hash('2'),platform:'linux/amd64',runtimeUser:{uid:1000,gid:1000},dockerfileSha256:hash('3'),archiveSha256:hash('4'),smokePassed:true,scanner:{image:'aquasec/trivy@sha256:'+hash('6'),high:0,critical:0}};
 const needs=Object.fromEntries(['sources','backend','frontend','image','security'].map(k=>[k,{result:'success'}]));
 const security={schemaVersion:1,role:'security',controlSha:sha('a'),runId:'11',manifestSha256:hash('b'),passed:true,sources:Object.fromEntries(['backend','satin','fallback'].map(r=>[r,report(r).sourceSha])),tools:{gitleaks:'ghcr.io/gitleaks/gitleaks@sha256:'+hash('4'),semgrep:'semgrep/semgrep@sha256:'+hash('5')}};
 return {source,reports:{backend,satin,fallback,image,security},needs,context:{repository:'Silviomasuccio6/Fleetum',controlSha:sha('a'),runId:'11',event:'push',branch:'main'}};
}
test('candidate CI proof binds three sources, the independent jobs and actual AMD64 image',()=>{
 const f=fixture();const p=candidateProof(f);assert.equal(p.kind,'platform-production-candidate-ci');assert.equal(verifyCandidateProof(p,f.context),true);assert.equal(p.readyForDeployment,false);
});
test('ordinary CI proof is not accepted as application candidate proof',()=>{
 assert.throws(()=>verifyCandidateProof({schemaVersion:1,kind:'ci-source-proof'},fixture().context));
});
test('missing matrix report, skipped security, wrong run and mixed source are rejected',()=>{
 for(const change of [f=>delete f.reports.fallback,f=>f.needs.security.result='skipped',f=>f.reports.backend.runId='12',f=>f.reports.satin.sourceSha=sha('0'),f=>f.reports.image.treeSha=sha('0')]){
  const f=fixture();change(f);assert.throws(()=>candidateProof(f));
 }
});
test('failed tests, incomplete database trial and an ARM-only image cannot pass',()=>{
 for(const change of [f=>f.reports.backend.unitTests=0,f=>f.reports.backend.migrationChain.preserved=false,f=>f.reports.image.platform='linux/arm64',f=>f.reports.image.smokePassed=false,f=>f.reports.fallback.platformApi='/platform-api',f=>f.reports.backend.audit.critical=1]){
  const f=fixture();change(f);assert.throws(()=>candidateProof(f));
 }
});
function approval(){return {schemaVersion:1,kind:'platform-production-approval',repository:'Silviomasuccio6/Fleetum',controlSha:sha('a'),manifestSha256:hash('b'),candidateCiRunId:'11',controlCiRunId:'12',
 parentBackend:'ghcr.io/silviomasuccio6/fleetum-backend@sha256:'+hash('5'),parentFrontend:'ghcr.io/silviomasuccio6/fleetum-frontend@sha256:'+hash('6'),
 parentStaticSha256:hash('7'),parentWebsiteSha256:hash('8'),profileSha256:hash('9'),preflightSha256:hash('a'),backupSha256:hash('c'),approvedUntil:'2030-01-15T13:00:00.000Z'};}
const context=()=>({repository:'Silviomasuccio6/Fleetum',controlSha:sha('a'),mainSha:sha('a'),workflowSha:sha('a'),event:'workflow_dispatch',ref:'refs/heads/main',runId:'22',attempt:'1',confirm:'RELEASE_PLATFORM_PRODUCTION',now:Date.parse('2030-01-15T12:00:00Z')});
test('production approval binds current main controls, parent images, backup and live preflight',()=>{assert.equal(verifyProductionApproval(approval(),context()),true);});
test('staging, reruns, mutable image tags, missing backup and expired approvals stop before effects',()=>{
 for(const change of [x=>x.a.parentBackend='ghcr.io/silviomasuccio6/fleetum-backend:latest',x=>delete x.a.backupSha256,x=>x.a.kind='platform-overlay',x=>x.c.ref='refs/heads/develop',x=>x.c.attempt='2',x=>x.c.workflowSha=sha('0'),x=>x.c.now+=7*3600000]){
  const x={a:approval(),c:context()};change(x);assert.throws(()=>verifyProductionApproval(x.a,x.c));
 }
});
test('release preparation cannot substitute a candidate proof from a PR or another control revision',()=>{
 const f=fixture(),p=candidateProof(f),a=approval();
 assert.throws(()=>verifyPreparedRelease({approval:a,candidate:p,context:context(),run:{id:11,event:'pull_request',head_branch:'topic',head_sha:sha('a')}}));
});
function evidence(){
 const f=fixture(),p=candidateProof(f),a=approval(),c=context();
 const repo={full_name:c.repository};
 const run={id:11,status:'completed',conclusion:'success',event:'push',head_branch:'main',head_sha:c.controlSha,path:CI_PATH,repository:repo,head_repository:repo};
 const controlRun={...run,id:12,path:'.github/workflows/ci.yml'};
 const control=createCIProof({repository:c.repository,runId:'12',sourceSha:c.controlSha,checkoutSha:c.controlSha,event:'push',jobResults:Object.fromEntries(REQUIRED_CI_JOBS.map(k=>[k,{result:'success'}]))});
 return {approval:a,candidate:p,context:c,run,control,controlRun,manifestSha256:a.manifestSha256,descriptor:{sources:f.source.sources}};
}
test('matching independent candidate/main proofs can validate a reviewed release tuple',()=>{
 assert.equal(verifyPreparedRelease(evidence()),true);
});
test('image preparation uses a distinct approval and never inherits installation authority',()=>{
 const f=evidence();
 for(const key of ['parentStaticSha256','parentWebsiteSha256','preflightSha256','backupSha256'])delete f.approval[key];
 f.approval.kind='platform-production-image-approval';f.context.confirm='PREPARE_PLATFORM_PRODUCTION';
 assert.equal(verifyImagePreparationApproval(f.approval,f.context),true);
 assert.equal(verifyImagePreparationEvidence(f),true);
 assert.throws(()=>verifyProductionApproval(f.approval,f.context));
 f.controlRun.event='pull_request';assert.throws(()=>verifyImagePreparationEvidence(f));
});
