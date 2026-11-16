import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { positiveId, HASH, CI_PATH, verifyImagePreparationApproval, verifyImagePreparationEvidence } from './policy.mjs';
import { verifyProfile } from './profile.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url)),REPO=path.resolve(HERE,'../..');
const MANIFEST='ops/platform-release/production-candidates/20261115/candidate.json';
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const write=(file,value)=>writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
const digest=file=>{
  const fd=openSync(file,'r'),buffer=Buffer.alloc(1024*1024),h=createHash('sha256');
  try {let n;while((n=readSync(fd,buffer,0,buffer.length,null))>0)h.update(buffer.subarray(0,n));return h.digest('hex');}
  finally {closeSync(fd);}
};
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)])):x;
export const profileHash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function readPreparation(env,mainSha,checkoutSha) {
  const a=JSON.parse(env.FLEETUM_PLATFORM_PRODUCTION_PREPARE_JSON??'null');
  const context={repository:env.GITHUB_REPOSITORY,controlSha:checkoutSha,workflowSha:env.GITHUB_WORKFLOW_SHA,
    mainSha,event:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF,attempt:env.GITHUB_RUN_ATTEMPT,
    runId:env.GITHUB_RUN_ID,confirm:env.PREPARE_CONFIRM};
  assert.equal(env.FLEETUM_PLATFORM_PRODUCTION_TRUSTED_CONTROL_SHA,checkoutSha);
  verifyImagePreparationApproval(a,context);
  const profile=JSON.parse(env.FLEETUM_PLATFORM_PRODUCTION_PROFILE_JSON??'null');
  assert.equal(profileHash(profile),a.profileSha256,'Approved profile changed');verifyProfile(profile,a);
  return {approval:a,context};
}
export async function collectMetadata(github,approval,context) {
  const [owner,repo]=context.repository.split('/');
  const run=async id=>(await github.rest.actions.getWorkflowRun({owner,repo,run_id:Number(id)})).data;
  const candidateRun=await run(approval.candidateCiRunId),controlRun=await run(approval.controlCiRunId);
  for(const [r,name] of [[candidateRun,'platform-production-candidate-ci.yml'],[controlRun,'ci.yml']]) {
    const workflow=(await github.rest.actions.getWorkflow({owner,repo,workflow_id:name})).data;
    assert.equal(r.workflow_id,workflow.id);assert.equal(r.path,workflow.path);
    assert.equal(r.head_sha,context.controlSha);assert.equal(r.status,'completed');assert.equal(r.conclusion,'success');
    if(name==='ci.yml')assert.equal(r.event,'push');else assert.ok(['push','workflow_dispatch'].includes(r.event));
    assert.equal(r.head_branch,'main');
    assert.equal(r.repository?.full_name,context.repository);assert.equal(r.head_repository?.full_name,context.repository);
  }
  assert.equal(candidateRun.path,CI_PATH);
  const all=async id=>github.paginate(github.rest.actions.listWorkflowRunArtifacts,{owner,repo,run_id:Number(id),per_page:100});
  const candidateArtifacts=await all(approval.candidateCiRunId),controlArtifacts=await all(approval.controlCiRunId);
  const pick=(list,name,max)=>{
    const found=list.filter(a=>a.name===name&&!a.expired);assert.equal(found.length,1,'Exactly one unexpired artifact required');
    const a=found[0];assert.ok(positiveId(a.id)&&/^sha256:[0-9a-f]{64}$/.test(a.digest)&&Number.isSafeInteger(a.size_in_bytes)&&a.size_in_bytes>0&&a.size_in_bytes<=max);
    return {id:a.id,name:a.name,digest:a.digest,size_in_bytes:a.size_in_bytes};
  };
  const n=approval.candidateCiRunId;
  return {candidateRun,controlRun,artifacts:{
    control:pick(controlArtifacts,'ci-source-proof-'+approval.controlCiRunId,256*1024),
    candidate:pick(candidateArtifacts,'platform-candidate-proof-'+n,256*1024),
    backend:pick(candidateArtifacts,'platform-candidate-backend-image-'+n,2*1024*1024*1024),
    satin:pick(candidateArtifacts,'platform-candidate-compiled-satin-'+n,128*1024*1024),
    fallback:pick(candidateArtifacts,'platform-candidate-compiled-fallback-'+n,128*1024*1024)}};
}
export function downloadArtifact(a,file,destination,{env=process.env,execute=spawnSync}={}) {
  assert.ok(positiveId(a.id)&&/^sha256:[0-9a-f]{64}$/.test(a.digest));
  const zip=destination+'.zip',fd=openSync(zip,'wx',0o600);
  try {
    const result=execute('gh',['api',`repos/Silviomasuccio6/Fleetum/actions/artifacts/${a.id}/zip`],
      {env:{PATH:env.PATH,HOME:env.HOME,GH_TOKEN:env.GH_TOKEN},stdio:['ignore',fd,'pipe'],timeout:600000});
    assert.ok(!result.error&&!result.signal&&result.status===0,'Artifact download failed');
  } finally {closeSync(fd);}
  assert.ok(statSync(zip).size<=a.size_in_bytes+1024*1024,'Artifact size changed unexpectedly');
  const limit=['ci-source.json','platform-candidate-proof.json'].includes(file)?256*1024:2*1024*1024*1024;
  execFileSync('python3',[path.join(HERE,'artifact_zip.py'),zip,destination,file,a.digest,String(limit)],{stdio:'pipe',timeout:300000});
}
export async function resolve(github,env,directory) {
  const repository=env.GITHUB_REPOSITORY;assert.equal(repository,'Silviomasuccio6/Fleetum');
  const [owner,repo]=repository.split('/');const current=(await github.rest.repos.get({owner,repo})).data;assert.equal(current.default_branch,'main');
  const main=(await github.rest.repos.getCommit({owner,repo,ref:'main'})).data.sha;
  const checkout=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:REPO}).trim();
  const {approval,context}=readPreparation(env,main,checkout),descriptor=read(path.join(REPO,MANIFEST));
  assert.equal(digest(path.join(REPO,MANIFEST)),approval.manifestSha256);
  const out=path.resolve(directory);assert.ok(!out.startsWith(REPO+path.sep));mkdirSync(out,{mode:0o700});
  const metadata=await collectMetadata(github,approval,context);
  downloadArtifact(metadata.artifacts.control,'ci-source.json',path.join(out,'ci-source.json'),{env});
  downloadArtifact(metadata.artifacts.candidate,'platform-candidate-proof.json',path.join(out,'platform-candidate-proof.json'),{env});
  const candidate=read(path.join(out,'platform-candidate-proof.json'));
  verifyImagePreparationEvidence({approval,candidate,context,run:metadata.candidateRun,control:read(path.join(out,'ci-source.json')),controlRun:metadata.controlRun,
    descriptor,manifestSha256:digest(path.join(REPO,MANIFEST))});
  for(const [role,name] of Object.entries({backend:'backend.image.tar',satin:'satin.compiled.tar.gz',fallback:'fallback.compiled.tar.gz'})){
    const file=path.join(out,name);downloadArtifact(metadata.artifacts[role],name,file,{env});
    assert.equal(digest(file),candidate.reports[role==='backend'?'image':role].archiveSha256,'Compiled payload differs from verified proof');
  }
  write(path.join(out,'approval.json'),approval);write(path.join(out,'metadata.json'),metadata);
  write(path.join(out,'request.json'),{schemaVersion:1,kind:'platform-production-image-request',runId:context.runId,approval,candidate,
    payloads:Object.fromEntries([['backend','backend.image.tar'],['satin','satin.compiled.tar.gz'],['fallback','fallback.compiled.tar.gz']].map(([role,file])=>[role,path.join(out,file)]))});
  return {candidateCiRunId:approval.candidateCiRunId,controlSha:context.controlSha,serverAccessed:false};
}
export function build(directory,env=process.env) {
  const out=path.resolve(directory),metadata=read(path.join(out,'metadata.json'));
  const checkout=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:REPO}).trim();
  const main=execFileSync('gh',['api','repos/Silviomasuccio6/Fleetum/commits/main','--jq','.sha'],{encoding:'utf8',env:{PATH:env.PATH,HOME:env.HOME,GH_TOKEN:env.GH_TOKEN}}).trim();
  const {approval,context}=readPreparation(env,main,checkout);
  assert.deepEqual(approval,read(path.join(out,'approval.json')));
  verifyImagePreparationEvidence({approval,candidate:read(path.join(out,'platform-candidate-proof.json')),context,run:metadata.candidateRun,
    control:read(path.join(out,'ci-source.json')),controlRun:metadata.controlRun,descriptor:read(path.join(REPO,MANIFEST)),manifestSha256:digest(path.join(REPO,MANIFEST))});
  const request=read(path.join(out,'request.json'));assert.deepEqual(request.approval,approval);
  assert.deepEqual(request.candidate,read(path.join(out,'platform-candidate-proof.json')));
  assert.equal(String(request.runId),String(context.runId));
  assert.deepEqual(request.payloads,{backend:path.join(out,'backend.image.tar'),satin:path.join(out,'satin.compiled.tar.gz'),fallback:path.join(out,'fallback.compiled.tar.gz')});
  const result=spawnSync('python3',[path.join(HERE,'prepare_images.py'),path.join(out,'prepared')],{
    input:JSON.stringify(request),env,encoding:'utf8',timeout:1800000,maxBuffer:1024*1024});
  assert.ok(!result.error&&!result.signal&&result.status===0,'Inert production image preparation failed; no installation attempted');
  return read(path.join(out,'prepared/prepared-production.json'));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {assert.equal(process.argv[2],'build');build(process.argv[3]);console.log('Production images prepared; installation is a separate gate.');}
  catch {console.error('Production preparation stopped before installation. No automatic retry.');process.exitCode=1;}
}
