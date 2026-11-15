import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const yaml=require('js-yaml');
const source=readFileSync(new URL('../../.github/workflows/deploy-platform-staging.yml',import.meta.url),'utf8');
const workflow=yaml.load(source);
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
