import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { REQUIRED_CI_JOBS, verifyCIProof } from '../ci-release-identity.mjs';

const yaml = createRequire(import.meta.url)('js-yaml');
const workflowRoot = process.env.CONTROL_WORKFLOW_ROOT ? new URL(`file://${process.env.CONTROL_WORKFLOW_ROOT}/`) : new URL('../../.github/workflows/', import.meta.url);
const load = name => yaml.load(readFileSync(new URL(name, workflowRoot), 'utf8'));
const workflow = load('deploy-production.yml');
const sha = 'a'.repeat(40);
const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_SHA: sha, CHECKOUT_SHA: sha, RELEASE_SHA: sha,
  FLEETUM_PRODUCTION_TRUSTED_WORKFLOW_SHA: sha, FLEETUM_PRODUCTION_APPROVED_RELEASE_SHA: sha,
  RELEASE_CONFIRM: 'RELEASE_FLEETUM_PRODUCTION' };
const policy = async () => import('../production-release-policy.mjs');

for (const event of ['push', 'pull_request', 'workflow_run', 'repository_dispatch']) {
  test(`${event} cannot start publication or remote deployment`, () => {
    assert.equal(Object.hasOwn(workflow.on, event), false);
    assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  });
}

test('manual release requires an exact SHA and explicit confirmation', () => {
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.equal(inputs.ref.required, true);
  assert.equal(inputs.ref.default, undefined);
  assert.equal(inputs.confirm.required, true);
  assert.equal(inputs.confirm.default, undefined);
});

test('all publishing and SSH jobs depend on the protected release gate', () => {
  const gate = workflow.jobs['resolve-release'];
  assert.equal(gate.environment, 'production');
  assert.match(gate.if, /github.event_name == 'workflow_dispatch'/);
  assert.match(gate.if, /github.ref == 'refs\/heads\/main'/);
  for (const name of ['sast', 'build-images', 'deploy']) {
    const needs = [workflow.jobs[name].needs].flat();
    assert.ok(needs.includes('resolve-release'), name);
  }
  assert.ok([workflow.jobs['build-images'].needs].flat().includes('sast'));
  assert.equal(gate.permissions.packages, undefined);
  assert.equal(workflow.concurrency.group, 'fleetum-production');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
});

test('the gate verifies protected controls, exact main CI and actual source proof before outputs', () => {
  const steps = workflow.jobs['resolve-release'].steps;
  assert.equal(steps[0].with.ref, '${{ github.workflow_sha }}');
  assert.equal(steps[0].with['persist-credentials'], false);
  const source = steps.map(s => s.run || s.with?.script || '').join('\n');
  assert.match(source, /production-release-policy\.mjs/);
  assert.match(source, /verifyProductionCIRun/);
  assert.match(source, /ci-release-identity\.mjs verify/);
  const verify = steps.findIndex(s => s.run?.includes('ci-release-identity.mjs verify'));
  const output = steps.findIndex(s => s.run?.includes('release_sha='));
  assert.ok(verify >= 0 && output > verify);
});

test('valid release policy accepts only the approved current main revision', async () => {
  const { verifyProductionReleasePolicy } = await policy();
  assert.equal(verifyProductionReleasePolicy(env).ok, true);
  for (const changes of [{ RELEASE_SHA: 'main' }, { RELEASE_SHA: 'b'.repeat(40) },
    { RELEASE_CONFIRM: '' }, { GITHUB_EVENT_NAME: 'workflow_run' },
    { GITHUB_REF: 'refs/heads/codex/test' }, { CHECKOUT_SHA: 'b'.repeat(40) },
    { GITHUB_WORKFLOW_SHA: 'b'.repeat(40) }, { FLEETUM_PRODUCTION_TRUSTED_WORKFLOW_SHA: '' },
    { FLEETUM_PRODUCTION_APPROVED_RELEASE_SHA: '' }]) {
    assert.equal(verifyProductionReleasePolicy({ ...env, ...changes }).ok, false, JSON.stringify(changes));
  }
});

test('actual CI rejects wrong source, skipped gates, PR proof and foreign repository', async () => {
  const { verifyProductionCIRun } = await policy();
  const run = { id: 123, head_sha: sha, status: 'completed', conclusion: 'success', event: 'push',
    head_branch: 'main', head_repository: { full_name: 'Silviomasuccio6/Fleetum' }, path: '.github/workflows/ci.yml' };
  const expected = { repository: 'Silviomasuccio6/Fleetum', sourceSha: sha };
  assert.equal(verifyProductionCIRun(run, expected).ok, true);
  for (const changes of [{ head_sha: 'b'.repeat(40) }, { status: 'queued' }, { conclusion: 'skipped' },
    { event: 'pull_request' }, { head_branch: 'codex/test' }, { id: 0 },
    { path: '.github/workflows/other.yml' }, { head_repository: { full_name: 'other/repo' } }]) {
    assert.equal(verifyProductionCIRun({ ...run, ...changes }, expected).ok, false);
  }
});

test('complete source attestation refuses missing or skipped individual CI gates', () => {
  const proof = { schemaVersion: 1, repository: 'Silviomasuccio6/Fleetum', runId: '123', sourceSha: sha,
    checkoutSha: sha, event: 'push', jobResults: Object.fromEntries(REQUIRED_CI_JOBS.map(name => [name, { result: 'success' }])) };
  const expected = { repository: proof.repository, runId: '123', sourceSha: sha };
  assert.equal(verifyCIProof(proof, expected), true);
  for (const name of REQUIRED_CI_JOBS) {
    const missing = structuredClone(proof); delete missing.jobResults[name];
    const skipped = structuredClone(proof); skipped.jobResults[name].result = 'skipped';
    assert.throws(() => verifyCIProof(missing, expected));
    assert.throws(() => verifyCIProof(skipped, expected));
  }
  assert.throws(() => verifyCIProof({ ...proof, checkoutSha: 'b'.repeat(40) }, expected));
});

test('CI lookup stops without release outputs when main changes or proof is ineligible', async () => {
  const script = workflow.jobs['resolve-release'].steps.find(s => s.name === 'Require exact successful current main CI')?.with.script;
  assert.ok(script);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const execute = new AsyncFunction('github', 'context', 'core', 'process', script);
  const run = { id: 123, head_sha: sha, status: 'completed', conclusion: 'success', event: 'push',
    head_branch: 'main', head_repository: { full_name: 'Silviomasuccio6/Fleetum' }, path: '.github/workflows/ci.yml' };
  for (const [head, runs, accepted] of [[sha, [run], true], ['b'.repeat(40), [run], false],
    [sha, [{ ...run, event: 'pull_request' }], false], [sha, [], false]]) {
    const outputs = [];
    const github = { rest: { repos: { get: async () => ({ data: { default_branch: 'main' } }),
      getCommit: async () => ({ data: { sha: head } }) }, actions: {
      listWorkflowRuns: async params => { assert.equal(params.head_sha, sha); assert.equal(params.event, 'push'); return { data: { workflow_runs: runs } }; } } } };
    const args = [github, { repo: { owner: 'Silviomasuccio6', repo: 'Fleetum' } },
      { setOutput: (...values) => outputs.push(values) }, { env: { RELEASE_SHA: sha, GITHUB_WORKSPACE: new URL('../../', import.meta.url).pathname } }];
    if (accepted) { await execute(...args); assert.deepEqual(outputs, [['run_id', '123']]); }
    else { await assert.rejects(execute(...args)); assert.deepEqual(outputs, []); }
  }
});

test('workflow scripts parse, immutable checkouts are consistent and no latest tag is published', () => {
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps ?? []) {
    if (step.run) assert.equal(spawnSync('/bin/bash', ['-n'], { input: step.run, encoding: 'utf8', timeout: 5000 }).status, 0, step.name);
    if (step.uses?.startsWith('actions/github-script')) {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      assert.doesNotThrow(() => new AsyncFunction('github', 'context', 'core', 'require', step.with.script));
    }
    if (step.uses?.startsWith('actions/checkout')) assert.equal(step.with['persist-credentials'], false);
    if (step.uses?.startsWith('docker/build-push-action')) assert.doesNotMatch(step.with.tags, /latest/);
  }
});

test('production SSH trust is pinned instead of collected during deployment', () => {
  const step = workflow.jobs.deploy.steps.find(s => s.name === 'Configure SSH key');
  assert.equal(step.env.FLEETUM_VPS_KNOWN_HOSTS, '${{ secrets.FLEETUM_VPS_KNOWN_HOSTS }}');
  assert.doesNotMatch(step.run, /ssh-keyscan/);
  assert.match(step.run, /ssh-keygen -F/);
  assert.match(step.run, /printf '%s\\n' "\$FLEETUM_VPS_KNOWN_HOSTS"/);
});

test('CI exercises the production gate and ingress tests on every checked-out proposal', () => {
  const ci = load('ci.yml');
  assert.ok(ci.on.push && ci.on.pull_request);
  const steps = ci.jobs.verify.steps;
  const controls = steps.findIndex(s => s.name === 'Test isolated production and ingress controls');
  assert.ok(controls > steps.findIndex(s => s.name === 'Install dependencies'));
  assert.ok(controls < steps.findIndex(s => s.name === 'Generate Prisma client'));
  assert.equal(steps[controls].run, 'node --test --test-concurrency=1 ops/tests/*.test.mjs');
  for (const gate of ['secret-scan', 'sast', 'verify', 'tenant-isolation', 'lighthouse']) assert.ok(ci.jobs[gate]);
});
