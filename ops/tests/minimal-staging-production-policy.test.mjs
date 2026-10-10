import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const release = "b".repeat(40);
const backendDigest = "a".repeat(64);
const frontendDigest = "e".repeat(64);
const backendId = `sha256:${"1".repeat(64)}`;
const frontendId = `sha256:${"2".repeat(64)}`;
const oldState = `PREVIOUS_BACKEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-backend@sha256:${backendDigest}\nPREVIOUS_FRONTEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-frontend@sha256:${frontendDigest}\n`;

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "fleetum-ingress-policy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const app = join(dir, "app");
  const bin = join(dir, "bin");
  for (const path of [bin, join(app, "deploy/scripts"), join(app, "deploy/backup"), join(app, "deploy/caddy")]) mkdirSync(path, { recursive: true });
  for (const name of ["safe-production-deploy.sh", "rollback-production.sh"]) {
    const target = join(app, "deploy/scripts", name);
    copyFileSync(new URL(`../../deploy/scripts/${name}`, import.meta.url), target);
    chmodSync(target, 0o700);
  }
  const log = join(dir, "calls.jsonl");
  const last = join(dir, "last-deploy.txt");
  const compose = join(app, "docker-compose.prod.yml");
  const overlay = join(app, "docker-compose.prod.shared.yml");
  writeFileSync(last, oldState);
  writeFileSync(compose, "services: {}\n");
  writeFileSync(overlay, "services: {}\n");
  for (const name of ["Caddyfile", "Caddyfile.production-shared", "Caddyfile.staging-ingress"]) writeFileSync(join(app, "deploy/caddy", name), "# synthetic fixture; proxy configuration is validated by its dedicated suite\n");
  writeFileSync(join(dir, "compose.env"), "SYNTHETIC_ONLY=true\n");
  const executable = (path, body) => {
    writeFileSync(path, `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
    chmodSync(path, 0o700);
  };
  const record = `const fs=require('node:fs'); const args=process.argv.slice(2); const record=(kind)=>fs.appendFileSync(process.env.MOCK_LOG,JSON.stringify({kind,args,backend:process.env.FLEETUM_BACKEND_IMAGE,frontend:process.env.FLEETUM_FRONTEND_IMAGE,shared:process.env.FLEETUM_SHARED_STAGING_INGRESS})+'\\n');`;
  const guardMock = join(app, "deploy/scripts/mock-ingress-check.cjs");
  writeFileSync(guardMock, `${record} record('ingress-guard'); if(process.env.FAIL_INGRESS_GUARD==='true'){console.error('synthetic ingress guard rejected');process.exit(1);}\n`);
  const guard = join(app, "deploy/scripts/shared-staging-ingress-preflight.sh");
  writeFileSync(guard, `#!/usr/bin/env bash\nexec '${process.execPath}' '${guardMock}' "$@"\n`, { mode: 0o700 });
  executable(join(bin, "docker"), `${record}
record('docker');
if(args[0]==='ps') { if(process.env.METADATA_FAILURE==='ps')process.exit(7);console.log('synthetic-gateway-id');process.exit(0); }
if(args[0]==='inspect') {
  const format=args[2], container=args.at(-1);
  if(format.includes('NetworkSettings.Networks')) { if(process.env.METADATA_FAILURE==='inspect')process.exit(9);if(process.env.ACTIVE_INGRESS==='true')console.log('shared');process.exit(0); }
  if(format==='{{.Image}}') { console.log(container==='fleetum_backend'?'${backendId}':'${frontendId}');process.exit(0); }
  process.exit(80);
}
if(args[0]==='image'&&args[1]==='inspect') {
  const reference=args.at(-1),format=args[3];
  if(format.includes('RepoDigests')) {console.log(reference==='${backendId}'?'ghcr.io/silviomasuccio6/fleetum-backend@sha256:${backendDigest}':'ghcr.io/silviomasuccio6/fleetum-frontend@sha256:${frontendDigest}');process.exit(0);}
  if(format==='{{.Id}}') {console.log(reference.includes('fleetum-backend')?'${backendId}':'${frontendId}');process.exit(0);}
  process.exit(80);
}
if(args[0]==='compose') {
  if(args.includes('up')&&process.env.FAIL_TARGET_RESTART==='true'&&process.env.FLEETUM_BACKEND_IMAGE==='ghcr.io/silviomasuccio6/fleetum-backend:${release}')process.exit(42);
  process.exit(0);
}
process.exit(80);`);
  executable(join(bin, "flock"), `${record} record('lock');`);
  executable(join(bin, "df"), "console.log('Filesystem 1024-blocks Used Available Capacity Mounted on\\nsynthetic 104857600 1024 104856576 1% /');");
  for (const [relative, kind] of [["deploy/backup/backup-postgres.sh", "backup-postgres"], ["deploy/backup/backup-uploads.sh", "backup-uploads"], ["deploy/scripts/check-production-health.sh", "health"]]) executable(join(app, relative), `${record} record('${kind}');`);
  const env = {
    PATH: `${bin}:/usr/bin:/bin`,
    APP_DIR: app,
    COMPOSE_FILE: compose,
    ENV_FILE: join(dir, "compose.env"),
    LAST_DEPLOY_FILE: last,
    DEPLOY_LOCK_FILE: join(dir, "deploy.lock"),
    POSTGRES_BACKUP_DIR: join(dir, "postgres-backups"),
    UPLOADS_BACKUP_DIR: join(dir, "uploads-backups"),
    UPLOADS_DIR: join(dir, "uploads"),
    DISK_ALERT_SCRIPT: join(dir, "missing-disk-alert"),
    CLEANUP_DOCKER_IMAGES: "false",
    DRY_RUN: "false",
    MIN_FREE_DISK_GB: "1",
    MAX_DISK_USAGE_PERCENT: "99",
    MOCK_LOG: log,
    ACTIVE_INGRESS: "true",
    METADATA_FAILURE: "",
    FAIL_INGRESS_GUARD: "false",
    FLEETUM_SHARED_STAGING_INGRESS: "false",
    FLEETUM_RELEASE_SHA: release,
    FLEETUM_BACKEND_IMAGE: `ghcr.io/silviomasuccio6/fleetum-backend:${release}`,
    FLEETUM_FRONTEND_IMAGE: `ghcr.io/silviomasuccio6/fleetum-frontend:${release}`
  };
  return {
    app, overlay, last, env,
    run: (script, overrides = {}) => spawnSync("/bin/bash", [join(app, "deploy/scripts", script)], { env: { ...env, ...overrides }, encoding: "utf8", timeout: 30_000 }),
    calls: () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []
  };
}

function assertNoDeploymentMutation(f) {
  for (const call of f.calls()) {
    assert.ok(["lock", "ingress-guard"].includes(call.kind) || (call.kind === "docker" && ["ps", "inspect"].includes(call.args[0])), JSON.stringify(call));
  }
  assert.equal(readFileSync(f.last, "utf8"), oldState, "rejected deploy must preserve existing release state");
  assert.equal(existsSync(f.env.POSTGRES_BACKUP_DIR), false);
  assert.equal(existsSync(f.env.UPLOADS_BACKUP_DIR), false);
}

function assertOverlay(call, f) {
  assert.equal(call.kind, "docker");
  assert.deepEqual(call.args.slice(0, 7), ["compose", "--env-file", f.env.ENV_FILE, "-f", f.env.COMPOSE_FILE, "-f", f.overlay]);
  assert.equal(call.shared, "true", "shared ingress opt-in must propagate to compose and rollback");
}

for (const script of ["safe-production-deploy.sh", "rollback-production.sh"]) {
  test(`${script}: disabled opt-in refuses an active ingress before backup or compose`, (t) => {
    const f = fixture(t);
    const result = f.run(script);
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /Active staging ingress cannot be removed/);
    assert.deepEqual(f.calls().filter((call) => call.kind === "docker").map((call) => call.args[0]), ["ps", "inspect"]);
    assertNoDeploymentMutation(f);
  });

  for (const failure of ["ps", "inspect"]) {
    test(`${script}: ${failure} metadata failure blocks an unconfigured deploy`, (t) => {
      const f = fixture(t);
      const result = f.run(script, { METADATA_FAILURE: failure });
      assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /Production gateway metadata unavailable/);
      assert.equal(f.calls().filter((call) => call.kind === "docker").at(-1).args[0], failure);
      assertNoDeploymentMutation(f);
    });
  }

  test(`${script}: enabled opt-in requires the reviewed overlay before any compose or backup`, (t) => {
    const f = fixture(t);
    rmSync(f.overlay);
    const result = f.run(script, { FLEETUM_SHARED_STAGING_INGRESS: "true" });
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /Reviewed shared ingress overlay is required/);
    assertNoDeploymentMutation(f);
  });

  test(`${script}: failed ingress ownership helper refuses backup, migration and compose`, (t) => {
    const f = fixture(t);
    const result = f.run(script, { FLEETUM_SHARED_STAGING_INGRESS: "true", FAIL_INGRESS_GUARD: "true" });
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /synthetic ingress guard rejected/);
    assert.equal(f.calls().filter((call) => call.kind === "ingress-guard").length, 1);
    assert.equal(f.calls().filter((call) => call.kind === "docker").length, 0);
    assertNoDeploymentMutation(f);
  });
}

test("production deploy includes the opt-in overlay in pull, both migrations and restart", (t) => {
  const f = fixture(t);
  const result = f.run("safe-production-deploy.sh", { FLEETUM_SHARED_STAGING_INGRESS: "true" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(f.calls().filter((call) => call.kind === "ingress-guard").length, 1);
  assert.ok(f.calls().findIndex((call) => call.kind === "ingress-guard") < f.calls().findIndex((call) => call.kind === "docker"));
  const composeCalls = f.calls().filter((call) => call.kind === "docker" && call.args[0] === "compose");
  assert.deepEqual(composeCalls.map((call) => call.args[7]), ["pull", "run", "run", "up"]);
  for (const call of composeCalls) assertOverlay(call, f);
  assert.match(composeCalls[1].args.at(-1), /prisma migrate deploy/);
  assert.match(composeCalls[2].args.at(-1), /money:reconcile:prod/);
  assert.deepEqual(f.calls().filter((call) => call.kind.startsWith("backup")).map((call) => call.kind), ["backup-postgres", "backup-uploads"]);
  assert.match(readFileSync(f.last, "utf8"), /^DEPLOY_COMPLETED_AT=/m);
});

test("manual rollback preserves the overlay for immutable previous images", (t) => {
  const f = fixture(t);
  const result = f.run("rollback-production.sh", { FLEETUM_SHARED_STAGING_INGRESS: "true" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(f.calls().filter((call) => call.kind === "ingress-guard").length, 1);
  assert.ok(f.calls().findIndex((call) => call.kind === "ingress-guard") < f.calls().findIndex((call) => call.kind === "docker"));
  const composeCalls = f.calls().filter((call) => call.kind === "docker" && call.args[0] === "compose");
  assert.deepEqual(composeCalls.map((call) => call.args[7]), ["pull", "up"]);
  for (const call of composeCalls) {
    assertOverlay(call, f);
    assert.equal(call.backend, `ghcr.io/silviomasuccio6/fleetum-backend@sha256:${backendDigest}`);
    assert.equal(call.frontend, `ghcr.io/silviomasuccio6/fleetum-frontend@sha256:${frontendDigest}`);
  }
  assert.equal(readFileSync(f.last, "utf8"), oldState);
});

test("failed production restart passes the opt-in to its real application rollback", (t) => {
  const f = fixture(t);
  const result = f.run("safe-production-deploy.sh", { FLEETUM_SHARED_STAGING_INGRESS: "true", FAIL_TARGET_RESTART: "true" });
  assert.equal(result.status, 42, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /rollback completed/);
  assert.equal(f.calls().filter((call) => call.kind === "ingress-guard").length, 2, "both initial deploy and real application rollback must recheck ingress ownership");
  const composeCalls = f.calls().filter((call) => call.kind === "docker" && call.args[0] === "compose");
  assert.deepEqual(composeCalls.map((call) => call.args[7]), ["pull", "run", "run", "up", "pull", "up"]);
  for (const call of composeCalls) assertOverlay(call, f);
  for (const call of composeCalls.slice(-2)) assert.equal(call.backend, `ghcr.io/silviomasuccio6/fleetum-backend@sha256:${backendDigest}`);
  assert.doesNotMatch(readFileSync(f.last, "utf8"), /^DEPLOY_COMPLETED_AT=/m);
});
