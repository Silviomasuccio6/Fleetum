import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync,mkdtempSync,rmSync,statSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {createRequire} from 'node:module';
import {executeCompletion,readCompletion,revalidateCompletion,verifySourceEvidence,LOADER} from '../platform-production/frontend-completion.mjs';
import {profileHash} from '../platform-production/prepare.mjs';
import {candidateProof} from '../platform-production/policy.mjs';
import {createCIProof,REQUIRED_CI_JOBS} from '../ci-release-identity.mjs';
const yaml=createRequire(import.meta.url)('js-yaml');
const text=readFileSync(new URL('../../.github/workflows/complete-platform-production-frontend.yml',import.meta.url),'utf8'),w=yaml.load(text);
const now=Date.parse('2030-01-15T12:00:00Z'),sha=c=>c.repeat(40);
function fixture(){
 const original={runId:'12',approval:{controlSha:sha('a')},prepared:{controlSha:sha('a'),prepareRunId:'11'}};
 const state={kind:'synthetic-current-state'};
 const a={schemaVersion:1,kind:'platform-production-frontend-completion-approval',repository:'Silviomasuccio6/Fleetum',controlSha:sha('b'),applicationControlSha:sha('a'),prepareRunId:'11',failedInstallRunId:'12',approvedUntil:'2030-01-15T13:00:00Z',originalRequestSha256:profileHash(original),currentStateSha256:profileHash(state),allowVisualFallback:true,completionCiRunId:'21',completionCandidateCiRunId:'22',preparedArtifactSha256:'c'.repeat(64)};
 const env={GITHUB_REPOSITORY:a.repository,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'30',GITHUB_WORKFLOW_SHA:sha('b'),COMPLETE_CONFIRM:'COMPLETE_PLATFORM_FRONTEND',FLEETUM_PLATFORM_FRONTEND_TRUSTED_CONTROL_SHA:sha('b'),
  FLEETUM_PLATFORM_FRONTEND_COMPLETION_JSON:JSON.stringify(a),FLEETUM_PLATFORM_FRONTEND_ORIGINAL_REQUEST_JSON:JSON.stringify(original),FLEETUM_PLATFORM_FRONTEND_CURRENT_STATE_JSON:JSON.stringify(state)};
 return {a,original,state,env};
}
test('completion has one protected job, global production lock and no application image build',()=>{
 assert.deepEqual(Object.keys(w.on),['workflow_dispatch']);assert.deepEqual(Object.keys(w.jobs),['complete']);
 assert.equal(w.jobs.complete.environment,'production');assert.equal(w.concurrency.group,'fleetum-production');assert.equal(w.concurrency['cancel-in-progress'],false);
 assert.deepEqual(w.jobs.complete.permissions,{contents:'read',actions:'read'});assert.match(w.jobs.complete.if,/COMPLETE_PLATFORM_FRONTEND/);assert.match(w.jobs.complete.if,/refs\/heads\/main/);
 assert.doesNotMatch(text,/packages:\s*write|npm (ci|run)|login-action|pull_request_target|workflow_run|migrate/);
 const steps=w.jobs.complete.steps,verify=steps.findIndex(s=>s.name?.startsWith('Verify original')),execute=steps.findIndex(s=>s.name?.startsWith('Complete only'));
 assert.ok(verify>=0&&execute>verify);assert.doesNotMatch(JSON.stringify(steps[verify]),/SSH_KEY|KNOWN_HOSTS/);
 assert.equal(steps[0].with.ref,'${{ github.workflow_sha }}');assert.equal(steps[0].with['persist-credentials'],false);
 assert.match(steps[execute].with.script,/revalidateCompletion/);
});
test('completion scripts parse and publish only their safe outcome',()=>{
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 for(const step of w.jobs.complete.steps){
  if(step.with?.script){assert.doesNotThrow(()=>new AsyncFunction('github','context','core',step.with.script));assert.match(step.with.script,/catch\s*\{\s*core\.setFailed/);assert.doesNotMatch(step.with.script,/error\.message|error\.stack/);}
  if(step.uses==='actions/upload-artifact@v4')assert.equal(step.with.path,'${{ runner.temp }}/platform-frontend-completed.json');
 }
 assert.doesNotMatch(text,/vars\.FLEETUM_PLATFORM_FRONTEND_(?:COMPLETION|CURRENT_STATE|ORIGINAL_REQUEST)_JSON/);
 assert.equal(spawnSync('python3',['-B','-c','import ast,sys;ast.parse(sys.stdin.read())'],{input:LOADER,encoding:'utf8'}).status,0);
});
test('original application and new controller identities remain distinct and bound',()=>{
 const f=fixture(),r=readCompletion(f.env,sha('b'),sha('b'),now);
 assert.equal(r.approval.applicationControlSha,sha('a'));assert.equal(r.approval.controlSha,sha('b'));assert.deepEqual(r.originalRequest,f.original);
 assert.throws(()=>readCompletion(f.env,sha('c'),sha('b'),now));
});
test('changed evidence, wrong context, reruns, expiry and transplanted original provenance fail closed',()=>{
 const changes=[f=>f.a.currentStateSha256='0'.repeat(64),f=>f.a.applicationControlSha=sha('c'),f=>f.a.prepareRunId='13',f=>f.a.failedInstallRunId='99',f=>f.a.allowVisualFallback=false,
  f=>f.a.approvedUntil='2030-01-15T11:00:00Z',f=>f.a.approvedUntil='2030-01-15T19:00:00Z',f=>f.env.GITHUB_RUN_ATTEMPT='2',f=>f.env.GITHUB_REF='refs/heads/other',f=>f.env.COMPLETE_CONFIRM='RELEASE_PLATFORM_PRODUCTION',f=>f.env.GITHUB_WORKFLOW_SHA=sha('f')];
 for(const change of changes){const f=fixture();change(f);f.env.FLEETUM_PLATFORM_FRONTEND_COMPLETION_JSON=JSON.stringify(f.a);assert.throws(()=>readCompletion(f.env,sha('b'),sha('b'),now));}
});
test('SSH transfer excludes full installer, pins host trust, forwards no GitHub token and removes its key',t=>{
 const root=mkdtempSync(path.join(tmpdir(),'fleetum-completion-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let keyFile;
 const request={confirm:'COMPLETE_PLATFORM_FRONTEND',runId:'30',approval:{controlSha:sha('b')},prepared:{controlSha:sha('a')}};
 const env={RUNNER_TEMP:root,PATH:process.env.PATH,HOME:process.env.HOME,GH_TOKEN:'synthetic-token-never-forward',
  FLEETUM_PLATFORM_FRONTEND_HOST:'synthetic.example.invalid',FLEETUM_PLATFORM_FRONTEND_USER:'ubuntu',FLEETUM_PLATFORM_FRONTEND_SSH_KEY:'synthetic-only',FLEETUM_PLATFORM_FRONTEND_KNOWN_HOSTS:'synthetic-host-only'};
 executeCompletion(request,env,(command,args,options)=>{
  assert.equal(command,'ssh');assert.ok(args.includes('StrictHostKeyChecking=yes'));keyFile=args[args.indexOf('-i')+1];assert.equal(statSync(keyFile).mode&0o077,0);
  assert.deepEqual(Object.keys(options.env).sort(),['HOME','PATH']);assert.equal(spawnSync('bash',['-n'],{input:args.at(-1),encoding:'utf8'}).status,0);
  const payload=JSON.parse(options.input);assert.deepEqual(Object.keys(payload.files).sort(),['host_frontend.py','host_preflight.py','image_identity.py']);
  assert.ok(!options.input.includes('synthetic-token-never-forward'));
  return {status:0,stdout:JSON.stringify({completed:true,outcome:'satin',controlSha:sha('b'),applicationControlSha:sha('a'),runId:'30',backendContainerUnchanged:true,databaseContainerUnchanged:true,backendRestarted:false,databaseWritten:false})};
 });assert.equal(existsSync(keyFile),false);
});
test('transport failure also removes private key and never invokes a second transport',t=>{
 const root=mkdtempSync(path.join(tmpdir(),'fleetum-failed-completion-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let calls=0,key;
 assert.throws(()=>executeCompletion({confirm:'COMPLETE_PLATFORM_FRONTEND',runId:'30'},
  {RUNNER_TEMP:root,FLEETUM_PLATFORM_FRONTEND_HOST:'synthetic.example.invalid',FLEETUM_PLATFORM_FRONTEND_USER:'ubuntu',FLEETUM_PLATFORM_FRONTEND_SSH_KEY:'synthetic-only',FLEETUM_PLATFORM_FRONTEND_KNOWN_HOSTS:'synthetic-host-only'},(_cmd,args)=>{calls++;key=args[args.indexOf('-i')+1];return {status:1};}));
 assert.equal(calls,1);assert.equal(existsSync(key),false);
});

function sourceEvidence(){
 const repo='Silviomasuccio6/Fleetum',controlSha=sha('a'),hash=c=>c.repeat(64);
 const sources=Object.fromEntries(['backend','satin','fallback'].map((role,i)=>[role,{sourceSha:sha(String(i+1)),treeSha:sha('f'),archiveName:role+'.source.tar.gz',archiveSha256:hash('b')}]));
 const source={schemaVersion:1,kind:'platform-production-source-export',controlSha,runId:'11',manifestSha256:hash('c'),sources};
 const report=role=>({schemaVersion:1,role,controlSha,runId:'11',manifestSha256:hash('c'),sourceSha:sources[role].sourceSha,treeSha:sha('f'),passed:true,runtime:{node:'22.23.1',platform:'linux',arch:'x64'},archiveSha256:hash('d'),audit:{high:0,critical:0},
  ...(role==='backend'?{unitTests:186,databaseTests:13,postgresVersion:'16.15',migrationChain:{baseline:42,patched:43,future:48,preserved:true,canonical:true}}:{tests:129,platformApi:'https://platform.fleetum.it/platform-api'})});
 const reports=Object.fromEntries(['backend','satin','fallback'].map(role=>[role,report(role)]));
 reports.image={...report('backend'),role:'image',imageId:'sha256:'+hash('e'),platform:'linux/amd64',runtimeUser:{uid:1000,gid:1000},dockerfileSha256:hash('f'),smokePassed:true,migrationCliPassed:true,npmAbsent:true,scanner:{image:'aquasec/trivy@sha256:'+hash('1'),high:0,critical:0}};
 reports.security={schemaVersion:1,role:'security',controlSha,runId:'11',manifestSha256:hash('c'),passed:true,sources:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,v.sourceSha])),tools:{gitleaks:'ghcr.io/gitleaks/gitleaks@sha256:'+hash('2'),semgrep:'semgrep/semgrep@sha256:'+hash('3')}};
 const candidate=candidateProof({source,reports,needs:Object.fromEntries(['sources','backend','frontend','image','security'].map(k=>[k,{result:'success'}])),context:{repository:repo,controlSha,runId:'11',event:'push',branch:'main'}});
 const make=(id,file)=>({id,run_attempt:1,status:'completed',conclusion:'success',head_sha:controlSha,event:'push',head_branch:'main',path:'.github/workflows/'+file,repository:{full_name:repo},head_repository:{full_name:repo}});
 const metadata={candidateRun:make(11,'platform-production-candidate-ci.yml'),controlRun:make(12,'ci.yml')};
 const control=createCIProof({repository:repo,runId:'12',sourceSha:controlSha,checkoutSha:controlSha,event:'push',jobResults:Object.fromEntries(REQUIRED_CI_JOBS.map(k=>[k,{result:'success'}]))});
 return {metadata,candidate,control,controlSha,ids:{candidateCiRunId:'11',controlCiRunId:'12'},descriptor:{sources},manifestSha256:hash('c')};
}
function verify(f){return verifySourceEvidence(f.metadata,f.candidate,f.control,f.controlSha,f.ids,f.descriptor,f.manifestSha256);}
test('independent original or current source evidence validates without rewriting its control identity',()=>assert.equal(verify(sourceEvidence()),true));
test('transplanted source/control proofs, PR events, reruns and foreign repositories are rejected',()=>{
 for(const change of [f=>f.controlSha=sha('b'),f=>f.metadata.candidateRun.event='pull_request',f=>f.metadata.candidateRun.run_attempt=2,f=>f.metadata.candidateRun.repository.full_name='other/repo',f=>f.metadata.controlRun.head_repository.full_name='other/repo',f=>f.manifestSha256='0'.repeat(64),f=>f.candidate.reports.backend.databaseTests=0]){
  const f=sourceEvidence();change(f);assert.throws(()=>verify(f));
 }
});
