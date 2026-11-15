import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require=createRequire(import.meta.url),yaml=require('js-yaml');
const text=readFileSync(new URL('../../.github/workflows/platform-production-candidate-ci.yml',import.meta.url),'utf8');
const workflow=yaml.load(text);

test('candidate checks are independent read-only CI, never a privileged or production event',()=>{
 assert.deepEqual(Object.keys(workflow.on).sort(),['pull_request','push']);
 assert.deepEqual(workflow.permissions,{contents:'read'});
 for(const job of Object.values(workflow.jobs)) {
  assert.equal(job.environment,undefined);assert.equal(job.permissions,undefined);assert.equal(job['runs-on'],'ubuntu-24.04');
 }
 assert.doesNotMatch(text,/secrets\.|packages:\s*write|SSH_KEY|workflow_run|pull_request_target|Deploy Staging/);
});
test('all jobs check out the exact control source with no persisted credentials',()=>{
 for(const job of Object.values(workflow.jobs)) {
  const step=job.steps.find(s=>s.uses==='actions/checkout@v6');
  assert.equal(step.with.ref,'${{ env.CI_CONTROL_SHA }}');assert.equal(step.with['persist-credentials'],false);assert.equal(step.with['fetch-depth'],0);
 }
});
test('both frontend variants are mandatory and use bounded matrix values through the environment',()=>{
 assert.deepEqual(workflow.jobs.frontend.strategy.matrix.role,['satin','fallback']);
 assert.equal(workflow.jobs.frontend.strategy['fail-fast'],false);
 const build=workflow.jobs.frontend.steps.find(s=>s.name?.startsWith('Compile'));
 assert.equal(build.env.CANDIDATE_ROLE,'${{ matrix.role }}');assert.doesNotMatch(build.run,/\$\{\{/);
});
test('candidate proof requires backend, both frontends, actual image and actual-source security',()=>{
 assert.deepEqual([...workflow.jobs['candidate-proof'].needs].sort(),['backend','frontend','image','security','sources']);
 assert.match(workflow.jobs.image.steps.find(s=>s.name?.startsWith('Build and smoke')).run,/ci.mjs image/);
 assert.match(workflow.jobs.security.steps.find(s=>s.name?.startsWith('Scan actual')).run,/ci.mjs security/);
});
test('the synthetic credential file and upload fixtures cannot enter CI artifacts',()=>{
 for(const job of Object.values(workflow.jobs))for(const step of job.steps)if(step.uses==='actions/upload-artifact@v4'){
  assert.doesNotMatch(step.with.path,/platform-db\.json|synthetic-uploads|source\//);assert.equal(step.with['if-no-files-found']==='ignore',step.name?.startsWith('Retain')??false);
 }
 const cleanup=workflow.jobs.backend.steps.find(s=>s.name?.startsWith('Remove the synthetic'));
 assert.equal(cleanup.if,'always()');
});
test('all candidate shell steps parse without executing any of them',()=>{
 for(const job of Object.values(workflow.jobs))for(const step of job.steps)if(step.run){
  const r=spawnSync('bash',['-n'],{input:step.run,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 }
});
