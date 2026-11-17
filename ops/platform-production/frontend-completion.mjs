import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {profileHash,collectMetadata,downloadArtifact} from './prepare.mjs';
import {positiveId,SHA,HASH,verifyCandidateProof} from './policy.mjs';
import {verifyCIProof} from '../ci-release-identity.mjs';
import {verifyProductionCIRun} from '../production-release-policy.mjs';
import {validateSshTarget} from '../e2e/staging-release-binding.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url)),REPO=path.resolve(HERE,'../..');
const MANIFEST='ops/platform-release/production-candidates/20261115/candidate.json';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const digest=x=>createHash('sha256').update(x).digest('hex');
const KEYS=['schemaVersion','kind','repository','controlSha','applicationControlSha','prepareRunId','failedInstallRunId',
 'approvedUntil','originalRequestSha256','currentStateSha256','allowVisualFallback','completionCiRunId','completionCandidateCiRunId','preparedArtifactSha256'];

export function readCompletion(env,mainSha,checkoutSha,now=Date.now()){
 const a=JSON.parse(env.FLEETUM_PLATFORM_FRONTEND_COMPLETION_JSON??'null');
 assert.ok(a);assert.deepEqual(Object.keys(a).sort(),[...KEYS].sort());
 assert.equal(a.schemaVersion,1);assert.equal(a.kind,'platform-production-frontend-completion-approval');
 assert.equal(a.repository,'Silviomasuccio6/Fleetum');assert.equal(env.GITHUB_REPOSITORY,a.repository);
 assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
 assert.equal(env.COMPLETE_CONFIRM,'COMPLETE_PLATFORM_FRONTEND');assert.ok(positiveId(env.GITHUB_RUN_ID));
 assert.ok(SHA.test(checkoutSha)&&SHA.test(a.applicationControlSha));
 for(const value of [a.controlSha,mainSha,env.GITHUB_WORKFLOW_SHA,env.FLEETUM_PLATFORM_FRONTEND_TRUSTED_CONTROL_SHA])assert.equal(value,checkoutSha);
 for(const key of ['prepareRunId','failedInstallRunId','completionCiRunId','completionCandidateCiRunId'])assert.ok(positiveId(a[key]));
 for(const key of ['originalRequestSha256','currentStateSha256','preparedArtifactSha256'])assert.ok(HASH.test(a[key]));
 assert.equal(a.allowVisualFallback,true);
 const until=Date.parse(a.approvedUntil);assert.ok(Number.isFinite(until)&&until>now&&until-now<=21600000);
 const originalRequest=JSON.parse(env.FLEETUM_PLATFORM_FRONTEND_ORIGINAL_REQUEST_JSON??'null');
 const currentState=JSON.parse(env.FLEETUM_PLATFORM_FRONTEND_CURRENT_STATE_JSON??'null');
 assert.equal(profileHash(originalRequest),a.originalRequestSha256);assert.equal(profileHash(currentState),a.currentStateSha256);
 assert.equal(originalRequest.approval.controlSha,a.applicationControlSha);
 assert.equal(String(originalRequest.runId),String(a.failedInstallRunId));
 assert.equal(originalRequest.prepared.controlSha,a.applicationControlSha);assert.equal(String(originalRequest.prepared.prepareRunId),String(a.prepareRunId));
 return {schemaVersion:1,kind:'platform-production-frontend-completion-request',confirm:env.COMPLETE_CONFIRM,runId:env.GITHUB_RUN_ID,
  approval:a,originalRequest,currentState,prepared:originalRequest.prepared};
}
export function revalidateCompletion(request,env,mainSha,checkoutSha){
 const fresh=readCompletion(env,mainSha,checkoutSha);
 for(const key of ['approval','originalRequest','currentState','prepared','runId','confirm'])assert.deepEqual(request[key],fresh[key]);
 return true;
}

export function verifySourceEvidence(metadata,candidate,control,controlSha,ids,descriptor,manifestSha256){
 const repo='Silviomasuccio6/Fleetum',run=metadata.candidateRun;
 verifyCandidateProof(candidate,{repository:repo,controlSha,runId:String(ids.candidateCiRunId)});
 assert.equal(candidate.event,'push');assert.equal(candidate.branch,'main');assert.equal(run.event,'push');assert.equal(run.head_branch,'main');
 assert.equal(run.head_sha,controlSha);assert.equal(String(run.id),String(ids.candidateCiRunId));assert.equal(run.run_attempt,1);
 assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
 assert.equal(run.path,'.github/workflows/platform-production-candidate-ci.yml');
 for(const value of [run,metadata.controlRun]){
  assert.equal(value.repository?.full_name,repo);assert.equal(value.head_repository?.full_name,repo);
 }
 assert.equal(candidate.sourceProof.manifestSha256,manifestSha256);
 for(const role of ['backend','satin','fallback'])for(const key of ['sourceSha','treeSha'])assert.equal(candidate.sourceProof.sources[role][key],descriptor.sources[role][key]);
 verifyCIProof(control,{repository:repo,sourceSha:controlSha,runId:String(ids.controlCiRunId)});
 assert.ok(verifyProductionCIRun(metadata.controlRun,{repository:repo,sourceSha:controlSha}).ok);
 assert.equal(metadata.controlRun.run_attempt,1);assert.equal(String(metadata.controlRun.id),String(ids.controlCiRunId));
 return true;
}

export async function resolveCompletion(github,env,directory){
 const owner='Silviomasuccio6',repo='Fleetum';
 assert.equal((await github.rest.repos.get({owner,repo})).data.default_branch,'main');
 const main=(await github.rest.repos.getCommit({owner,repo,ref:'main'})).data.sha;
 const checkout=execFileSync('git',['rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).trim();
 const r=readCompletion(env,main,checkout),a=r.approval,old=r.originalRequest,p=r.prepared;
 // Original images remain attested by the original controller, never relabelled
 // as the product of this newer controller or its CI.
 execFileSync('git',['merge-base','--is-ancestor',a.applicationControlSha,checkout],{cwd:REPO,stdio:'pipe'});
 const descriptor=read(path.join(REPO,MANIFEST)),manifestSha256=digest(readFileSync(path.join(REPO,MANIFEST)));
 assert.equal(manifestSha256,old.approval.manifestSha256);assert.equal(p.candidateManifestSha256,manifestSha256);
 const out=path.resolve(directory);assert.ok(!out.startsWith(REPO+path.sep));mkdirSync(out,{mode:0o700});
 let originalProof;
 for(const [name,controlSha,ids] of [
  ['application',a.applicationControlSha,old.approval],
  ['controller',checkout,{candidateCiRunId:a.completionCandidateCiRunId,controlCiRunId:a.completionCiRunId}]
 ]){
  const metadata=await collectMetadata(github,ids,{repository:a.repository,controlSha});
  const folder=path.join(out,name);mkdirSync(folder,{mode:0o700});
  for(const [role,file] of [['control','ci-source.json'],['candidate','platform-candidate-proof.json']])downloadArtifact(metadata.artifacts[role],file,path.join(folder,file),{env});
  const candidate=read(path.join(folder,'platform-candidate-proof.json'));
  verifySourceEvidence(metadata,candidate,read(path.join(folder,'ci-source.json')),controlSha,ids,descriptor,manifestSha256);
  if(name==='application')originalProof=candidate;
 }
 const run=async(id,file,conclusion,sha)=>{
  const value=(await github.rest.actions.getWorkflowRun({owner,repo,run_id:Number(id)})).data;
  const workflow=(await github.rest.actions.getWorkflow({owner,repo,workflow_id:file})).data;
  assert.equal(value.workflow_id,workflow.id);assert.equal(value.path,'.github/workflows/'+file);
  assert.equal(value.head_sha,sha);assert.equal(value.event,'workflow_dispatch');assert.equal(value.head_branch,'main');assert.equal(value.run_attempt,1);
  assert.equal(value.status,'completed');assert.equal(value.conclusion,conclusion);
  assert.equal(value.repository?.full_name,a.repository);assert.equal(value.head_repository?.full_name,a.repository);
  const approvals=(await github.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/approvals',{owner,repo,run_id:Number(id)})).data;
  assert.ok(approvals.some(x=>x.state==='approved'&&x.user?.login==='Silviomasuccio6'&&x.environments?.some(e=>e.name==='production')));
  return value;
 };
 const preparation=await run(a.prepareRunId,'prepare-platform-production.yml','success',a.applicationControlSha);
 await run(a.failedInstallRunId,'install-platform-production.yml','failure',a.applicationControlSha);
 const artifacts=await github.paginate(github.rest.actions.listWorkflowRunArtifacts,{owner,repo,run_id:preparation.id,per_page:100});
 const matches=artifacts.filter(x=>x.name==='platform-production-prepared-'+preparation.id&&!x.expired);
 assert.equal(matches.length,1);const artifact=matches[0];assert.ok(artifact.size_in_bytes>0&&artifact.size_in_bytes<256*1024);
 assert.equal(artifact.digest,'sha256:'+a.preparedArtifactSha256);
 downloadArtifact(artifact,'prepared-production.json',path.join(out,'prepared-production.json'),{env});
 assert.deepEqual(read(path.join(out,'prepared-production.json')),p);
 assert.equal(p.backendImageId,originalProof.reports.image.imageId);assert.equal(p.backendSourceSha,descriptor.sources.backend.sourceSha);
 for(const role of ['satin','fallback'])assert.equal(p.variants[role].sourceSha,descriptor.sources[role].sourceSha);
 r.backendTreeSha=originalProof.sourceProof.sources.backend.treeSha;
 const name='20260921150000_final_release_blocker_atomicity';
 const sql=execFileSync('git',['show',descriptor.sources.backend.sourceSha+':backend/prisma/migrations/'+name+'/migration.sql'],{cwd:REPO});
 assert.deepEqual(old.expectedPatchMigration,{[name]:digest(sql)});
 const tested=spawnSync('python3',['-B','-c','import importlib.util,json,sys;s=importlib.util.spec_from_file_location("frontend",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.validate(json.load(sys.stdin))',path.join(HERE,'host_frontend.py')],{input:JSON.stringify(r),encoding:'utf8'});
 assert.equal(tested.status,0,'Pure host completion validation failed');
 return r;
}

export const LOADER=`import hashlib,json,os,pathlib,re,subprocess,sys
need=lambda x:x or (_ for _ in ()).throw(ValueError('Trusted frontend transfer rejected'))
need(os.geteuid()==0)
raw=sys.stdin.buffer.read(2*1024*1024+1);need(len(raw)<=2*1024*1024)
r=json.loads(raw);run=str(r['request']['runId']);need(re.fullmatch('[1-9][0-9]*',run))
need(set(r['files'])=={'host_frontend.py','host_preflight.py','image_identity.py'})
base=pathlib.Path('/opt/fleetum/platform-frontend-code');need(not any(p.is_symlink() for p in (base,*base.parents)))
base.mkdir(mode=0o700,exist_ok=True);need(base.stat().st_uid==0 and base.stat().st_mode&0o077==0)
out=base/run;out.mkdir(mode=0o700)
for name,item in r['files'].items():
 data=item['text'].encode();need(len(data)<128*1024 and hashlib.sha256(data).hexdigest()==item['sha256'])
 p=out/name
 with p.open('xb') as f:f.write(data)
 os.chmod(p,0o600)
done=subprocess.run(['/usr/bin/python3','-I','-B',str(out/'host_frontend.py')],input=json.dumps(r['request']).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=900)
need(done.returncode==0);sys.stdout.buffer.write(done.stdout)
`;
export function executeCompletion(request,env=process.env,execute=spawnSync){
 assert.equal(request.confirm,'COMPLETE_PLATFORM_FRONTEND');assert.ok(positiveId(request.runId));
 assert.ok(validateSshTarget(env.FLEETUM_PLATFORM_FRONTEND_HOST,env.FLEETUM_PLATFORM_FRONTEND_USER).ok);
 assert.ok(env.FLEETUM_PLATFORM_FRONTEND_SSH_KEY?.trim()&&env.FLEETUM_PLATFORM_FRONTEND_KNOWN_HOSTS?.trim());
 const folder=mkdtempSync(path.join(env.RUNNER_TEMP??'/tmp','fleetum-frontend-ssh-'));
 try{
  const key=path.join(folder,'key'),known=path.join(folder,'known_hosts');
  writeFileSync(key,env.FLEETUM_PLATFORM_FRONTEND_SSH_KEY.trim()+'\n',{mode:0o600});writeFileSync(known,env.FLEETUM_PLATFORM_FRONTEND_KNOWN_HOSTS.trim()+'\n',{mode:0o600});
  const files=Object.fromEntries(['host_frontend.py','host_preflight.py','image_identity.py'].map(name=>{const text=readFileSync(path.join(HERE,name),'utf8');return [name,{text,sha256:digest(text)}];}));
  const result=execute('ssh',['-F','/dev/null','-o','GlobalKnownHostsFile=/dev/null','-o','UserKnownHostsFile='+known,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-o','ConnectTimeout=20','-i',key,
   env.FLEETUM_PLATFORM_FRONTEND_USER+'@'+env.FLEETUM_PLATFORM_FRONTEND_HOST,'sudo -n python3 -I -B -c '+"'"+LOADER.replaceAll("'","'\\''")+"'"],
   {input:JSON.stringify({files,request}),encoding:'utf8',env:{PATH:env.PATH,HOME:env.HOME},timeout:960000,maxBuffer:1024*1024});
  assert.ok(!result.error&&!result.signal&&result.status===0,'Single frontend completion failed; preserve journal, no automatic retry');
  const proof=JSON.parse(result.stdout);assert.equal(proof.completed,true);assert.equal(proof.controlSha,request.approval.controlSha);assert.equal(proof.runId,String(request.runId));
  assert.equal(proof.applicationControlSha,request.prepared.controlSha);assert.ok(['satin','fallback'].includes(proof.outcome));
  assert.equal(proof.backendContainerUnchanged,true);assert.equal(proof.databaseContainerUnchanged,true);
  assert.equal(proof.backendRestarted,false);assert.equal(proof.databaseWritten,false);
  return proof;
 }finally{rmSync(folder,{recursive:true,force:true});}
}
