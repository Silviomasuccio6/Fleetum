import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {profileHash,collectMetadata,downloadArtifact} from './prepare.mjs';
import {positiveId,verifyProductionApproval,verifyPreparedRelease} from './policy.mjs';
import {verifyProfile} from './profile.mjs';
import {validateSshTarget} from '../e2e/staging-release-binding.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url)),REPO=path.resolve(HERE,'../..');
const MANIFEST='ops/platform-release/production-candidates/20261115/candidate.json';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function readInstallation(env,mainSha,checkoutSha){
 const approval=JSON.parse(env.FLEETUM_PLATFORM_PRODUCTION_INSTALL_JSON??'null');
 const context={repository:env.GITHUB_REPOSITORY,controlSha:checkoutSha,workflowSha:env.GITHUB_WORKFLOW_SHA,mainSha,
  event:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF,attempt:env.GITHUB_RUN_ATTEMPT,runId:env.GITHUB_RUN_ID,confirm:env.INSTALL_CONFIRM};
 assert.equal(env.FLEETUM_PLATFORM_PRODUCTION_TRUSTED_CONTROL_SHA,checkoutSha);verifyProductionApproval(approval,context);
 const profile=JSON.parse(env.FLEETUM_PLATFORM_PRODUCTION_PROFILE_JSON??'null');
 const backup=JSON.parse(env.FLEETUM_PLATFORM_PRODUCTION_BACKUP_JSON??'null');
 const backupRequest=JSON.parse(env.FLEETUM_PLATFORM_PRODUCTION_PREFLIGHT_JSON??'null');
 for(const [key,value] of [['profileSha256',profile],['backupSha256',backup],['preflightSha256',backupRequest]])assert.equal(profileHash(value),approval[key]);
 verifyProfile(profile,approval);assert.equal(profile.appDir,'/opt/fleetum/app');assert.equal(profile.ingressMode,'shared');
 assert.ok(positiveId(env.FLEETUM_PLATFORM_PRODUCTION_PREPARED_RUN_ID));
 assert.equal(backup.containersUnchanged,true);assert.equal(backup.dataCopiedOffHost,false);
 return {approval,context,profile,backup,backupRequest};
}
export function revalidateInstallation(request,env,mainSha,checkoutSha){
 const fresh=readInstallation(env,mainSha,checkoutSha);
 for(const key of ['approval','profile','backup','backupRequest'])assert.deepEqual(request[key],fresh[key],'Protected installation tuple changed');
 assert.equal(String(request.runId),String(fresh.context.runId));assert.equal(request.confirm,fresh.context.confirm);
 return true;
}
export async function resolveInstallation(github,env,directory){
 assert.equal(env.GITHUB_REPOSITORY,'Silviomasuccio6/Fleetum');const [owner,repo]=env.GITHUB_REPOSITORY.split('/');
 const repository=(await github.rest.repos.get({owner,repo})).data;assert.equal(repository.default_branch,'main');
 const main=(await github.rest.repos.getCommit({owner,repo,ref:'main'})).data.sha;
 const checkout=execFileSync('git',['rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).trim();
 const request=readInstallation(env,main,checkout),{approval,context}=request;
 const descriptor=read(path.join(REPO,MANIFEST)),manifestSha256=digest(readFileSync(path.join(REPO,MANIFEST)));
 const out=path.resolve(directory);assert.ok(!out.startsWith(REPO+path.sep));mkdirSync(out,{mode:0o700});
 const metadata=await collectMetadata(github,approval,context);
 for(const [role,file] of [['control','ci-source.json'],['candidate','platform-candidate-proof.json']])downloadArtifact(metadata.artifacts[role],file,path.join(out,file),{env});
 verifyPreparedRelease({approval,candidate:read(path.join(out,'platform-candidate-proof.json')),context,run:metadata.candidateRun,
  control:read(path.join(out,'ci-source.json')),controlRun:metadata.controlRun,descriptor,manifestSha256});
 const run=(await github.rest.actions.getWorkflowRun({owner,repo,run_id:Number(env.FLEETUM_PLATFORM_PRODUCTION_PREPARED_RUN_ID)})).data;
 const workflow=(await github.rest.actions.getWorkflow({owner,repo,workflow_id:'prepare-platform-production.yml'})).data;
 assert.equal(run.workflow_id,workflow.id);assert.equal(run.path,'.github/workflows/prepare-platform-production.yml');
 assert.equal(run.head_sha,context.controlSha);assert.equal(run.event,'workflow_dispatch');assert.equal(run.head_branch,'main');assert.equal(run.run_attempt,1);
 assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');assert.equal(run.repository?.full_name,context.repository);assert.equal(run.head_repository?.full_name,context.repository);
 const artifacts=await github.paginate(github.rest.actions.listWorkflowRunArtifacts,{owner,repo,run_id:run.id,per_page:100});
 const matches=artifacts.filter(a=>a.name==='platform-production-prepared-'+run.id&&!a.expired);
 assert.equal(matches.length,1);assert.ok(matches[0].size_in_bytes>0&&matches[0].size_in_bytes<256*1024);
 downloadArtifact(matches[0],'prepared-production.json',path.join(out,'prepared-production.json'),{env});
 const prepared=read(path.join(out,'prepared-production.json'));
 assert.equal(prepared.controlSha,context.controlSha);assert.equal(String(prepared.prepareRunId),String(run.id));
 assert.equal(prepared.profileSha256,approval.profileSha256);assert.equal(prepared.candidateManifestSha256,manifestSha256);
 assert.equal(prepared.backendSourceSha,descriptor.sources.backend.sourceSha);
 for(const role of ['satin','fallback'])assert.equal(prepared.variants[role].sourceSha,descriptor.sources[role].sourceSha);
 const name='20260921150000_final_release_blocker_atomicity';
 const sql=execFileSync('git',['show',descriptor.sources.backend.sourceSha+':backend/prisma/migrations/'+name+'/migration.sql'],{cwd:REPO});
 const install={schemaVersion:1,kind:'platform-production-install-request',confirm:context.confirm,runId:context.runId,
  approval,profile:request.profile,backup:request.backup,backupRequest:request.backupRequest,prepared,backendTreeSha:read(path.join(out,'platform-candidate-proof.json')).sourceProof.sources.backend.treeSha,expectedPatchMigration:{[name]:digest(sql)}};
 // The same host validation runs before an SSH credential is opened.
 const tested=spawnSync('python3',['-B','-c','import importlib.util,json,sys; s=importlib.util.spec_from_file_location("host_install",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.validate(json.load(sys.stdin))',path.join(HERE,'host_install.py')],{input:JSON.stringify(install),encoding:'utf8'});
 assert.equal(tested.status,0,'Host transaction input did not pass pure validation');
 return install;
}

const LOADER=`import hashlib,json,os,pathlib,re,subprocess,sys
need=lambda x: x or (_ for _ in ()).throw(ValueError('Trusted transfer rejected'))
need(os.geteuid()==0)
raw=sys.stdin.buffer.read(2*1024*1024+1);need(len(raw)<=2*1024*1024)
r=json.loads(raw);run=str(r['request']['runId']);need(re.fullmatch('[1-9][0-9]*',run))
need(set(r['files'])=={'host_install.py','host_preflight.py','image_identity.py'})
base=pathlib.Path('/opt/fleetum/platform-production-code');need(not any(p.is_symlink() for p in (base,*base.parents)))
base.mkdir(mode=0o700,exist_ok=True);need(base.stat().st_uid==0 and base.stat().st_mode&0o077==0)
out=base/run;out.mkdir(mode=0o700)
for name,item in r['files'].items():
 data=item['text'].encode();need(len(data)<128*1024 and hashlib.sha256(data).hexdigest()==item['sha256'])
 p=out/name
 with p.open('xb') as f:f.write(data)
 os.chmod(p,0o600)
done=subprocess.run(['/usr/bin/python3','-I','-B',str(out/'host_install.py')],input=json.dumps(r['request']).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=900)
need(done.returncode==0);sys.stdout.buffer.write(done.stdout)
`;
export function executeInstallation(request,env=process.env,execute=spawnSync){
 assert.equal(request.confirm,'RELEASE_PLATFORM_PRODUCTION');assert.ok(positiveId(request.runId));
 assert.ok(validateSshTarget(env.FLEETUM_PLATFORM_PRODUCTION_HOST,env.FLEETUM_PLATFORM_PRODUCTION_USER).ok);
 assert.ok(env.FLEETUM_PLATFORM_PRODUCTION_SSH_KEY?.trim()&&env.FLEETUM_PLATFORM_PRODUCTION_KNOWN_HOSTS?.trim());
 const folder=mkdtempSync(path.join(env.RUNNER_TEMP??'/tmp','fleetum-production-ssh-'));
 try{
  const key=path.join(folder,'key'),known=path.join(folder,'known_hosts');
  writeFileSync(key,env.FLEETUM_PLATFORM_PRODUCTION_SSH_KEY.trim()+'\n',{mode:0o600});writeFileSync(known,env.FLEETUM_PLATFORM_PRODUCTION_KNOWN_HOSTS.trim()+'\n',{mode:0o600});
  const files=Object.fromEntries(['host_install.py','host_preflight.py','image_identity.py'].map(name=>{const text=readFileSync(path.join(HERE,name),'utf8');return [name,{text,sha256:digest(text)}];}));
  const result=execute('ssh',['-F','/dev/null','-o','GlobalKnownHostsFile=/dev/null','-o','UserKnownHostsFile='+known,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-o','ConnectTimeout=20','-i',key,
   env.FLEETUM_PLATFORM_PRODUCTION_USER+'@'+env.FLEETUM_PLATFORM_PRODUCTION_HOST,'sudo -n python3 -I -B -c '+"'"+LOADER.replaceAll("'","'\\''")+"'"],
   {input:JSON.stringify({files,request}),encoding:'utf8',env:{PATH:env.PATH,HOME:env.HOME},timeout:960000,maxBuffer:1024*1024});
  assert.ok(!result.error&&!result.signal&&result.status===0,'Single production transaction failed; preserve journal and review, no automatic retry');
  const proof=JSON.parse(result.stdout);assert.equal(proof.completed,true);assert.equal(proof.controlSha,request.approval.controlSha);assert.equal(proof.runId,String(request.runId));
  return proof;
 }finally{rmSync(folder,{recursive:true,force:true});}
}
