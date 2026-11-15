import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const yaml=require('js-yaml');
const source=readFileSync(new URL('../../.github/workflows/deploy-platform-staging.yml',import.meta.url),'utf8');
const workflow=yaml.load(source);
const bindingOutputs={FLEETUM_STAGING_TRUSTED_WORKFLOW_SHA:'control_sha',FLEETUM_STAGING_APPROVED_RELEASE_SHA:'app_sha',FLEETUM_PLATFORM_APPROVED_UI_SHA:'ui_sha',FLEETUM_PLATFORM_APPROVAL_JSON:'approval_json',E2E_STAGING_RUN_ID:'parent_run_id'};
test('protected environment bindings are read in approved steps and never inherited before environment resolution',()=>{
 assert.deepEqual(workflow.env,{PLATFORM_OPERATION:'${{ inputs.operation }}'});
 const resolve=workflow.jobs.resolve;
 const sources=resolve.steps.find(s=>s.id==='sources');
 const verify=resolve.steps.find(s=>s.run==='node ops/platform-release/driver.mjs verify proofs');
 const apply=workflow.jobs.apply.steps.find(s=>s.name?.startsWith('Apply once'));
 for(const [name,output] of Object.entries(bindingOutputs)){
  assert.equal(sources.env[name],`\${{ vars.${name} }}`);
  assert.equal(apply.env[name],`\${{ vars.${name} }}`);
  assert.equal(verify.env[name],`\${{ steps.sources.outputs.${output} }}`);
  assert.equal(resolve.outputs[output],`\${{ steps.sources.outputs.${output} }}`);
 }
 assert.equal(workflow.jobs['prepare-target'].environment,undefined);
 assert.doesNotMatch(JSON.stringify(workflow.jobs['prepare-target']),/vars\.|secrets\./);
 assert.doesNotMatch(JSON.stringify(workflow.jobs['build-ui']),/FLEETUM_PLATFORM_APPROVAL_JSON|FLEETUM_STAGING_/);
 assert.match(sources.with.script,/approval_json: JSON.stringify\(approval\)/);
 assert.match(sources.with.script,/control_sha: approval.controlSha/);
 assert.match(sources.with.script,/app_sha: approval.appSha/);
});
test('publisher receives a complete validated tuple without access to staging variables and still rejects stale bindings',async()=>{
 const {fixture}=await import('./helpers/platform-release-fixture.mjs');
 const {readApproval}=await import('../platform-release/driver.mjs');
 const {approval:a}=fixture();
 const outputs={control_sha:a.controlSha,app_sha:a.appSha,ui_sha:a.uiSha,approval_json:JSON.stringify(a),parent_run_id:a.parentRunId};
 const env={GITHUB_REPOSITORY:a.repository,GITHUB_WORKFLOW_SHA:a.controlSha,GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_WORKFLOW:'Deploy Platform Staging',GITHUB_RUN_ID:'21'};
 for(const [name,output] of Object.entries(bindingOutputs)){
  assert.equal(workflow.jobs['prepare-target'].env?.[name],`\${{ needs.resolve.outputs.${output} }}`);
  env[name]=outputs[output];
 }
 assert.deepEqual(readApproval(env,()=>a.controlSha),a);
 assert.throws(()=>readApproval({...env,FLEETUM_PLATFORM_APPROVED_UI_SHA:''},()=>a.controlSha));
 assert.throws(()=>readApproval({...env,FLEETUM_STAGING_APPROVED_RELEASE_SHA:'0'.repeat(40)},()=>a.controlSha));
 // The install step reads current protected values again, so a changed approval
 // cannot be silently replaced by the publisher's earlier resolved outputs.
 assert.notEqual(workflow.jobs.apply.steps.find(s=>s.name?.startsWith('Apply once')).env.FLEETUM_PLATFORM_APPROVAL_JSON,workflow.jobs['prepare-target'].env.FLEETUM_PLATFORM_APPROVAL_JSON);
});
test('Platform workflow is dispatch-only, serializes with staging and protects both approval boundaries',()=>{
 assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch']);assert.equal(workflow.concurrency.group,'fleetum-staging');assert.equal(workflow.concurrency['cancel-in-progress'],false);
 assert.equal(workflow.jobs.resolve.environment,'staging');assert.equal(workflow.jobs.apply.environment,'staging');
 assert.match(workflow.jobs.resolve.if,/CHANGE_PLATFORM_STAGING/);
});
test('UI compilation has no package write or SSH credentials; publication never executes UI source',()=>{
 const build=workflow.jobs['build-ui'];assert.equal(build.environment,undefined);assert.equal(build.permissions,undefined);
 assert.doesNotMatch(JSON.stringify(build),/SSH_KEY|secrets\.|packages.*write/);
 const publish=workflow.jobs['prepare-target'];assert.equal(publish.permissions.packages,'write');
 assert.doesNotMatch(JSON.stringify(publish),/npm (?:ci|run)|SSH_KEY/);
 assert.match(JSON.stringify(publish),/extract.py/);
});
test('only trusted controls are checked out in publisher/apply and no full deploy is invoked',()=>{
 for(const name of ['prepare-target','apply']){
  const checkout=workflow.jobs[name].steps.find(s=>s.uses==='actions/checkout@v6');assert.equal(checkout.with.ref,'${{ github.workflow_sha }}');assert.equal(checkout.with['persist-credentials'],false);
 }
 assert.doesNotMatch(source,/run-deploy\.sh|migrate deploy|bootstrapSynthetic|deploy-production/);
 const apply=workflow.jobs.apply;assert.equal(apply.steps.find(s=>s.name?.startsWith('Apply once')).run,'node ops/platform-release/driver.mjs apply proofs');
});
test('existing Nightly keeps the parent run selector and adds an explicit overlay without a legacy fallback',()=>{
 const nightly=yaml.load(readFileSync(new URL('../../.github/workflows/e2e-nightly.yml',import.meta.url),'utf8'));
 assert.ok(nightly.on.workflow_dispatch.inputs.stagingRunId);assert.equal(nightly.on.workflow_dispatch.inputs.platformRunId.required,false);
 assert.match(nightly.jobs.playwright.env.E2E_PLATFORM_RUN_ID,/inputs.platformRunId/);
 const verify=nightly.jobs.playwright.steps.find(s=>s.name==='Verify successful staging deploy and release artifact');
 assert.match(verify.with.script,/collectE2EOverlayMetadata/);assert.match(verify.with.script,/verifyDeployRun/);
});

test('all GitHub scripts and shell steps parse without executing them',async()=>{
 const {spawnSync}=await import('node:child_process');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 for(const document of [workflow,yaml.load(readFileSync(new URL('../../.github/workflows/e2e-nightly.yml',import.meta.url),'utf8'))]){
  for(const job of Object.values(document.jobs))for(const step of job.steps){
   if(step.uses?.startsWith('actions/github-script@'))assert.doesNotThrow(()=>new AsyncFunction('github','context','core','require',step.with.script));
   if(step.run){const r=spawnSync('bash',['-n'],{input:step.run,encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
  }
 }
});
