import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import yaml from "js-yaml";

test("staging deploy rejects unknown controls before any Docker or copy operation", () => {
  const source = readFileSync(new URL("../staging/run-deploy.sh", import.meta.url), "utf8");
  const root = mkdtempSync(path.join(tmpdir(), "fleetum-staging-deploy-"));
  try {
    const file = path.join(root, "deploy.sh"); writeFileSync(file, source);
    for (const args of [[], ["a".repeat(40), "bad", "bad", "shared", "false", "direct"],
      ["a".repeat(40), `ghcr.io/silviomasuccio6/fleetum-backend@sha256:${"b".repeat(64)}`,
        `ghcr.io/silviomasuccio6/fleetum-frontend@sha256:${"c".repeat(64)}`, "shared;touch invalid", "false", "direct"]]) {
      const out = spawnSync("bash", [file, ...args], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
      assert.equal(out.status, 1); assert.match(out.stderr, /Staging deploy controls rejected/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("production workflow validates shared metadata and the complete bundle before promotion", () => {
  const workflow = yaml.load(readFileSync(new URL("../../.github/workflows/deploy-production.yml", import.meta.url), "utf8"));
  const step = Object.values(workflow.jobs).flatMap(job => job.steps ?? []).find(item => item.name === "Pull images, backup, migrate and restart production containers");
  assert.ok(step?.run, "production deployment step must exist");
  const marker = 'case "$FLEETUM_SHARED_STAGING_INGRESS"';
  const selected = step.run.slice(step.run.indexOf(marker));
  assert.ok(selected.startsWith(marker));
  const root = mkdtempSync(path.join(tmpdir(), "fleetum-production-promotion-"));
  try {
    const bin = path.join(root, "bin"); mkdirSync(bin);
    const remoteFile = path.join(root, "remote.sh"); const log = path.join(root, "calls");
    writeFileSync(log, "");
    const mock = (name, body) => writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o700 });
    mock("ssh", 'for last; do :; done; printf "%s\\n" "$last" > "$REMOTE_FILE"');
    mock("flock", 'exit 0');
    mock("docker", 'case "$1" in ps) printf "container\\n";; inspect) [ "$FAIL_META" != true ] || exit 1; printf "%s\\n" "$ACTIVE_INGRESS";; esac');
    mock("rsync", 'printf "copy\\n" >> "$MOCK_LOG"; exit 37');
    const app = path.join(root, "app"); mkdirSync(app); const sha = "a".repeat(40);
    const bundle = path.join(app, ".deploy-staging", sha); mkdirSync(bundle, { recursive: true });
    const env = { PATH: `${bin}:/usr/bin:/bin`, REMOTE_FILE: remoteFile, MOCK_LOG: log, FLEETUM_APP_DIR: app,
      FLEETUM_DEPLOY_LOCK_DIR: root, FLEETUM_DEPLOY_LOCK_FILE: path.join(root, "lock"), FLEETUM_RELEASE_SHA: sha,
      FLEETUM_SHARED_STAGING_INGRESS: "true" };
    const capture = spawnSync("bash", ["-c", selected], { encoding: "utf8", env });
    assert.equal(capture.status, 0, capture.stderr);
    const remote = readFileSync(remoteFile, "utf8");
    assert.equal(spawnSync("bash", ["-n"], { input: remote, encoding: "utf8" }).status, 0);
    const execute = (change = {}) => spawnSync("bash", ["-c", remote], { encoding: "utf8", env: { ...env, ...change } });
    assert.equal(execute().status, 1, "missing shared files must stop promotion");
    assert.equal(readFileSync(log, "utf8"), "");
    for (const name of ["docker-compose.prod.shared.yml", "deploy/caddy/Caddyfile.production-shared", "deploy/caddy/Caddyfile.staging-ingress", "deploy/caddy/Caddyfile"]) {
      mkdirSync(path.dirname(path.join(bundle, name)), { recursive: true }); writeFileSync(path.join(bundle, name), "# synthetic\n");
    }
    mkdirSync(path.join(bundle, "deploy/scripts"));
    const guard = path.join(bundle, "deploy/scripts/shared-staging-ingress-preflight.sh");
    writeFileSync(guard, "exit 1\n");
    assert.equal(execute().status, 1, "network guard must stop before copying");
    assert.equal(readFileSync(log, "utf8"), "");
    writeFileSync(guard, "exit 0\n");
    assert.equal(execute({ FAIL_META: "true" }).status, 1);
    assert.equal(readFileSync(log, "utf8"), "");
    assert.equal(execute().status, 37, "verified bundle reaches first copy only after guards");
    assert.equal(readFileSync(log, "utf8"), "copy\n");
    // Re-capture false opt-in and verify an existing ingress cannot be detached.
    const disabled = spawnSync("bash", ["-c", selected], { encoding: "utf8", env: { ...env, FLEETUM_SHARED_STAGING_INGRESS: "false" } });
    assert.equal(disabled.status, 0);
    writeFileSync(log, "");
    const refuse = spawnSync("bash", ["-c", readFileSync(remoteFile, "utf8")], { encoding: "utf8", env: { ...env, ACTIVE_INGRESS: "shared" } });
    assert.equal(refuse.status, 1); assert.equal(readFileSync(log, "utf8"), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("staging deploy applies the shared overlay, bootstraps once and keeps health within its lock", () => {
  const source = readFileSync(new URL("../staging/run-deploy.sh", import.meta.url), "utf8");
  const root = mkdtempSync(path.join(tmpdir(), "fleetum-staging-deploy-"));
  try {
    const base = path.join(root, "staging"); const bin = path.join(root, "bin"); const log = path.join(root, "calls");
    const sha = "a".repeat(40); const bundle = path.join(base, "app/.deploy-staging", sha);
    for (const p of [bin, bundle, path.join(bundle, "deploy/caddy"), path.join(base, "env"), path.join(base, "docker-config")]) mkdirSync(p, { recursive: true });
    writeFileSync(path.join(bundle, "docker-compose.staging.yml"), "services: {}\n");
    writeFileSync(path.join(bundle, "docker-compose.staging.shared.yml"), "services: {}\n");
    writeFileSync(path.join(bundle, "deploy/caddy/Caddyfile.staging-shared"), "# synthetic\n");
    writeFileSync(path.join(bundle, "trusted-preflight.sh"), "#!/bin/sh\nif { : <&3; } 2>/dev/null; then exit 21; fi\n");
    const script = path.join(root, "deploy.sh"); writeFileSync(script, source.replaceAll("/opt/fleetum-staging", base));
    const mock = (name, body) => writeFileSync(path.join(bin, name), `#!/bin/sh\nif { : <&3; } 2>/dev/null; then exit 21; fi\n${body}\n`, { mode: 0o700 });
    mock("flock", 'printf "lock\\n" >> "$MOCK_LOG"');
    mock("rsync", 'printf "copy\\n" >> "$MOCK_LOG"; exec /bin/cp -R "$2" "$3"');
    mock("docker", 'printf "%s\\n" "$*" >> "$MOCK_LOG"; case "$*" in *"prisma migrate deploy"*) input=$(cat); [ -z "$input" ] || exit 19;; *staging-bootstrap.js*) input=$(cat); printf "bootstrap_bytes=%s\\n" "${#input}" >> "$MOCK_LOG"; printf "STAGING_BOOTSTRAP_CREATED\\n";; esac');
    mock("curl", 'printf "health\\n" >> "$MOCK_LOG"');
    const args = [sha, `ghcr.io/silviomasuccio6/fleetum-backend@sha256:${"b".repeat(64)}`,
      `ghcr.io/silviomasuccio6/fleetum-frontend@sha256:${"c".repeat(64)}`, "shared", "true", "direct"];
    const payload = '{"tenantA":"synthetic_password_a","tenantB":"synthetic_password_b"}';
    const out = spawnSync("bash", [script, ...args], { encoding: "utf8", input: payload, env: { PATH: `${bin}:/usr/bin:/bin`, MOCK_LOG: log } });
    assert.equal(out.status, 0, out.stderr);
    const calls = readFileSync(log, "utf8");
    assert.match(calls, /-f docker-compose.staging.yml -f docker-compose.staging.shared.yml/);
    assert.ok(calls.indexOf("prisma migrate deploy") < calls.indexOf("staging-bootstrap.js"));
    assert.ok(calls.indexOf("staging-bootstrap.js") < calls.indexOf("up -d --no-build"));
    assert.ok(calls.includes(`bootstrap_bytes=${Buffer.byteLength(payload)}\n`));
    assert.ok(calls.indexOf("lock") < calls.indexOf("copy"));
    assert.ok(calls.indexOf("health") > calls.indexOf("up -d --no-build"));
    assert.doesNotMatch(calls + out.stdout + out.stderr, /synthetic_password_[ab]/);
    writeFileSync(log, "");
    const again = spawnSync("bash", [script, ...args.slice(0, 4), "false", "direct"], { encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin`, MOCK_LOG: log } });
    assert.equal(again.status, 0, again.stderr);
    assert.doesNotMatch(readFileSync(log, "utf8"), /staging-bootstrap.js/);
    rmSync(path.join(bundle, "docker-compose.staging.shared.yml"));
    writeFileSync(log, "");
    const missing = spawnSync("bash", [script, ...args], { encoding: "utf8", input: payload, env: { PATH: `${bin}:/usr/bin:/bin`, MOCK_LOG: log } });
    assert.equal(missing.status, 1);
    assert.equal(readFileSync(log, "utf8"), "", "incomplete shared bundle must fail before locking or copying");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
