import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertApproval,assertRun,assertCIRun,positiveId,verifyOverlayProof } from './policy.mjs';
import { verifyDeployRun,verifyReleaseProof } from '../e2e/staging-release-binding.mjs';
const runMetadata=r=>({id:r.id,workflow_id:r.workflow_id,head_sha:r.head_sha,status:r.status,conclusion:r.conclusion,event:r.event,path:r.path,repository:{full_name:r.repository?.full_name},head_repository:{full_name:r.head_repository?.full_name}});
export async function resolveRuns(github,approval,context,{operation='install',priorRunId}={}) {
 assertApproval(approval,context);assert.ok(['install','rollback'].includes(operation),'Invalid Platform operation');
 if(operation==='rollback')assert.ok(positiveId(priorRunId),'Rollback requires prior Platform run ID');
 else assert.ok(!priorRunId,'Install does not accept a prior Platform run');
 const [owner,repo]=context.repository.split('/');
 const getRun=async id=>runMetadata((await github.rest.actions.getWorkflowRun({owner,repo,run_id:Number(id)})).data);
 const getWorkflow=async name=>{const w=(await github.rest.actions.getWorkflow({owner,repo,workflow_id:name})).data;return {id:w.id,name:w.name,path:w.path};};
 const parent={run:await getRun(approval.parentRunId),workflow:await getWorkflow('deploy-staging.yml')};
 const check=verifyDeployRun(parent.run,parent.workflow,{repository:context.repository,stagingRunId:approval.parentRunId,controlSha:approval.parentControlSha});assert.ok(check.ok,'Parent deploy is not verified');
 const ci=async(id,sha)=>{
  const r=await getRun(id);
  assert.ok(r.path==='.github/workflows/ci.yml'&&r.head_sha===sha&&r.status==='completed'&&r.conclusion==='success'&&['push','pull_request','workflow_dispatch'].includes(r.event),'Approved source CI is not successful');
  assert.equal(r.repository.full_name,context.repository,'CI repository mismatch');assert.equal(r.head_repository.full_name,context.repository,'CI head repository mismatch');return r;
 };
 const metadata={parent,uiCI:await ci(approval.uiCiRunId,approval.uiSha),controlCI:await ci(approval.controlCiRunId,approval.controlSha)};
 if(operation==='rollback'){
  metadata.priorPlatform={run:await getRun(priorRunId),workflow:await getWorkflow('deploy-platform-staging.yml')};
  assertRun(metadata.priorPlatform.run,metadata.priorPlatform.workflow,{repository:context.repository,runId:priorRunId,controlSha:approval.controlSha,path:'.github/workflows/deploy-platform-staging.yml',name:'Deploy Platform Staging'});
 }
 for(const [runId,name] of [[approval.parentRunId,`staging-release-proof-${approval.parentRunId}`],[approval.uiCiRunId,`ci-source-proof-${approval.uiCiRunId}`],[approval.controlCiRunId,`ci-source-proof-${approval.controlCiRunId}`],...(operation==='rollback'?[[priorRunId,`platform-release-proof-${priorRunId}`]]:[])]){
  const artifacts=await github.paginate(github.rest.actions.listWorkflowRunArtifacts,{owner,repo,run_id:Number(runId),per_page:100});
  assert.equal(artifacts.filter(a=>a.name===name&&!a.expired).length,1,'Exactly one live proof artifact required');
 }
 const configPaths=['docker-compose.staging.yml',...(approval.ingressMode==='shared'?['docker-compose.staging.shared.yml']:[]),`deploy/caddy/Caddyfile.staging${approval.ingressMode==='shared'?'-shared':''}`];
 metadata.configHashes={};
 for(const path of configPaths){
  const {data}=await github.rest.repos.getContent({owner,repo,path,ref:approval.appSha});
  assert.ok(data.type==='file'&&data.encoding==='base64'&&typeof data.content==='string','Canonical app config source unavailable');
  metadata.configHashes[path]=createHash('sha256').update(Buffer.from(data.content,'base64')).digest('hex');
 }
 return metadata;
}
export function verifyDownloaded(parent,uiCI,controlCI,metadata,approval,context,prior) {
 assertApproval(approval,context);
 const checked=verifyReleaseProof(parent,{repository:context.repository,releaseSha:approval.appSha,stagingRunId:approval.parentRunId,controlSha:approval.parentControlSha});assert.ok(checked.ok,'Parent artifact invalid');
 assert.equal(parent.frontendImage,approval.parentFrontend,'Parent frontend mismatch');assert.equal(parent.backendImage,approval.backendImage,'Parent backend mismatch');
 assertCIRun(metadata.uiCI,uiCI,{repository:approval.repository,sourceSha:approval.uiSha,runId:approval.uiCiRunId});
 assertCIRun(metadata.controlCI,controlCI,{repository:approval.repository,sourceSha:approval.controlSha,runId:approval.controlCiRunId});
 if(prior){assert.deepEqual(prior.parent,parent,'Prior overlay parent mismatch');const check=verifyOverlayProof(prior,{...metadata,platform:metadata.priorPlatform},approval,{...context,platformRunId:String(prior.deployRunId)});assert.ok(check.ok&&prior.operation==='install','Prior overlay artifact invalid');}
 return {parent,uiCI,controlCI};
}

export async function platformRunMetadata(github,approval,context,runId){
 assertApproval(approval,context);assert.ok(positiveId(runId),'Explicit Platform run required');
 const [owner,repo]=context.repository.split('/');
 const run=runMetadata((await github.rest.actions.getWorkflowRun({owner,repo,run_id:Number(runId)})).data);
 const raw=(await github.rest.actions.getWorkflow({owner,repo,workflow_id:'deploy-platform-staging.yml'})).data;
 const workflow={id:raw.id,path:raw.path,name:raw.name};
 assertRun(run,workflow,{repository:context.repository,runId,controlSha:approval.controlSha,path:'.github/workflows/deploy-platform-staging.yml',name:'Deploy Platform Staging'});
 const artifacts=await github.paginate(github.rest.actions.listWorkflowRunArtifacts,{owner,repo,run_id:Number(runId),per_page:100});
 assert.equal(artifacts.filter(a=>a.name===`platform-release-proof-${runId}`&&!a.expired).length,1,'Exactly one completed Platform proof artifact required');
 return {run,workflow};
}
export async function collectE2EOverlayMetadata(github,approval,context){
 const metadata=await resolveRuns(github,approval,context);
 metadata.platform=await platformRunMetadata(github,approval,context,context.platformRunId);return metadata;
}
