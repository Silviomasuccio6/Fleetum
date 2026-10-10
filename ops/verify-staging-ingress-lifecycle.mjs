import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

export function parseArgs(args) {
  assert.equal(args.length, 3); assert.equal(args[0], '--run-local-synthetic'); assert.equal(args[1], '--caddy-image');
  assert.match(args[2], /^sha256:[a-f0-9]{64}$/);
  return { image: args[2] };
}

export async function runLifecycle({ image }) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scratch = mkdtempSync(join(tmpdir(), 'fleetum-ingress-lifecycle-'));
  const project = `fleetum-ingress-test-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const privateNet = `${project}-private`, ingress = `${project}-ingress`;
  const names = ['caddy', 'backend', 'postgres'].map(n => `${project}-${n}`);
  const volumes = ['data', 'config'].map(n => `${project}-${n}`);
  const env = { PATH: process.env.PATH, CADDY_EMAIL: 'synthetic@example.invalid', COMPOSE_DISABLE_ENV_FILE: 'true' };
  for (const key of ['HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT']) if (process.env[key]) env[key] = process.env[key];
  mkdirSync(join(scratch, 'docker-noauth'));
  const docker = (args, failure = false) => {
    const isCompose = args[0] === 'compose';
    const result = spawnSync(isCompose ? 'docker-compose' : 'docker', isCompose ? args.slice(1) : ['--config', join(scratch, 'docker-noauth'), ...args], {
      env: { ...env, DOCKER_CONFIG: join(scratch, 'docker-noauth') }, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    if (!failure && result.status !== 0) throw new Error(`Synthetic Docker ${args[0]} failed: ${result.stderr || result.error?.message}`);
    return result.stdout?.trim() ?? '';
  };
  const report = { scope: 'local-synthetic-gateway-compose-lifecycle', image, checks: [], cleanup: false, externalGatesPromoted: 0 };
  const check = (name, fn) => { fn(); report.checks.push({ name, passed: true }); };
  const hashes = Object.fromEntries(['Caddyfile', 'Caddyfile.production-shared', 'Caddyfile.staging-ingress'].map(name =>
    [name, createHash('sha256').update(readFileSync(join(root, 'deploy/caddy', name))).digest('hex')]));
  const input = { mode: 'plan', sourceSha: 'a'.repeat(40), image: `ghcr.io/silviomasuccio6/fleetum-frontend@sha256:${'b'.repeat(64)}`,
    composeHash: createHash('sha256').update(readFileSync(join(root, 'docker-compose.prod.yml'))).digest('hex'), caddyHash: hashes.Caddyfile, bundleHashes: hashes };
  const python = `import importlib.util,json,sys\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('control',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\ng=m.Gateway(Path(sys.argv[1]).parent,json.load(sys.stdin));g.paths['app']=Path(sys.argv[2]);print(json.dumps([g.manifest(False),g.manifest(True)]))\n`;
  const generated = spawnSync('python3', ['-I', '-B', '-c', python, join(root, 'ops/staging/ingress-control.py'), scratch], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const models = JSON.parse(generated.stdout);
  report.sourceHashes = hashes;
  const identity = name => JSON.parse(docker(['inspect', '--format', '{"Id":{{json .Id}},"Image":{{json .Image}},"StartedAt":{{json .State.StartedAt}},"Running":{{json .State.Running}},"RestartCount":{{json .RestartCount}}}', name]));
  const files = ['baseline', 'shared'].map(n => join(scratch, n + '.json'));
  const compose = file => docker(['compose', '--project-name', project, '--env-file', '/dev/null', '-f', file, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'caddy']);
  try {
    docker(['image', 'inspect', image]);
    report.composeVersion = docker(['compose', 'version', '--short']); assert.equal(report.composeVersion, '2.40.3');
    report.caddyVersion = docker(['run', '--rm', '--network', 'none', '--pull', 'never', image, 'caddy', 'version']);
    assert.match(report.caddyVersion, /^v2\.11\.4 /);
    mkdirSync(join(scratch, 'deploy/caddy'), { recursive: true });
    mkdirSync(join(scratch, 'website'));
    writeFileSync(join(scratch, 'website/index.html'), '<!doctype html><title>Synthetic Fleetum fixture</title>synthetic website');
    for (const name of Object.keys(hashes)) {
      let source = readFileSync(join(root, 'deploy/caddy', name), 'utf8');
      if (name === 'Caddyfile') source = source.replace('email {$CADDY_EMAIL}', 'local_certs\n\tskip_install_trust');
      writeFileSync(join(scratch, 'deploy/caddy', name), source);
    }
    writeFileSync(join(scratch, 'backend.Caddyfile'), ':4000 {\n respond "synthetic backend" 200\n}\n:4100 {\n respond "synthetic platform" 200\n}\n');
    docker(['network', 'create', '--label', 'com.fleetum.test=ingress-lifecycle', privateNet]);
    docker(['network', 'create', '--internal', '--subnet', '10.203.91.0/28', '--gateway', '10.203.91.1', '--label', 'com.fleetum.test=ingress-lifecycle', ingress]);
    for (const volume of volumes) docker(['volume', 'create', '--label', 'com.fleetum.test=ingress-lifecycle', volume]);
    docker(['run', '-d', '--pull', 'never', '--name', names[1], '--label', `com.docker.compose.project=${project}`, '--network', privateNet, '--network-alias', 'backend',
      '--tmpfs', '/data', '--tmpfs', '/config', '-v', `${join(scratch, 'backend.Caddyfile')}:/etc/caddy/Caddyfile:ro`, image]);
    docker(['run', '-d', '--pull', 'never', '--name', names[2], '--label', `com.docker.compose.project=${project}`, '--network', privateNet, '--entrypoint', 'sh', image, '-c', 'sleep 600']);
    for (let i = 0; i < models.length; i++) {
      const model = models[i]; const service = model.services.caddy;
      check(`generated ${i ? 'shared' : 'baseline'} model contains only gateway and existing named storage`, () => {
        assert.deepEqual(Object.keys(model.services), ['caddy']); assert.equal(service.image, input.image);
        assert.deepEqual(service.ports, ['80:80', '443:443']); assert.equal(service.env_file, undefined);
        assert.ok(Object.values(model.volumes).every(v => v.external));
      });
      // Fixture substitutions only: names, immutable official image, loopback
      // ephemeral TLS port, and local CA. Source models remain untouched.
      service.image = image; service.container_name = names[0]; service.ports = ['127.0.0.1::443'];
      service.volumes.push(`${join(scratch, 'website')}:/srv/fleetum-website:ro`);
      model.networks.fleetum_private.name = privateNet;
      if (model.networks.fleetum_staging_ingress) model.networks.fleetum_staging_ingress.name = ingress;
      model.volumes.caddy_data.name = volumes[0]; model.volumes.caddy_config.name = volumes[1];
      writeFileSync(files[i], JSON.stringify(model));
    }
    const apps = [identity(names[1]), identity(names[2])];
    compose(files[0]); const baseline = identity(names[0]);
    let ca;
    for (let i = 0; i < 60 && !ca; i++) {
      ca = docker(['exec', names[0], 'cat', '/data/caddy/pki/authorities/local/root.crt'], true);
      if (!ca.includes('BEGIN CERTIFICATE')) { ca = null; await pause(250); }
    }
    assert.ok(ca);
    const smoke = async () => {
      const port = Number(docker(['port', names[0], '443/tcp']).split(':').at(-1));
      for (const [host, path] of [['fleetum.it', '/'], ['api.fleetum.it', '/api/ready'], ['platform.fleetum.it', '/platform-api/health']]) {
        let status;
        for (let retry = 0; retry < 40; retry++) {
          try {
            status = await new Promise((resolve, reject) => {
              const req = request({ hostname: '127.0.0.1', port, path, servername: host, headers: { host }, ca, timeout: 1500 }, res => { res.resume(); resolve(res.statusCode); });
              req.on('error', reject); req.on('timeout', () => req.destroy(new Error('fixture timeout'))); req.end();
            });
            if (status === 200) break;
          } catch { /* transient startup */ }
          await pause(250);
        }
        assert.equal(status, 200, host);
      }
    };
    await smoke(); report.checks.push({ name: 'baseline TLS and three production routes healthy with local CA', passed: true });
    compose(files[1]); await smoke(); const shared = identity(names[0]);
    check('activation recreates only gateway and connects it to ingress', () => {
      assert.notEqual(shared.Id, baseline.Id); assert.deepEqual([identity(names[1]), identity(names[2])], apps);
      const nets = JSON.parse(docker(['inspect', '--format', '{{json .NetworkSettings.Networks}}', names[0]]));
      assert.equal(nets[ingress].IPAddress, '10.203.91.2'); assert.deepEqual(Object.keys(nets).sort(), [ingress, privateNet].sort());
    });
    compose(files[1]); await smoke(); check('same shared manifest retry does not recreate gateway or applications', () => {
      assert.deepEqual(identity(names[0]), shared); assert.deepEqual([identity(names[1]), identity(names[2])], apps);
    });
    docker(['stop', names[0]]); compose(files[0]); await smoke();
    check('baseline recovery from stopped gateway preserves applications and certificates', () => {
      assert.deepEqual([identity(names[1]), identity(names[2])], apps);
      assert.equal(docker(['exec', names[0], 'cat', '/data/caddy/pki/authorities/local/root.crt']), ca);
      const nets = JSON.parse(docker(['inspect', '--format', '{{json .NetworkSettings.Networks}}', names[0]]));
      assert.deepEqual(Object.keys(nets), [privateNet]);
    });
    docker(['rm', '-f', names[0]]); compose(files[0]); await smoke();
    check('baseline recovery from absent gateway preserves applications and certificates', () => {
      assert.deepEqual([identity(names[1]), identity(names[2])], apps);
      assert.equal(docker(['exec', names[0], 'cat', '/data/caddy/pki/authorities/local/root.crt']), ca);
    });
    check('isolated Docker configuration remains empty', () => assert.deepEqual(readdirSync(join(scratch, 'docker-noauth')), []));
  } finally {
    for (const name of names) docker(['rm', '-f', name], true);
    for (const volume of volumes) docker(['volume', 'rm', volume], true);
    for (const name of [ingress, privateNet]) docker(['network', 'rm', name], true);
    report.cleanup = [...names, ...volumes, ingress, privateNet].every(name => {
      const type = names.includes(name) ? 'container' : volumes.includes(name) ? 'volume' : 'network';
      return !docker([type, 'inspect', '--format', '{{.Name}}', name], true);
    });
    rmSync(scratch, { recursive: true, force: true });
  }
  assert.equal(report.cleanup, true); return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.stdout.write(JSON.stringify(await runLifecycle(parseArgs(process.argv.slice(2))), null, 2) + '\n'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
