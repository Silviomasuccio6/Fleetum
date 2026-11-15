import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assertApproval,verifyOverlayProof,positiveId } from './policy.mjs';
import { verifyDownloaded } from './resolve.mjs';
import { verifyDeployRun,verifyReleaseProof,validateSshTarget,verifyRuntimeContinuity } from '../e2e/staging-release-binding.mjs';
import { captureRuntime } from '../e2e/capture-staging-runtime.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const json=file=>JSON.parse(readFileSync(file,'utf8'));
const put=(file,value)=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});};
const run=(command,args,options={})=>{const r=spawnSync(command,args,{encoding:'utf8',timeout:300000,maxBuffer:4*1024*1024,...options});assert.ok(!r.error&&!r.signal&&r.status===0,'Platform control process failed');return r.stdout;};
export const contextFromEnv=(env=process.env)=>({repository:env.GITHUB_REPOSITORY,controlSha:env.GITHUB_WORKFLOW_SHA,appSha:env.FLEETUM_STAGING_APPROVED_RELEASE_SHA,approvedUiSha:env.FLEETUM_PLATFORM_APPROVED_UI_SHA,parentRunId:env.E2E_STAGING_RUN_ID});
export function readApproval(env=process.env, getHead=()=>run('git',['rev-parse','HEAD']).trim()){
 assert.equal(env.FLEETUM_STAGING_TRUSTED_WORKFLOW_SHA,env.GITHUB_WORKFLOW_SHA,'Current workflow is not approved');
 assert.equal(getHead(),env.GITHUB_WORKFLOW_SHA,'Trusted checkout differs from the approved workflow');
 assert.equal(env.GITHUB_RUN_ATTEMPT,'1','A new dispatch is required instead of retrying a Platform operation');
 assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch','Explicit workflow dispatch required');
 assert.equal(env.GITHUB_WORKFLOW,'Deploy Platform Staging','Unexpected workflow invocation');
 assert.ok(positiveId(env.GITHUB_RUN_ID),'Valid workflow run required');
 const a=JSON.parse(env.FLEETUM_PLATFORM_APPROVAL_JSON||'null');assertApproval(a,contextFromEnv(env));return a;
}
function verifiedFiles(directory,a,context){
 assert.deepEqual(json(path.join(directory,'approval.json')),a,'Artifact approval differs from protected configuration');
 const metadata=json(path.join(directory,'run-metadata.json'));
 const parent=json(path.join(directory,'parent/staging-release.json'));
 const uiCI=json(path.join(directory,'ui-ci/ci-source.json')),controlCI=json(path.join(directory,'control-ci/ci-source.json'));
 const priorFile=path.join(directory,'prior/staging-release.json');const prior=existsSync(priorFile)?json(priorFile):undefined;
 verifyDownloaded(parent,uiCI,controlCI,metadata,a,context,prior);
 return {metadata,parent,uiCI,controlCI,prior};
}
function sshFiles(env,fn){
 assert.ok(validateSshTarget(env.FLEETUM_STAGING_HOST,env.FLEETUM_STAGING_USER).ok,'Invalid staging SSH target');
 assert.ok(env.FLEETUM_STAGING_SSH_KEY?.trim()&&env.FLEETUM_STAGING_KNOWN_HOSTS?.trim(),'Protected SSH material required');
 const dir=mkdtempSync(path.join(tmpdir(),'fleetum-platform-ssh-'));
 try{
  const key=path.join(dir,'key'),known=path.join(dir,'known_hosts');writeFileSync(key,env.FLEETUM_STAGING_SSH_KEY.replace(/\\n/g,'\n').trim()+'\n',{mode:0o600});writeFileSync(known,env.FLEETUM_STAGING_KNOWN_HOSTS.trim()+'\n',{mode:0o600});
  const options=['-F','/dev/null','-o','GlobalKnownHostsFile=/dev/null','-o',`UserKnownHostsFile=${known}`,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-o','ConnectTimeout=20','-i',key];
  return fn({options,target:`${env.FLEETUM_STAGING_USER}@${env.FLEETUM_STAGING_HOST}`});
 }finally{rmSync(dir,{recursive:true,force:true});}
}
export function executeApply(request,env=process.env,execute=run){
 assert.ok(positiveId(request.runId),'Invalid run identity');
 return sshFiles(env,({options,target})=>{
  const remote=`/opt/fleetum-staging/app/.deploy-platform/${request.runId}`;
  // Only a validated numeric suffix is interpolated in the fixed staging path.
  execute('ssh',[...options,target,`set -eu; umask 077; test -d /opt/fleetum-staging/app; test "$(readlink -f /opt/fleetum-staging/app)" = /opt/fleetum-staging/app; test ! -L /opt/fleetum-staging/app/.deploy-platform; mkdir -p /opt/fleetum-staging/app/.deploy-platform; mkdir '${remote}'`]);
  execute('scp',[...options,path.join(root,'apply.py'),`${target}:${remote}/apply.py`]);
  execute('scp',[...options,path.join(root,'../staging/check-platform-health.sh'),`${target}:${remote}/health.sh`]);
  return JSON.parse(execute('ssh',[...options,target,`sudo -n python3 '${remote}/apply.py'`],{input:JSON.stringify(request),timeout:300000}));
 });
}
export function createCompositeProof({approval:a,files,prepared,applied,operation,runId}) {
 assert.ok(positiveId(runId),'Completed run ID required');
 assert.deepEqual(Object.keys(prepared).sort(),['targetImage','manifestSha256','parentStaticSha256','targetStaticSha256','parentWebsiteSha256','targetWebsiteSha256'].sort(),'Prepared image fields invalid');
 const proof={schemaVersion:2,kind:'platform-overlay',operation,completed:true,isolationPolicyVersion:1,repository:a.repository,releaseSha:a.appSha,uiSha:a.uiSha,controlSha:a.controlSha,deployRunId:Number(runId),ciRunId:Number(a.uiCiRunId),backendImage:a.backendImage,frontendImage:operation==='install'?prepared.targetImage:a.parentFrontend,parent:files.parent,uiCI:files.uiCI,controlCI:files.controlCI,manifestSha256:prepared.manifestSha256,parentStaticSha256:prepared.parentStaticSha256,targetStaticSha256:applied.targetStaticSha256,parentWebsiteSha256:prepared.parentWebsiteSha256,targetWebsiteSha256:prepared.targetWebsiteSha256,...(files.prior?{priorOverlay:files.prior,rolledBackRunId:files.prior.deployRunId}:{})};
 return proof;
}
export function driver(mode,directory,env=process.env){
 const a=readApproval(env),context=contextFromEnv(env),files=verifiedFiles(directory,a,context),operation=env.PLATFORM_OPERATION;
 assert.ok(['install','rollback'].includes(operation),'Unsupported operation');
 assert.equal(operation==='rollback',!!files.prior,'Prior overlay must match the selected operation');
 if(mode==='verify'){
  assert.equal(operation==='rollback',!!files.prior,'Prior overlay must match the selected operation');
  put(path.join(directory,'verified.json'),{approval:a,operation,source:a.uiSha});return;
 }
 if(mode==='build'){
  assert.equal(operation,'install','Only install builds a new image');
  assert.ok(positiveId(env.GITHUB_RUN_ID),'Run ID required');
  run('python3',['-c',`import sys,json;sys.path.insert(0,sys.argv[1]);import image;image.build(sys.argv[2],sys.argv[3],json.load(open(sys.argv[4])),sys.argv[5])`,root,path.resolve('ui-dist'),path.resolve('overlay-build'),path.join(directory,'approval.json'),env.GITHUB_RUN_ID]);
  return;
 }
 if(mode!=='apply')throw new Error('Unknown Platform control operation');
 const manifestText=readFileSync(path.join(directory,'package-manifest.json'),'utf8');
 const prepared=json(path.join(directory,'prepared-image.json'));
 assert.equal(createHash('sha256').update(manifestText).digest('hex'),prepared.manifestSha256,'Build manifest hash mismatch');
 const oldFrontend=operation==='install'?a.parentFrontend:files.prior.frontendImage;
 const before=captureRuntime({releaseSha:a.appSha,backendImage:a.backendImage,frontendImage:oldFrontend},{env});
 put(path.join(directory,'runtime-before.json'),before);
 let applied;
 try {
  applied=executeApply({schemaVersion:1,operation,runId:env.GITHUB_RUN_ID,approval:a,preparedImage:prepared,manifestText,beforeRuntime:before,configHashes:files.metadata.configHashes,...(files.prior?{priorOverlay:files.prior}:{})},env);
 } catch(error) {
  // A single read-only observation may preserve evidence after a partial apply;
  // no second switch or implicit rollback is attempted.
  try { put(path.join(directory,'runtime-after-failure.json'),captureRuntime({releaseSha:a.appSha,backendImage:a.backendImage,frontendImage:operation==='install'?prepared.targetImage:a.parentFrontend},{env})); } catch { /* Unconfirmed runtime is never declared successful. */ }
  throw error;
 }
 const target=operation==='install'?prepared.targetImage:a.parentFrontend;
 assert.ok(applied.completed===true&&applied.backendUnchanged===true&&applied.targetImage===target,'Remote transaction proof invalid');
 assert.equal(applied.targetStaticSha256,operation==='install'?prepared.targetStaticSha256:a.baselineTreeSha256,'Remote static tree differs from build');
 assert.equal(applied.websiteSha256,prepared.parentWebsiteSha256,'Remote website differs from build');
 const after=captureRuntime({releaseSha:a.appSha,backendImage:a.backendImage,frontendImage:target},{env});
 const unchanged=verifyRuntimeContinuity({...before,frontend:after.frontend},after);assert.ok(unchanged.ok,'Backend runtime continuity was lost');
 put(path.join(directory,'runtime-after.json'),after);
 const proof=createCompositeProof({approval:a,files,prepared,applied,operation,runId:env.GITHUB_RUN_ID});
 put(path.join(directory,'staging-release.json'),proof);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{assert.equal(process.argv.length,4,'Expected mode and proof directory');driver(process.argv[2],process.argv[3]);console.log('Platform control step completed.');}
 catch{console.error('Platform control validation or execution failed; no automatic retry/rollback.');process.exitCode=1;}
}
