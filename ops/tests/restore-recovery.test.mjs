import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, access, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { assertArchiveHasNoRuntimeDotenv, extractCompatibilityFixture, parseHttpFailure, parseRestoreRecoveryOptions, parseRestoreSecurityReceipt, runRestoreRecoverySecurityFixture, safeHttpFailure, sha256, verifyBackupBundle } from "../verify-restore-recovery.mjs";

const source = "a".repeat(40); const baseline = "b".repeat(40);
const scratchParent = process.platform === "linux" ? "/tmp" : "/private/tmp";
const valid = ["--source-sha", source, "--baseline-sha", baseline, "--evidence-dir", "/private/tmp/fleetum-synthetic-restore-test"];

test("restore CLI binds distinct full commits and a fresh absolute evidence destination", () => {
  assert.deepEqual(parseRestoreRecoveryOptions(valid), { sourceSha: source, baselineSha: baseline, evidenceDirectory: "/private/tmp/fleetum-synthetic-restore-test" });
  assert.equal(parseRestoreRecoveryOptions([...valid, "--git-dir", "/private/tmp/local.git", "--docker-host", "unix:///private/tmp/docker.sock"]).dockerHost, "unix:///private/tmp/docker.sock");
});

test("unsupported, duplicate and incomplete CLI inputs fail before any allocation", async () => {
  for (const args of [[], ["--source-sha"], [...valid, "--bad"], [...valid, "extra"], [...valid, "--source-sha", source], [...valid, "--git-dir"], ["--help", "extra"], ["--source-sha", "abc", ...valid.slice(2)], ["--source-sha", source.toUpperCase(), ...valid.slice(2)], ["--source-sha", baseline, ...valid.slice(2)]]) assert.throws(() => parseRestoreRecoveryOptions(args));
  const scratch = await mkdtemp(path.join(scratchParent, "fleetum-restore-cli-test-"));
  try {
    const evidence = path.join(scratch, "must-not-be-created");
    const command = spawnSync(process.execPath, [new URL("../verify-restore-recovery.mjs", import.meta.url).pathname, ...valid.slice(0, 4), "--evidence-dir", evidence, "--docker-host", "tcp://remote.invalid:2375"], { encoding: "utf8", env: { PATH: process.env.PATH } });
    assert.notEqual(command.status, 0); assert.match(command.stderr, /local Unix socket/); await assert.rejects(access(evidence), { code: "ENOENT" });
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("CLI refuses remote endpoints, Docker contexts and noncanonical filesystem paths", () => {
  for (const endpoint of ["tcp://127.0.0.1:2375", "tcp://remote:2376", "ssh://localhost", "unix://host/tmp/socket", "unix:///", "unix:///tmp/../socket", "unix:///tmp/socket/", "unix:///tmp/socket?x=1"]) assert.throws(() => parseRestoreRecoveryOptions([...valid, "--docker-host", endpoint]));
  for (const destination of ["/", "relative", "/private/tmp/../danger", "/private/tmp//danger", "/private/tmp/danger/", "/private/tmp/a b"]) assert.throws(() => parseRestoreRecoveryOptions([...valid.slice(0, 5), destination]));
  assert.throws(() => parseRestoreRecoveryOptions([...valid, "--context", "production"]));
});

test("production build without application recovery fails before allocating an evidence directory", async () => {
  const scratch = await mkdtemp(path.join(scratchParent, "fleetum-production-cli-test-"));
  try {
    const evidence = path.join(scratch, "must-not-be-created");
    const command = spawnSync(process.execPath, [new URL("../verify-restore-recovery.mjs", import.meta.url).pathname, ...valid.slice(0, 4), "--evidence-dir", evidence, "--production-build"], { encoding: "utf8", env: { PATH: path.dirname(process.execPath) }, timeout: 2000 });
    assert.equal(command.error, undefined); assert.equal(command.status, 1);
    assert.match(command.stderr, /Production build requires explicit application recovery/);
    await assert.rejects(access(evidence), { code: "ENOENT" });
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("the source compatibility fixture is reused without running the full gate", async () => {
  const script = await readFile(new URL("../verify-migration-compatibility.sh", import.meta.url), "utf8");
  const fixture = extractCompatibilityFixture(script);
  assert.match(fixture, /compat_deposit/); assert.match(fixture, /amountCents: 50000/);
  assert.doesNotMatch(fixture, /docker run|migrate deploy|PREVIOUS_RELEASE_REF/);
  assert.throws(() => extractCompatibilityFixture("unexpected input"));
});

test("archive dotenv guard ignores examples and refuses runtime dotenv without reading contents", () => {
  assert.doesNotThrow(() => assertArchiveHasNoRuntimeDotenv([".env.example", "backend/.env.staging.example", "backend/.env.template", "backend/prisma/schema.prisma"]));
  for (const file of [".env", "backend/.env", "backend/prisma/.env", "prisma/.env", "backend/.env.production", "backend/.env.test", "backend/.env.local"]) assert.throws(() => assertArchiveHasNoRuntimeDotenv([file]), /runtime dotenv/);
});

test("HTTP failure diagnostics retain only constant step names and numerical comparison data", () => {
  const secret = "synthetic-secret-that-must-never-be-logged";
  const diagnostic = safeHttpFailure({ stepLabel: "login-b", errorName: "AssertionError", status: 401, actual: 401, expected: 200, message: secret, body: { token: secret }, command: secret, password: secret });
  assert.deepEqual(diagnostic, { stepLabel: "login-b", errorName: "AssertionError", actual: 401, expected: 200, status: 401 });
  assert(!JSON.stringify(diagnostic).includes(secret));
  assert.deepEqual(safeHttpFailure({ stepLabel: secret, errorName: secret, actual: secret, expected: Infinity, status: NaN }), { stepLabel: "unknown", errorName: "Error" });
  assert.deepEqual(parseHttpFailure(`ignored log\nFLEETUM_RESTORE_HTTP_FAILURE ${JSON.stringify({ ...diagnostic, message: secret })}\n`), diagnostic);
  assert.deepEqual(parseHttpFailure("FLEETUM_RESTORE_HTTP_FAILURE malformed\n"), { stepLabel: "unknown", errorName: "SyntaxError" });
  assert.equal(parseHttpFailure("other log output"), null);
});

const seededSecurity = { format: "fleetum-restore-security-v1", phase: "seed", localOnly: true, revocationRecords: 1, siblingRevocationRecords: 0, expiresAt: "2026-10-07T12:00:00.000Z", sha256: "c".repeat(64) };
const securityOutput = (value) => `FLEETUM_RESTORE_SECURITY_JSON ${JSON.stringify(value)}\n`;

test("security receipts preserve only the canonical seeded event proof and reject missing or malformed evidence", () => {
  const secret = "synthetic-bearer-must-not-be-recorded";
  assert.deepEqual(parseRestoreSecurityReceipt(securityOutput({ ...seededSecurity, token: secret, error: secret }), "seed"), seededSecurity);
  for (const output of ["", "FLEETUM_RESTORE_SECURITY_JSON malformed\n", securityOutput(seededSecurity).repeat(2), securityOutput({ ...seededSecurity, phase: "check" }), securityOutput({ ...seededSecurity, revocationRecords: 0 }), securityOutput({ ...seededSecurity, siblingRevocationRecords: 1 }), securityOutput({ ...seededSecurity, sha256: secret }), securityOutput({ ...seededSecurity, expiresAt: "2026-02-30T12:00:00.000Z" })]) {
    assert.throws(() => parseRestoreSecurityReceipt(output, "seed"), { message: "Security fixture returned an invalid receipt" });
  }
  assert.throws(() => parseRestoreSecurityReceipt(securityOutput(seededSecurity), "production"), /Invalid security fixture phase/);
});

test("security seed and both restore checks use guarded test environments and require the same event identity", async () => {
  const directory = "/private/tmp/fleetum-restore-recovery-synthetic/source";
  const calls = [];
  let output = seededSecurity;
  const run = async (command, args, label, details) => { calls.push({ command, args, label, ...details }); return { stdout: Buffer.from(securityOutput(output)) }; };
  const shared = { run, directory, engines: { PRISMA_SCHEMA_ENGINE_BINARY: `${directory}/schema-engine-darwin`, NODE_ENV: "production", DOTENV_CONFIG_PATH: "/private/tmp/must-not-load.env" }, databaseUrl: "postgresql://fleetum_restore:synthetic@127.0.0.1:49152/fleetum_restore_synthetic_source" };
  const seed = await runRestoreRecoverySecurityFixture({ ...shared, phase: "seed", label: "security-seed" });
  assert.deepEqual(seed, seededSecurity);
  output = { ...seededSecurity, phase: "check" };
  for (const suffix of ["first", "second"]) {
    const databaseUrl = shared.databaseUrl.replace("_source", `_${suffix}`);
    assert.deepEqual(await runRestoreRecoverySecurityFixture({ ...shared, databaseUrl, phase: "check", label: `security-${suffix}`, expectedReceipt: seed }), output);
  }
  assert.deepEqual(calls.map((call) => call.args), ["seed", "check", "check"].map((phase) => ["--import", "tsx", "restore-recovery-security.mjs", phase, directory]));
  for (const call of calls) {
    assert.equal(call.command, process.execPath); assert.equal(call.cwd, directory);
    assert.equal(call.extraEnv.NODE_ENV, "test"); assert.equal(call.extraEnv.DOTENV_CONFIG_PATH, "/dev/null");
  }
  assert(calls[1].extraEnv.DATABASE_URL.endsWith("_first")); assert(calls[2].extraEnv.DATABASE_URL.endsWith("_second"));
  for (const changed of [{ sha256: "d".repeat(64) }, { expiresAt: "2026-10-08T12:00:00.000Z" }]) {
    output = { ...seededSecurity, phase: "check", ...changed };
    await assert.rejects(runRestoreRecoverySecurityFixture({ ...shared, phase: "check", label: "security-mismatch", expectedReceipt: seed }), /differs from the pre-backup seeded event/);
  }
  const before = calls.length;
  await assert.rejects(runRestoreRecoverySecurityFixture({ ...shared, phase: "check", label: "security-missing" }), /requires the pre-backup seeded event identity/);
  assert.equal(calls.length, before);
});

test("backup bundle verifies exact SQL bytes and each registered upload", async () => {
  const scratch = await mkdtemp(path.join(scratchParent, "fleetum-backup-integrity-test-"));
  try {
    const dumpPath = path.join(scratch, "backup.sql"); const uploadRoot = path.join(scratch, "uploads");
    const sql = Buffer.from("CREATE TABLE synthetic_fixture (id integer);\n"); const file = Buffer.from("synthetic document bytes");
    await mkdir(path.join(uploadRoot, "tenant_a"), { recursive: true }); await writeFile(dumpPath, sql); await writeFile(path.join(uploadRoot, "tenant_a/document.pdf"), file);
    const manifest = { format: "fleetum-synthetic-restore-v1", dump: { sha256: sha256(sql), sizeBytes: sql.length }, uploads: [{ key: "tenant_a/document.pdf", sha256: sha256(file), sizeBytes: file.length }] };
    assert.equal(await verifyBackupBundle({ dumpPath, uploadRoot, manifest }), true);
    await writeFile(dumpPath, sql.subarray(0, 10)); await assert.rejects(verifyBackupBundle({ dumpPath, uploadRoot, manifest }), /Backup digest or size mismatch/);
    await writeFile(dumpPath, sql); await writeFile(path.join(uploadRoot, "tenant_a/document.pdf"), Buffer.alloc(file.length)); await assert.rejects(verifyBackupBundle({ dumpPath, uploadRoot, manifest }), /upload digest or size mismatch/);
    await rm(path.join(uploadRoot, "tenant_a/document.pdf")); await assert.rejects(verifyBackupBundle({ dumpPath, uploadRoot, manifest }), /upload missing/);
    await writeFile(path.join(scratch, "outside.pdf"), file); await symlink(path.join(scratch, "outside.pdf"), path.join(uploadRoot, "tenant_a/document.pdf"));
    await assert.rejects(verifyBackupBundle({ dumpPath, uploadRoot, manifest }), /Symlinks/);
    await assert.rejects(verifyBackupBundle({ dumpPath, uploadRoot, manifest: { ...manifest, uploads: [{ ...manifest.uploads[0], key: "../outside.pdf" }] } }), /Invalid upload/);
    await assert.rejects(verifyBackupBundle({ dumpPath, uploadRoot, manifest: { ...manifest, uploads: [manifest.uploads[0], manifest.uploads[0]] } }), /Symlinks|Invalid upload/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
