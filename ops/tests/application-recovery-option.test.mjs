import assert from "node:assert/strict";
import test from "node:test";
import { finalizeApplicationRecovery } from "../recovery/exercise-application-recovery.mjs";
import { buildApplicationRecoveryPair, parseRestoreRecoveryOptions } from "../verify-restore-recovery.mjs";

const reserve = ["--recovery-source-sha", "c".repeat(40)];
const args = ["--source-sha", "a".repeat(40), "--baseline-sha", "b".repeat(40), "--evidence-dir", "/private/tmp/fleetum-application-option"];
test("application recovery can explicitly compile its pinned pair in production mode", () => {
  const options = parseRestoreRecoveryOptions([...args, "--application-recovery", ...reserve, "--production-build"]);
  assert.equal(options.productionBuild, true);
  assert.equal(options.applicationRecovery, true);
  assert.equal(options.recoverySourceSha, "c".repeat(40));
  assert.equal(parseRestoreRecoveryOptions([...args, "--application-recovery", ...reserve]).productionBuild, undefined);
});

test("production compilation refuses duplicate options, values and use without pinned recovery", () => {
  for (const extra of [
    ["--production-build"],
    ["--production-build", ...reserve],
    ["--application-recovery", "--production-build"],
    ["--application-recovery", ...reserve, "--production-build", "--production-build"],
    ["--application-recovery", ...reserve, "--production-build", "true"],
  ]) assert.throws(() => parseRestoreRecoveryOptions([...args, ...extra]));
});

test("the production build flag changes both compilation environments without changing the fixture environment", async () => {
  const fixtureEnv = Object.freeze({ NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null", npm_config_offline: "true" });
  const engines = Object.freeze({ PRISMA_SCHEMA_ENGINE_BINARY: "/private/tmp/synthetic-schema-engine", NODE_ENV: "test" });
  for (const [options, expected] of [[{}, "test"], [{ productionBuild: false }, "test"], [{ productionBuild: true }, "production"]]) {
    const calls = [];
    const run = async (command, commandArgs, label, details) => calls.push({ command, commandArgs, label, cwd: details.cwd, env: { ...fixtureEnv, ...details.extraEnv } });
    const result = await buildApplicationRecoveryPair({ run, directory: "/private/tmp/synthetic-reserve", engines, databaseUrl: "postgresql://synthetic@127.0.0.1:49152/fleetum_restore_synthetic", ...options });
    assert.deepEqual(result, { nodeEnv: expected, completed: true });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.commandArgs), [["run", "build", "-w", "backend"], ["run", "build", "-w", "frontend"]]);
    for (const call of calls) {
      assert.equal(call.command, "npm"); assert.equal(call.cwd, "/private/tmp/synthetic-reserve");
      assert.equal(call.env.NODE_ENV, expected); assert.equal(call.env.DOTENV_CONFIG_PATH, "/dev/null");
      assert.equal(call.env.npm_config_offline, "true");
    }
    assert.equal(calls[0].env.PRISMA_SCHEMA_ENGINE_BINARY, engines.PRISMA_SCHEMA_ENGINE_BINARY);
    assert.equal(calls[1].env.VITE_API_BASE_URL, "/api"); assert.equal(calls[1].env.VITE_PLATFORM_API_BASE_URL, "/platform-api");
    assert.equal(calls[1].env.DATABASE_URL, undefined); assert.equal(calls[1].env.PRISMA_SCHEMA_ENGINE_BINARY, undefined);
    assert.equal(fixtureEnv.NODE_ENV, "test"); assert.equal(engines.NODE_ENV, "test");
  }
});

test("an incomplete build cannot attest a completed backend/frontend pair", async () => {
  for (const failedWorkspace of ["backend", "frontend"]) {
    const attempted = [];
    await assert.rejects(buildApplicationRecoveryPair({ directory: "/private/tmp/synthetic-reserve", productionBuild: true, run: async (_command, commandArgs) => { const workspace = commandArgs.at(-1); attempted.push(workspace); if (workspace === failedWorkspace) throw new Error("Synthetic compilation failure"); } }), /Synthetic compilation failure/);
    assert.deepEqual(attempted, failedWorkspace === "backend" ? ["backend"] : ["backend", "frontend"]);
  }
  let calls = 0;
  await assert.rejects(buildApplicationRecoveryPair({ productionBuild: "production", run: async () => calls++ }), { name: "AssertionError" });
  assert.equal(calls, 0);
});

test("application fault recovery is explicit opt-in and keeps the pinned restore guards", () => {
  assert.equal(parseRestoreRecoveryOptions(args).applicationRecovery, undefined);
  assert.equal(parseRestoreRecoveryOptions([...args, "--application-recovery", ...reserve]).applicationRecovery, true);
  assert.throws(() => parseRestoreRecoveryOptions([...args, "--application-recovery", "--application-recovery"]));
  assert.throws(() => parseRestoreRecoveryOptions([...args, "--application-recovery", "true"]));
  assert.throws(() => parseRestoreRecoveryOptions(["--application-recovery"]));
  assert.throws(() => parseRestoreRecoveryOptions([...args, "--application-recovery"]));
  assert.throws(() => parseRestoreRecoveryOptions([...args, ...reserve]));
  assert.throws(() => parseRestoreRecoveryOptions([...args, "--application-recovery", "--recovery-source-sha", "b".repeat(40)]));
  assert.equal(parseRestoreRecoveryOptions([...args, "--application-recovery", ...reserve]).recoverySourceSha, "c".repeat(40));
  assert.throws(() => parseRestoreRecoveryOptions([...args, "--application-recovery", "--docker-host", "tcp://remote:2375"]));
});


test("cleanup still stops children, closes traffic and removes handlers if client restoration fails", async () => {
  const actions = []; const failure = new Error("Synthetic restoration failure");
  await assert.rejects(finalizeApplicationRecovery({ restoreClient: async () => { actions.push("restore"); throw failure; }, stopChildren: async () => { actions.push("stop"); }, closeGateway: async () => { actions.push("close"); }, removeSignalHandlers: () => { actions.push("handlers"); } }));
  assert.deepEqual(actions, ["restore", "stop", "close", "handlers"]);
});

test("cleanup still closes traffic and removes handlers if stopping a child fails", async () => {
  const actions = [];
  await assert.rejects(finalizeApplicationRecovery({ restoreClient: async () => { actions.push("restore"); }, stopChildren: async () => { actions.push("stop"); throw new Error("Synthetic child failure"); }, closeGateway: async () => { actions.push("close"); }, removeSignalHandlers: () => { actions.push("handlers"); } }));
  assert.deepEqual(actions, ["restore", "stop", "close", "handlers"]);
});
