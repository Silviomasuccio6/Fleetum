import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import yaml from 'js-yaml';

const source = readFileSync(new URL('../staging/check-platform-health.sh', import.meta.url), 'utf8');
const workflow = yaml.load(readFileSync(new URL('../../.github/workflows/deploy-staging.yml', import.meta.url), 'utf8'));
const steps = Object.values(workflow.jobs).flatMap(job => job.steps ?? []);
const health = steps.find(step => step.name === 'Staging health checks');
const good = { ok: true, service: 'fleetum-platform-api' };

// Execute the shipped Node validators. Only transports are synthetic: no Docker,
// network, env files, database or real credentials are accessed by these tests.
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'fleetum-platform-health-'));
  const bin = path.join(root, 'bin'); mkdirSync(bin);
  const script = path.join(root, 'health.sh'); writeFileSync(script, source);
  const log = path.join(root, 'calls'); writeFileSync(log, '');
  const fetchModule = path.join(root, 'fetch.mjs');
  writeFileSync(fetchModule, `
    import assert from 'node:assert/strict';
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:4100/platform-api/health');
      assert.deepEqual(Object.keys(options), ['signal']);
      assert.ok(options.signal instanceof AbortSignal);
      if (process.env.MOCK_INTERNAL_STATUS === 'transport-error') throw new Error('synthetic_secret_response');
      return { status: Number(process.env.MOCK_INTERNAL_STATUS), json: async () => JSON.parse(process.env.MOCK_INTERNAL_BODY) };
    };
  `);
  writeFileSync(path.join(bin, 'docker'), `#!${process.execPath}
    const assert = require('node:assert/strict');
    const { appendFileSync } = require('node:fs');
    const { spawnSync } = require('node:child_process');
    const args = process.argv.slice(2);
    assert.deepEqual(args.slice(0, 3), ['--config', '/opt/fleetum-staging/docker-config', 'exec']);
    const remaining = args.slice(3); const stdin = remaining[0] === '-i';
    if (stdin) remaining.shift();
    assert.deepEqual(remaining.slice(0, 3), ['fleetum_staging_backend', 'node', '-e']);
    assert.equal(remaining.length, 4);
    appendFileSync(process.env.MOCK_LOG, stdin ? 'public-validator\\n' : 'loopback-validator\\n');
    const out = spawnSync(process.execPath, ['--import', process.env.MOCK_FETCH_MODULE, '--eval', remaining[3]], { stdio: 'inherit' });
    process.exit(out.status ?? 1);
  `, { mode: 0o700 });
  writeFileSync(path.join(bin, 'curl'), `#!/bin/sh
    printf 'curl\\n' >> "$MOCK_LOG"
    case "$*" in
      *platform-staging.fleetum.it/platform-api/health*)
        [ "$MOCK_PUBLIC_STATUS" != transport-error ] || exit 60
        printf '%s\\n%s' "$MOCK_PUBLIC_BODY" "$MOCK_PUBLIC_STATUS" ;;
      *https://staging.fleetum.it/*) printf Fleetum ;;
      *https://api-staging.fleetum.it/api/ready*) printf '{}' ;;
      *) exit 91 ;;
    esac
  `, { mode: 0o700 });
  writeFileSync(path.join(bin, 'sudo'), `#!/bin/sh
    [ "$1" = -n ] || exit 92
    shift
    exec /usr/bin/env -i PATH="$PATH" MOCK_LOG="$MOCK_LOG" MOCK_FETCH_MODULE="$MOCK_FETCH_MODULE" \
      MOCK_INTERNAL_STATUS="$MOCK_INTERNAL_STATUS" MOCK_INTERNAL_BODY="$MOCK_INTERNAL_BODY" \
      MOCK_PUBLIC_STATUS="$MOCK_PUBLIC_STATUS" MOCK_PUBLIC_BODY="$MOCK_PUBLIC_BODY" "$@"
  `, { mode: 0o700 });
  const env = { PATH: `${bin}:/usr/bin:/bin`, MOCK_LOG: log, MOCK_FETCH_MODULE: fetchModule,
    MOCK_INTERNAL_STATUS: '200', MOCK_INTERNAL_BODY: JSON.stringify(good),
    MOCK_PUBLIC_STATUS: '403', MOCK_PUBLIC_BODY: '{"error":"PLATFORM_IP_FORBIDDEN"}' };
  return { root, bin, script, log, env, run: (mode = 'direct', changes = {}) => spawnSync('bash', [script, mode], { encoding: 'utf8', env: { ...env, ...changes } }),
    close: () => rmSync(root, { recursive: true, force: true }) };
}

for (const mode of ['direct', 'sudo']) test(`strict public denial and actual loopback health pass (${mode})`, () => {
  const f = fixture();
  try {
    const out = f.run(mode);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /health and strict public denial verified/);
    assert.equal(readFileSync(f.log, 'utf8'), 'loopback-validator\ncurl\npublic-validator\n');
  } finally { f.close(); }
});

for (const [name, changes] of [
  ['loopback HTTP error', { MOCK_INTERNAL_STATUS: '503' }],
  ['loopback connection failure', { MOCK_INTERNAL_STATUS: 'transport-error' }],
  ['loopback malformed JSON', { MOCK_INTERNAL_BODY: 'synthetic_secret_response' }],
  ['loopback wrong service', { MOCK_INTERNAL_BODY: '{"ok":true,"service":"other"}' }],
  ['loopback false health', { MOCK_INTERNAL_BODY: '{"ok":false,"service":"fleetum-platform-api"}' }],
  ['public guard disabled', { MOCK_PUBLIC_STATUS: '200' }],
  ['public server failure', { MOCK_PUBLIC_STATUS: '502' }],
  ['public TLS failure', { MOCK_PUBLIC_STATUS: 'transport-error' }],
  ['public generic forbidden', { MOCK_PUBLIC_BODY: '{"error":"FORBIDDEN"}' }],
  ['public optional device mode', { MOCK_PUBLIC_BODY: '{"error":"PLATFORM_DEVICE_REQUIRED"}' }],
  ['public malformed JSON', { MOCK_PUBLIC_BODY: 'synthetic_secret_response' }],
  ['public excessive body', { MOCK_PUBLIC_BODY: 'x'.repeat(4097) }],
]) test(`health fails closed on ${name}`, () => {
  const f = fixture();
  try {
    const out = f.run('direct', changes);
    assert.notEqual(out.status, 0);
    assert.doesNotMatch(out.stdout + out.stderr, /synthetic_secret_response|health and strict public denial verified/);
    if (changes.MOCK_INTERNAL_STATUS || changes.MOCK_INTERNAL_BODY) assert.doesNotMatch(readFileSync(f.log, 'utf8'), /curl/);
  } finally { f.close(); }
});

test('unknown Docker modes reject before any transport', () => {
  const f = fixture();
  try {
    for (const mode of ['', 'sudo;touch invalid', 'production', 'sudo -E']) assert.equal(f.run(mode).status, 1);
    assert.equal(readFileSync(f.log, 'utf8'), '');
  } finally { f.close(); }
});

test('workflow reuses trusted health control and propagates failure before proof', () => {
  assert.ok(health?.run);
  assert.ok(steps.find(step => step.run?.includes('.fleetum-control/ops/staging/check-platform-health.sh')));
  assert.equal(health['continue-on-error'], undefined);
  assert.ok(steps.indexOf(health) < steps.findIndex(step => step.name === 'Publish staging release proof'));
  const f = fixture();
  try {
    // Capture and validate the generated SSH command, then execute its exact helper.
    const remote = path.join(f.root, 'remote');
    writeFileSync(path.join(f.bin, 'ssh'), `#!${process.execPath}
      const assert = require('node:assert/strict');
      const { appendFileSync } = require('node:fs');
      const { spawnSync } = require('node:child_process');
      const args = process.argv.slice(2);
      assert.ok(args.includes('StrictHostKeyChecking=yes'));
      assert.equal(args.at(-2), 'synthetic@staging.invalid');
      assert.equal(args.at(-1), "bash '/opt/fleetum-staging/app/.deploy-staging/${'a'.repeat(40)}/trusted-platform-health.sh' 'sudo'");
      appendFileSync(process.env.MOCK_REMOTE, args.at(-1) + '\\n');
      const out = spawnSync('bash', [process.env.MOCK_SCRIPT, 'sudo'], { stdio: 'inherit' });
      process.exit(out.status ?? 1);
    `, { mode: 0o700 });
    const env = { ...f.env, MOCK_SCRIPT: f.script, MOCK_REMOTE: remote, FLEETUM_RELEASE_SHA: 'a'.repeat(40),
      FLEETUM_STAGING_HOST: 'staging.invalid', FLEETUM_STAGING_USER: 'synthetic', DOCKER_MODE: 'sudo' };
    const run = changes => spawnSync('bash', ['-c', health.run], { encoding: 'utf8', env: { ...env, ...changes } });
    assert.equal(run({}).status, 0);
    assert.notEqual(run({ MOCK_PUBLIC_BODY: '{"error":"OTHER"}' }).status, 0);
    const before = readFileSync(remote, 'utf8');
    assert.equal(run({ FLEETUM_RELEASE_SHA: "x';touch invalid" }).status, 1);
    assert.equal(run({ DOCKER_MODE: 'sudo;touch invalid' }).status, 1);
    assert.equal(readFileSync(remote, 'utf8'), before);
  } finally { f.close(); }
});
