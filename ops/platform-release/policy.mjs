import assert from 'node:assert/strict';
import { verifyCIProof } from '../ci-release-identity.mjs';
export const SHA=/^[0-9a-f]{40}$/;
export const HASH=/^[0-9a-f]{64}$/;
export const imagePattern=role=>new RegExp(`^ghcr\\.io/silviomasuccio6/fleetum-${role}@sha256:[0-9a-f]{64}$`);
export const positiveId=value=>/^[1-9][0-9]*$/.test(String(value??''))&&Number.isSafeInteger(Number(value));
const checked=fn=>{try{fn();return {ok:true,errors:[]};}catch(error){return {ok:false,errors:[error.message]};}};
const approvalKeys=['schemaVersion','repository','appSha','uiSha','controlSha','parentControlSha','parentRunId','uiCiRunId','controlCiRunId','parentFrontend','backendImage','baselineTreeSha256','ingressMode'];
export function assertApproval(a,c) {
 assert.ok(a&&typeof a==='object'&&!Array.isArray(a),'Platform approval is required');
 assert.deepEqual(Object.keys(a).sort(),[...approvalKeys].sort(),'Platform approval fields differ from the reviewed schema');
 assert.equal(a.schemaVersion,1,'Platform approval version invalid');
 assert.equal(a.repository,c.repository,'Approval repository mismatch');
 assert.equal(a.repository.toLowerCase(),'silviomasuccio6/fleetum','Unsupported Platform repository');
 for(const k of ['appSha','uiSha','controlSha','parentControlSha'])assert.ok(SHA.test(a[k]??''),'Full immutable source identities required');
 assert.equal(a.controlSha,c.controlSha,'Current Platform control revision not approved');
 assert.equal(a.appSha,c.appSha??c.releaseSha,'Application source mismatch');
 assert.equal(a.uiSha,c.approvedUiSha,'UI source not explicitly approved');
 assert.equal(a.parentRunId,String(c.parentRunId??c.stagingRunId),'Parent deploy selector mismatch');
 for(const k of ['parentRunId','uiCiRunId','controlCiRunId'])assert.ok(positiveId(a[k]),'Positive safe run IDs required');
 assert.ok(imagePattern('frontend').test(a.parentFrontend??''),'Immutable parent frontend required');
 assert.ok(imagePattern('backend').test(a.backendImage??''),'Immutable backend required');
 assert.ok(HASH.test(a.baselineTreeSha256??''),'Approved baseline static tree required');
 assert.ok(['dedicated','shared'].includes(a.ingressMode),'Unsupported staging ingress mode');
}
export const validateApproval=(a,c)=>checked(()=>assertApproval(a,c));
export function assertRun(run,workflow,{repository,runId,controlSha,path,name}) {
 assert.ok(positiveId(runId)&&Number(run?.id)===Number(runId),'Run selector mismatch');
 assert.ok(positiveId(workflow?.id)&&run?.workflow_id===workflow.id&&workflow.path===path&&workflow.name===name,'Unapproved workflow identity');
 assert.ok(run?.status==='completed'&&run.conclusion==='success'&&run.event==='workflow_dispatch','A successful completed dispatch is required');
 assert.equal(run?.head_sha,controlSha,'Workflow revision mismatch');
 assert.equal(run?.repository?.full_name,repository,'Run repository mismatch');
 assert.equal(run?.head_repository?.full_name,repository,'Run head repository mismatch');
}
export function assertCIRun(run,proof,{repository,sourceSha,runId}) {
 assert.equal(Number(run?.id),Number(runId),'CI run selector mismatch');
 assert.ok(run?.path==='.github/workflows/ci.yml'&&run.status==='completed'&&run.conclusion==='success','Exact successful CI workflow required');
 assert.equal(run?.head_sha,sourceSha,'CI source mismatch');
 assert.equal(run?.repository?.full_name,repository,'CI repository mismatch');
 assert.equal(run?.head_repository?.full_name,repository,'CI head repository mismatch');
 assert.equal(run?.event,proof?.event,'CI event mismatch');
 verifyCIProof(proof,{repository,sourceSha,runId});
}
// Parent legacy run/proof validation remains in staging-release-binding.mjs.
// This function validates the additional edge, never an alternative to the parent.
export function verifyOverlayProof(p,m,a,c) {
 return checked(()=>{
  assertApproval(a,c);
  assert.ok(positiveId(c.platformRunId),'Explicit Platform run selector required');
  assert.ok(p?.schemaVersion===2&&p.kind==='platform-overlay'&&['install','rollback'].includes(p.operation)&&p.completed===true,'Unsupported or incomplete Platform overlay');
  assert.equal(p.isolationPolicyVersion,1,'Platform isolation policy required');
  assertRun(m?.platform?.run,m?.platform?.workflow,{repository:c.repository,runId:c.platformRunId,controlSha:a.controlSha,path:'.github/workflows/deploy-platform-staging.yml',name:'Deploy Platform Staging'});
  for(const [field,value] of Object.entries({repository:a.repository,releaseSha:a.appSha,uiSha:a.uiSha,controlSha:a.controlSha,backendImage:a.backendImage}))assert.equal(p[field],value,'Platform proof identity mismatch');
  assert.equal(String(p.deployRunId),String(c.platformRunId),'Platform proof run mismatch');
  assert.equal(String(p.ciRunId),a.uiCiRunId,'Platform proof CI mismatch');
  assert.equal(p.parent?.frontendImage,a.parentFrontend,'Parent frontend mismatch');
  assert.equal(p.parent?.backendImage,a.backendImage,'Parent backend mismatch');
  assert.ok(imagePattern('frontend').test(p.frontendImage??''),'Immutable frontend target required');
  if(p.operation==='install') {
   assert.notEqual(p.frontendImage,a.parentFrontend,'New immutable frontend target required');
   assert.equal(p.priorOverlay,undefined,'Install cannot include a previous overlay');
  } else {
   assert.equal(p.frontendImage,a.parentFrontend,'Rollback must restore the approved parent');
   assert.equal(p.targetStaticSha256,a.baselineTreeSha256,'Rollback static tree must equal parent');
   assert.ok(p.priorOverlay?.operation==='install'&&positiveId(p.rolledBackRunId),'Rollback requires a completed prior install');
   const prior=verifyOverlayProof(p.priorOverlay,{...m,platform:m?.priorPlatform},a,{...c,platformRunId:String(p.rolledBackRunId)});
   assert.ok(prior.ok,'Prior overlay proof invalid');
   assert.equal(p.manifestSha256,p.priorOverlay.manifestSha256,'Rollback manifest mismatch');
   assert.deepEqual(p.priorOverlay.parent,p.parent,'Rollback parent proof mismatch');
  }
  assert.equal(p.parentStaticSha256,a.baselineTreeSha256,'Parent static hashes drifted');
  for(const k of ['manifestSha256','targetStaticSha256','parentWebsiteSha256','targetWebsiteSha256'])assert.ok(HASH.test(p[k]??''),'Static build proof hashes required');
  assert.equal(p.parentWebsiteSha256,p.targetWebsiteSha256,'Public website must be preserved');
  assertCIRun(m?.uiCI,p.uiCI,{repository:a.repository,sourceSha:a.uiSha,runId:a.uiCiRunId});
  assertCIRun(m?.controlCI,p.controlCI,{repository:a.repository,sourceSha:a.controlSha,runId:a.controlCiRunId});
 });
}
