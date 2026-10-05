import assert from "node:assert/strict";
import test from "node:test";
import { finalizeApplicationRecovery } from "../recovery/exercise-application-recovery.mjs";
import { parseRestoreRecoveryOptions } from "../verify-restore-recovery.mjs";

const reserve = ["--recovery-source-sha", "c".repeat(40)];
const args = ["--source-sha", "a".repeat(40), "--baseline-sha", "b".repeat(40), "--evidence-dir", "/private/tmp/fleetum-application-option"];
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
