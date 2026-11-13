import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { requestForIngress } from '../staging/ingress-request.mjs';

test('ingress binds the observed baseline separately from the future application manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'fleetum-ingress-baseline-'));
  try {
    mkdirSync(join(root, 'deploy/caddy'), { recursive: true });
    mkdirSync(join(root, '.ingress-baseline/deploy/caddy'), { recursive: true });
    const baselineCompose = 'synthetic currently running application manifest';
    const baselineCaddy = 'synthetic currently running gateway';
    writeFileSync(join(root, 'docker-compose.prod.yml'), 'synthetic future application manifest');
    writeFileSync(join(root, 'deploy/caddy/Caddyfile'), 'synthetic future gateway');
    writeFileSync(join(root, 'deploy/caddy/Caddyfile.production-shared'), 'import production-baseline\nimport staging-ingress');
    writeFileSync(join(root, 'deploy/caddy/Caddyfile.staging-ingress'), 'synthetic staging addendum');
    writeFileSync(join(root, '.ingress-baseline/docker-compose.prod.yml'), baselineCompose);
    writeFileSync(join(root, '.ingress-baseline/deploy/caddy/Caddyfile'), baselineCaddy);
    const sha256 = value => createHash('sha256').update(value).digest('hex');
    const env = {
      GITHUB_WORKFLOW_SHA: 'a'.repeat(40), CHECKOUT_SHA: 'a'.repeat(40),
      FLEETUM_INGRESS_TRUSTED_WORKFLOW_SHA: 'a'.repeat(40), FLEETUM_INGRESS_APPROVED_SOURCE_SHA: 'a'.repeat(40),
      FLEETUM_INGRESS_BASELINE_SOURCE_SHA: 'b'.repeat(40), CHECKOUT_BASELINE_SHA: 'b'.repeat(40),
      INGRESS_HOST: 'host.example.invalid', INGRESS_USER: 'ubuntu', INGRESS_MODE: 'plan',
      FLEETUM_INGRESS_CADDY_IMAGE: `ghcr.io/silviomasuccio6/fleetum-frontend@sha256:${'c'.repeat(64)}`,
      FLEETUM_INGRESS_BASELINE_COMPOSE_SHA256: sha256(baselineCompose),
      FLEETUM_INGRESS_BASELINE_CADDY_SHA256: sha256(baselineCaddy)
    };
    const request = requestForIngress(env, root);
    assert.equal(request.baselineSourceSha, env.CHECKOUT_BASELINE_SHA);
    assert.equal(request.sourceSha, env.CHECKOUT_SHA);
    assert.equal(request.bundleHashes.Caddyfile, sha256(baselineCaddy));
    for (const changes of [
      { FLEETUM_INGRESS_BASELINE_SOURCE_SHA: '' }, { FLEETUM_INGRESS_BASELINE_SOURCE_SHA: 'main' },
      { CHECKOUT_BASELINE_SHA: 'd'.repeat(40) }, { FLEETUM_INGRESS_BASELINE_COMPOSE_SHA256: 'd'.repeat(64) },
      { FLEETUM_INGRESS_BASELINE_CADDY_SHA256: 'd'.repeat(64) }
    ]) assert.throws(() => requestForIngress({ ...env, ...changes }, root));
    writeFileSync(join(root, '.ingress-baseline/docker-compose.prod.yml'), 'changed observed baseline');
    assert.throws(() => requestForIngress(env, root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ingress checks out a pinned baseline without credentials and sends only its Caddy baseline', () => {
  const workflow = yaml.load(readFileSync(new URL('../../.github/workflows/staging-ingress.yml', import.meta.url), 'utf8'));
  const steps = workflow.jobs.gateway.steps;
  const checkout = steps.find(s => s.with?.path === '.ingress-baseline');
  assert.ok(checkout, 'a separate immutable checkout is required');
  assert.equal(checkout.with.ref, '${{ vars.FLEETUM_INGRESS_BASELINE_SOURCE_SHA }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.match(steps.find(s => s.name === 'Bind reviewed source and controls before SSH secrets').run, /\^\[a-f0-9\]\{40\}\$/);
  const transfer = steps.find(s => s.name === 'Pin SSH trust and isolate transfer');
  assert.match(transfer.run, /git -C \.ingress-baseline rev-parse HEAD/);
  assert.match(transfer.run, /cp \.ingress-baseline\/deploy\/caddy\/Caddyfile \.ingress-transfer\//);
  assert.doesNotMatch(transfer.run, /cp deploy\/caddy\/Caddyfile /);
});

test('nightly resolves private metadata on the runner before consuming it', () => {
  const workflow = yaml.load(readFileSync(new URL('../../.github/workflows/e2e-nightly.yml', import.meta.url), 'utf8'));
  const job = workflow.jobs.playwright;
  for (const value of Object.values(job.env)) assert.doesNotMatch(String(value), /\$\{\{\s*runner\./);
  const first = job.steps[0];
  assert.match(first.run, /E2E_RUN_METADATA_PATH=.*RUNNER_TEMP/);
  assert.match(first.run, /GITHUB_ENV/);
  assert.ok(job.steps.findIndex(s => s.name === 'Verify successful staging deploy and release artifact') > 0);
});

test('nightly metadata preparation exports the same private path to later steps', () => {
  const workflow = yaml.load(readFileSync(new URL('../../.github/workflows/e2e-nightly.yml', import.meta.url), 'utf8'));
  const root = mkdtempSync(join(tmpdir(), 'fleetum-nightly-path-'));
  try {
    const runnerTemp = join(root, 'runner temp');
    const githubEnv = join(root, 'github-env');
    mkdirSync(runnerTemp); writeFileSync(githubEnv, '');
    const run = spawnSync('/bin/bash', ['-c', workflow.jobs.playwright.steps[0].run], {
      env: { PATH: process.env.PATH, RUNNER_TEMP: runnerTemp, GITHUB_ENV: githubEnv }, encoding: 'utf8'
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(githubEnv, 'utf8'), `E2E_RUN_METADATA_PATH=${runnerTemp}/fleetum-e2e-verified-run.json\n`);
    for (const step of workflow.jobs.playwright.steps) {
      if (step.with?.script?.includes('writeFileSync(process.env.E2E_RUN_METADATA_PATH')) {
        assert.match(step.with.script, /mode: 0o600/);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
