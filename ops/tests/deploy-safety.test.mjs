import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const safeDeploySource = resolve(repositoryRoot, "deploy/scripts/safe-production-deploy.sh");
const rollbackSource = resolve(repositoryRoot, "deploy/scripts/rollback-production.sh");
const healthCheckSource = resolve(repositoryRoot, "deploy/scripts/check-production-health.sh");
const releaseSha = "b".repeat(40);
const previousSha = "a".repeat(40);

test("manual rollback defaults to the public production readiness endpoint", () => {
  const rollback = readFileSync(rollbackSource, "utf8");
  assert.match(rollback, /HEALTH_URL="\$\{HEALTH_URL:-https:\/\/api\.fleetum\.it\/api\/ready\}"/);
  assert.doesNotMatch(rollback, /HEALTH_URL="\$\{HEALTH_URL:-http:\/\/127\.0\.0\.1:4000/);
});

const writeExecutable = (path, contents) => {
  writeFileSync(path, contents, { mode: 0o755 });
  chmodSync(path, 0o755);
};

const createFixture = () => {
  const root = mkdtempSync(join(tmpdir(), "fleetum-deploy-safety-"));
  const appDir = join(root, "app");
  const scriptsDir = join(appDir, "deploy/scripts");
  const backupDir = join(appDir, "deploy/backup");
  const binDir = join(root, "bin");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  copyFileSync(safeDeploySource, join(scriptsDir, "safe-production-deploy.sh"));
  copyFileSync(rollbackSource, join(scriptsDir, "rollback-production.sh"));
  copyFileSync(healthCheckSource, join(scriptsDir, "check-production-health.sh"));
  chmodSync(join(scriptsDir, "safe-production-deploy.sh"), 0o755);
  chmodSync(join(scriptsDir, "rollback-production.sh"), 0o755);
  chmodSync(join(scriptsDir, "check-production-health.sh"), 0o755);
  writeExecutable(join(backupDir, "backup-postgres.sh"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(backupDir, "backup-uploads.sh"), "#!/usr/bin/env bash\nexit 0\n");
  writeFileSync(join(appDir, "docker-compose.prod.yml"), "services: {}\n");
  writeFileSync(join(root, "compose.env"), "TEST_ONLY=true\n");

  writeExecutable(
    join(binDir, "docker"),
    `#!/usr/bin/env bash
set -u
printf '%s|backend=%s|frontend=%s\\n' "$*" "\${FLEETUM_BACKEND_IMAGE:-}" "\${FLEETUM_FRONTEND_IMAGE:-}" >> "$COMMAND_LOG"
if [ "\${1:-}" = "inspect" ]; then
  container="\${!#}"
  if [ "$container" = "fleetum_backend" ]; then
    printf 'ghcr.io/silviomasuccio6/fleetum-backend:${previousSha}\\n'
  else
    printf 'ghcr.io/silviomasuccio6/fleetum-frontend:${previousSha}\\n'
  fi
  exit 0
fi
if [ "\${1:-}" = "image" ] && [ "\${2:-}" = "inspect" ]; then
  image_ref="\${!#}"
  image_kind=frontend
  case "$image_ref" in
    *fleetum-backend*) image_kind=backend ;;
  esac
  image_variant=release
  if [ "\${MISMATCH_IMAGE_ID:-false}" = "true" ]; then
    case "$image_ref" in
      *@sha256:*) image_variant=digest ;;
    esac
  fi
  printf 'sha256:%s-%s\n' "$image_kind" "$image_variant"
  exit 0
fi
case " $* " in
  *" up -d --no-build "*)
    restart_attempt=1
    if [ -f "$RESTART_ATTEMPT_FILE" ]; then
      restart_attempt=$(( $(cat "$RESTART_ATTEMPT_FILE") + 1 ))
    fi
    printf '%s\n' "$restart_attempt" > "$RESTART_ATTEMPT_FILE"
    if [ "$restart_attempt" -eq 1 ] && [ "\${FAIL_INITIAL_RESTART:-true}" = "true" ]; then
      exit 42
    fi
    if [ "$restart_attempt" -gt 1 ] && [ "\${FAIL_ROLLBACK_RESTART:-false}" = "true" ]; then
      exit 43
    fi
    ;;
esac
exit 0
`
  );
  writeExecutable(
    join(binDir, "df"),
    "#!/usr/bin/env bash\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\nmock 104857600 1024 104856576 1%% /\\n'\n"
  );
  writeExecutable(
    join(binDir, "curl"),
    `#!/usr/bin/env bash
attempt=1
if [ -f "$CURL_ATTEMPT_FILE" ]; then
  attempt=$(( $(cat "$CURL_ATTEMPT_FILE") + 1 ))
fi
printf '%s\n' "$attempt" > "$CURL_ATTEMPT_FILE"
if [ "$attempt" -eq 1 ] && [ "\${CURL_FAIL_FIRST:-false}" = "true" ]; then
  exit 22
fi
url="\${!#}"
if [ -n "\${CURL_FAIL_MATCH:-}" ]; then
  case "$url" in
    *"$CURL_FAIL_MATCH"*)
      if [ ! -f "$CURL_FAILED_MATCH_FILE" ]; then
        : > "$CURL_FAILED_MATCH_FILE"
        exit 22
      fi
      ;;
  esac
fi
case "$url" in
  */robots.txt) printf 'Sitemap: https://fleetum.it/sitemap.xml\n' ;;
  */sitemap.xml) printf '<loc>https://fleetum.it/demo</loc>\n' ;;
  */llms.txt) printf '# Fleetum\n' ;;
  */fleetum-social-preview.png) printf 'content-type: image/png\n' ;;
  */) printf 'Fleetum\n' ;;
esac
exit 0
`
  );
  writeExecutable(join(binDir, "flock"), "#!/usr/bin/env bash\nexit 0\n");

  return {
    root,
    appDir,
    binDir,
    commandLog: join(root, "commands.log"),
    restartAttemptFile: join(root, "restart-attempted"),
    curlAttemptFile: join(root, "curl-attempted"),
    curlFailedMatchFile: join(root, "curl-failed-match"),
    lastDeployFile: join(root, "last-deploy.txt"),
    lockFile: join(root, "deploy.lock")
  };
};

const runSafeDeploy = (fixture, overrides = {}) =>
  spawnSync("bash", [join(fixture.appDir, "deploy/scripts/safe-production-deploy.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.binDir}:${process.env.PATH}`,
      APP_DIR: fixture.appDir,
      COMPOSE_FILE: join(fixture.appDir, "docker-compose.prod.yml"),
      ENV_FILE: join(fixture.root, "compose.env"),
      LAST_DEPLOY_FILE: fixture.lastDeployFile,
      DEPLOY_LOCK_FILE: fixture.lockFile,
      POSTGRES_BACKUP_DIR: join(fixture.root, "postgres-backups"),
      UPLOADS_BACKUP_DIR: join(fixture.root, "uploads-backups"),
      UPLOADS_DIR: join(fixture.root, "uploads"),
      DISK_ALERT_SCRIPT: join(fixture.root, "missing-disk-alert.sh"),
      CLEANUP_DOCKER_IMAGES: "false",
      MIN_FREE_DISK_GB: "1",
      MAX_DISK_USAGE_PERCENT: "99",
      HEALTH_RETRIES: "1",
      HEALTH_SLEEP_SECONDS: "0",
      HEALTH_URL: "https://staging.invalid/api/ready",
      COMMAND_LOG: fixture.commandLog,
      RESTART_ATTEMPT_FILE: fixture.restartAttemptFile,
      CURL_ATTEMPT_FILE: fixture.curlAttemptFile,
      CURL_FAILED_MATCH_FILE: fixture.curlFailedMatchFile,
      FAIL_INITIAL_RESTART: "true",
      FAIL_ROLLBACK_RESTART: "false",
      CURL_FAIL_FIRST: "false",
      CURL_FAIL_MATCH: "",
      MISMATCH_IMAGE_ID: "false",
      FLEETUM_RELEASE_SHA: releaseSha,
      FLEETUM_BACKEND_IMAGE: `ghcr.io/silviomasuccio6/fleetum-backend:${releaseSha}`,
      FLEETUM_FRONTEND_IMAGE: `ghcr.io/silviomasuccio6/fleetum-frontend:${releaseSha}`,
      FLEETUM_BACKEND_RELEASE_TAG: `ghcr.io/silviomasuccio6/fleetum-backend:${releaseSha}`,
      FLEETUM_FRONTEND_RELEASE_TAG: `ghcr.io/silviomasuccio6/fleetum-frontend:${releaseSha}`,
      ...overrides
    }
  });

test("a partial container restart failure triggers application rollback", (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const result = runSafeDeploy(fixture, {
    FLEETUM_BACKEND_IMAGE: `ghcr.io/silviomasuccio6/fleetum-backend@sha256:${"c".repeat(64)}`,
    FLEETUM_FRONTEND_IMAGE: `ghcr.io/silviomasuccio6/fleetum-frontend@sha256:${"d".repeat(64)}`
  });
  const output = `${result.stdout}\n${result.stderr}`;
  const commands = readFileSync(fixture.commandLog, "utf8");
  const state = readFileSync(fixture.lastDeployFile, "utf8");

  assert.equal(result.status, 42, output);
  assert.match(output, /backend digest verified against release tag/);
  assert.match(output, /frontend digest verified against release tag/);
  assert.match(output, /container restart failed, starting application rollback/);
  assert.match(output, /\[rollback-production\].*rollback completed/);
  assert.doesNotMatch(output, /deploy completed successfully/);
  assert.equal((commands.match(/ up -d --no-build/g) ?? []).length, 2);
  assert.match(
    commands,
    new RegExp(`up -d --no-build\\|backend=ghcr\\.io/silviomasuccio6/fleetum-backend:${previousSha}`)
  );
  assert.match(state, new RegExp(`^RELEASE_SHA=${releaseSha}$`, "m"));
  assert.doesNotMatch(state, /^DEPLOY_COMPLETED_AT=/m);
});

test("release identity mismatch is rejected before any Docker mutation", (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const result = runSafeDeploy(fixture, {
    FLEETUM_BACKEND_IMAGE: `ghcr.io/silviomasuccio6/fleetum-backend:${previousSha}`
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 2, output);
  assert.match(output, /backend image for the selected release/);
  assert.throws(() => readFileSync(fixture.commandLog, "utf8"));
});

test("a failed readiness check triggers rollback without marking the release complete", (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const result = runSafeDeploy(fixture, {
    FAIL_INITIAL_RESTART: "false",
    CURL_FAIL_FIRST: "true"
  });
  const output = `${result.stdout}\n${result.stderr}`;
  const commands = readFileSync(fixture.commandLog, "utf8");
  const state = readFileSync(fixture.lastDeployFile, "utf8");

  assert.equal(result.status, 1, output);
  assert.match(output, /post-deploy release health checks failed, starting application rollback/);
  assert.match(output, /\[rollback-production\].*rollback completed/);
  assert.equal((commands.match(/ up -d --no-build/g) ?? []).length, 2);
  assert.doesNotMatch(state, /^DEPLOY_COMPLETED_AT=/m);
});

test("a failed public frontend check triggers rollback before release completion", (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const result = runSafeDeploy(fixture, {
    FAIL_INITIAL_RESTART: "false",
    CURL_FAIL_MATCH: "robots.txt"
  });
  const output = `${result.stdout}\n${result.stderr}`;
  const state = readFileSync(fixture.lastDeployFile, "utf8");

  assert.equal(result.status, 1, output);
  assert.match(output, /robots check attempt 1\/1 failed/);
  assert.match(output, /post-deploy release health checks failed, starting application rollback/);
  assert.match(output, /\[rollback-production\].*rollback completed/);
  assert.doesNotMatch(state, /^DEPLOY_COMPLETED_AT=/m);
});

test("a digest that does not match the full-SHA release tag is rejected before backup", (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const result = runSafeDeploy(fixture, {
    MISMATCH_IMAGE_ID: "true",
    FLEETUM_BACKEND_IMAGE: `ghcr.io/silviomasuccio6/fleetum-backend@sha256:${"c".repeat(64)}`,
    FLEETUM_FRONTEND_IMAGE: `ghcr.io/silviomasuccio6/fleetum-frontend@sha256:${"d".repeat(64)}`
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 1, output);
  assert.match(output, /backend deployment digest does not match the image tagged for release/);
  assert.throws(() => readFileSync(fixture.lastDeployFile, "utf8"));
});

test("a rollback failure is reported separately while preserving the original deploy status", (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const result = runSafeDeploy(fixture, { FAIL_ROLLBACK_RESTART: "true" });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 42, output);
  assert.match(output, /container restart failed, starting application rollback/);
  assert.match(output, /CRITICAL: application rollback also failed/);
  assert.doesNotMatch(output, /rollback completed/);
});

test("deploy and rollback scripts keep the release state and lock contracts", () => {
  const safeDeploy = readFileSync(safeDeploySource, "utf8");
  const rollback = readFileSync(rollbackSource, "utf8");
  const healthCheck = readFileSync(healthCheckSource, "utf8");

  assert.match(safeDeploy, /mktemp "\$\{LAST_DEPLOY_FILE\}\.tmp\.XXXXXX"/);
  assert.match(safeDeploy, /flock -n 9/);
  assert.match(safeDeploy, /DEPLOY_LOCK_HELD=true/);
  assert.doesNotMatch(rollback, /^\s*\. "\$LAST_DEPLOY_FILE"/m);
  assert.match(rollback, /if ! flock -n 9/);
  assert.match(safeDeploy, /fleetum-\(backend\|frontend\)\(:\|@sha256:\)/);
  assert.match(safeDeploy, /check-production-health\.sh/);
  assert.match(rollback, /check-production-health\.sh/);
  assert.match(healthCheck, /social preview/);
  assert.match(rollback, /another Fleetum deploy or rollback is already running/);
});
