import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import yaml from 'js-yaml';
import { requestForIngress } from '../staging/ingress-request.mjs';
import { parseArgs } from '../verify-staging-ingress-lifecycle.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = path => createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
const env = {
  GITHUB_WORKFLOW_SHA: 'a'.repeat(40), CHECKOUT_SHA: 'a'.repeat(40),
  FLEETUM_INGRESS_TRUSTED_WORKFLOW_SHA: 'a'.repeat(40), FLEETUM_INGRESS_APPROVED_SOURCE_SHA: 'a'.repeat(40),
  INGRESS_HOST: 'staging-host.example.invalid', INGRESS_USER: 'ubuntu', INGRESS_MODE: 'plan',
  FLEETUM_INGRESS_CADDY_IMAGE: `ghcr.io/silviomasuccio6/fleetum-frontend@sha256:${'b'.repeat(64)}`,
  FLEETUM_INGRESS_BASELINE_COMPOSE_SHA256: hash('../../docker-compose.prod.yml'),
  FLEETUM_INGRESS_BASELINE_CADDY_SHA256: hash('../../deploy/caddy/Caddyfile'),
};
const workflow = yaml.load(readFileSync(new URL('../../.github/workflows/staging-ingress.yml', import.meta.url), 'utf8'));
const steps = workflow.jobs.gateway.steps;

test('Python ingress state machine passes synthetic fault/recovery cases', () => {
  const result = spawnSync('python3', ['-B', 'ops/staging/tests/ingress_control_test.py'], {
    cwd: root, encoding: 'utf8', timeout: 20000,
    env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' }, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran \d+ tests[\s\S]*OK/);
});

test('plan omits all protected contact and mutation inputs', () => {
  const request = requestForIngress({ ...env, FLEETUM_INGRESS_CADDY_EMAIL: 'synthetic@example.invalid', INGRESS_CONFIRM: 'ignored' }, root);
  assert.equal(request.mode, 'plan'); assert.equal(request.sourceSha, env.CHECKOUT_SHA);
  for (const name of ['email', 'confirm', 'planDigest']) assert.equal(Object.hasOwn(request, name), false);
});

for (const [name, changes] of Object.entries({
  'unreviewed control': { FLEETUM_INGRESS_TRUSTED_WORKFLOW_SHA: 'c'.repeat(40) },
  'unreviewed source': { FLEETUM_INGRESS_APPROVED_SOURCE_SHA: 'c'.repeat(40) },
  'different checkout': { CHECKOUT_SHA: 'c'.repeat(40) },
  'SSH injection': { INGRESS_HOST: 'host;false' },
  'mutable image': { FLEETUM_INGRESS_CADDY_IMAGE: 'caddy:latest' },
  'Caddy fingerprint drift': { FLEETUM_INGRESS_BASELINE_CADDY_SHA256: 'c'.repeat(64) },
  'Compose fingerprint drift': { FLEETUM_INGRESS_BASELINE_COMPOSE_SHA256: 'c'.repeat(64) },
  'unsupported mode': { INGRESS_MODE: 'deploy' },
})) test(`request rejects ${name}`, () => assert.throws(() => requestForIngress({ ...env, ...changes }, root)));

for (const mode of ['apply', 'recover']) test(`${mode} requires explicit plan, source and production persistence policy`, () => {
  const complete = { ...env, INGRESS_MODE: mode, INGRESS_CONFIRM: mode === 'apply' ? 'ACTIVATE_STAGING_INGRESS' : 'RECOVER_STAGING_INGRESS',
    INGRESS_PLAN_DIGEST: 'd'.repeat(64), FLEETUM_SHARED_STAGING_INGRESS: mode === 'apply' ? 'true' : 'false',
    PRODUCTION_PERSISTENCE_VERIFIED: 'true', FLEETUM_INGRESS_CADDY_EMAIL: 'synthetic@example.invalid' };
  assert.equal(requestForIngress(complete, root).mode, mode);
  for (const changes of [{ INGRESS_CONFIRM: '' }, { INGRESS_PLAN_DIGEST: '' }, { FLEETUM_INGRESS_CADDY_EMAIL: '' },
    { FLEETUM_INGRESS_CADDY_EMAIL: 'bad@example.invalid\n' }, { PRODUCTION_PERSISTENCE_VERIFIED: 'false' },
    { FLEETUM_SHARED_STAGING_INGRESS: mode === 'apply' ? 'false' : 'true' }]) {
    assert.throws(() => requestForIngress({ ...complete, ...changes }, root));
  }
});

test('workflow locks production, defaults to observation and has no deploy trigger', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.workflow_dispatch.inputs.mode.default, 'plan');
  assert.equal(workflow.concurrency.group, 'fleetum-production'); assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.jobs.gateway.env, undefined); // Uses GitHub's immutable default GITHUB_WORKFLOW_SHA.
  assert.equal(steps[0].with.ref, '${{ github.workflow_sha }}'); assert.equal(steps[0].with['persist-credentials'], false);
});

test('CI source proof and production controls precede SSH keys', () => {
  const transfer = steps.findIndex(s => s.name === 'Pin SSH trust and isolate transfer');
  for (const name of ['Bind reviewed source and controls before SSH secrets', 'Require exact successful CI',
    'Verify actual source proof', 'Verify default production controls persist the ingress']) {
    assert.ok(steps.findIndex(s => s.name === name) < transfer);
  }
  const script = steps.find(s => s.name === 'Pin SSH trust and isolate transfer').run;
  assert.ok(script.indexOf('requestForIngress(process.env)') < script.indexOf('remote=$(ssh'));
  const binding = steps.find(s => s.name === 'Bind reviewed source and controls before SSH secrets').run;
  assert.match(binding, /test "\$PRODUCTION_LOCK_FILE" = \/opt\/fleetum\/deploy.lock/);
});

test('workflow shell and GitHub API scripts parse without execution', () => {
  for (const step of steps) {
    if (step.run) {
      const parsed = spawnSync('/bin/bash', ['-n'], { input: step.run, encoding: 'utf8' });
      assert.equal(parsed.status, 0, `${step.name}: ${parsed.stderr}`);
    }
    if (step.uses?.startsWith('actions/github-script')) {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      assert.doesNotThrow(() => new AsyncFunction('github', 'context', 'core', step.with.script));
    }
  }
});

test('workflow transfers secret input on stdin and retains only result', () => {
  const execute = steps.find(s => s.name === 'Execute bound gateway operation').run;
  assert.match(execute, /ingress-request\.mjs \| ssh/); assert.match(execute, /sudo -n python3 -I -B/);
  assert.match(execute, /> ingress-result.json/); assert.doesNotMatch(execute, /tee|printenv|set -x|docker login/);
  const evidence = steps.find(s => s.uses?.startsWith('actions/upload-artifact'));
  assert.equal(evidence.with.path, 'ingress-result.json');
  const cleanup = steps.at(-1); assert.equal(cleanup.if, '${{ always() }}');
  assert.match(cleanup.run, /trap 'rm -rf -- \.ingress-ssh \.ingress-transfer' EXIT/);
});

test('local Docker lifecycle proof requires explicit opt-in and immutable already-local image', () => {
  const args = ['--run-local-synthetic', '--caddy-image', `sha256:${'a'.repeat(64)}`];
  assert.equal(parseArgs(args).image, args[2]);
  for (const input of [[], args.slice(1), [...args, '--live'], ['--run-local-synthetic', '--caddy-image', 'caddy:latest']]) {
    assert.throws(() => parseArgs(input));
  }
});
