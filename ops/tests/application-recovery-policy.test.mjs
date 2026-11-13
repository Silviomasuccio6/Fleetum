import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecoveryPolicy,
  transitionRecovery,
  validateTrustedBundle,
} from "../recovery/application-recovery-policy.mjs";

const SOURCE = "9bd57ff2f935a3a56205f381b41d35bfc982dd9a";
const bundle = () => ({
  sourceSha: SOURCE,
  schemaVersion: 48,
  backend: { sourceSha: SOURCE, sha256: "a".repeat(64) },
  frontend: { sourceSha: SOURCE, sha256: "b".repeat(64) },
});
const policy = (options = {}) => createRecoveryPolicy({
  trustedBundle: bundle(), failureAtMs: 100, budgetMs: 30_000, readyMaxAgeMs: 1_000, ...options,
});
const event = (type, atMs, extra = {}) => ({ type, atMs, ...extra });
const stop = (state, atMs = 200) => transitionRecovery(state, event("stop", atMs));
const start = (state, atMs = 300) => transitionRecovery(state, event("start", atMs, { bundle: bundle() }));
const probe = (state, atMs = 400, overrides = {}) => ({
  status: 200,
  body: { ok: true, db: "up" },
  observedAtMs: atMs,
  generation: state.generation,
  bundle: bundle(),
  ...overrides,
});
const readyEvidence = (state, atMs = 400) => ({
  api: probe(state, atMs), platform: probe(state, atMs), schemaVersion: 48,
});
const ready = (state, atMs = 400, evidence = readyEvidence(state, atMs)) =>
  transitionRecovery(state, event("ready", atMs, { evidence }));
const dataEvidence = () => ({
  before: { count: 4, sha256: "c".repeat(64) },
  after: { count: 4, sha256: "c".repeat(64) },
});
const serving = () => {
  const started = start(stop(policy()));
  return transitionRecovery(ready(started), event("serve", 500, { dataEvidence: dataEvidence() }));
};

test("recovery preserves maintenance through the ordered phases and reports the local RTO and RPO", () => {
  const failed = policy();
  const stopped = stop(failed);
  const started = start(stopped);
  const verified = ready(started);
  const served = transitionRecovery(verified, event("serve", 500, { dataEvidence: dataEvidence() }));
  assert.deepEqual([failed.phase, stopped.phase, started.phase, verified.phase, served.phase],
    ["observedFailure", "stopped", "startingTrusted", "readyVerified", "serving"]);
  assert.ok([failed, stopped, started, verified].every((state) => state.maintenance));
  assert.equal(served.maintenance, false);
  assert.equal(served.generation, 1);
  assert.equal(served.rtoMs, 400);
  assert.equal(served.rpoAcknowledgedRecordsLost, 0);
  assert.deepEqual(served.history.map((item) => item.phase),
    ["observedFailure", "stopped", "startingTrusted", "readyVerified", "serving"]);
  assert.equal(failed.phase, "observedFailure");
  assert.equal(started.phase, "startingTrusted");
});

test("trusted manifests require full source and artifact identities with a consistent schema48 pair", () => {
  const invalid = [
    { ...bundle(), sourceSha: SOURCE.slice(0, 12) },
    { ...bundle(), sourceSha: SOURCE.toUpperCase() },
    { ...bundle(), sourceSha: "0".repeat(40) },
    { ...bundle(), schemaVersion: 42 },
    { ...bundle(), backend: { sourceSha: "d".repeat(40), sha256: "a".repeat(64) } },
    { ...bundle(), frontend: { sourceSha: SOURCE, sha256: "b".repeat(63) } },
    { ...bundle(), backend: { sha256: "a".repeat(64) } },
    { ...bundle(), frontend: undefined },
  ];
  assert.deepEqual(validateTrustedBundle(bundle()), bundle());
  for (const trustedBundle of invalid) {
    assert.throws(() => policy({ trustedBundle }));
  }
  const pinnedLater = bundle();
  pinnedLater.sourceSha = "e".repeat(40);
  pinnedLater.backend.sourceSha = pinnedLater.frontend.sourceSha = pinnedLater.sourceSha;
  assert.equal(policy({ trustedBundle: pinnedLater }).trustedBundle.sourceSha, pinnedLater.sourceSha);
});

test("starting a mixed backend/client artifact pair or a different source is rejected before readiness", () => {
  const state = stop(policy());
  for (const changed of [
    { ...bundle(), backend: { ...bundle().backend, sha256: "d".repeat(64) } },
    { ...bundle(), frontend: { ...bundle().frontend, sha256: "d".repeat(64) } },
    { ...bundle(), sourceSha: "d".repeat(40) },
  ]) assert.throws(() => transitionRecovery(state, event("start", 300, { bundle: changed })));
  assert.equal(state.phase, "stopped");
  assert.equal(state.maintenance, true);
  assert.throws(() => transitionRecovery(state, event("start", 300)));
});

test("start and stop are idempotent while interrupted startup requires a fresh generation", () => {
  const stopped = stop(policy());
  const twiceStopped = stop(stopped, 220);
  const started = start(twiceStopped);
  const twiceStarted = start(started, 320);
  assert.equal(twiceStopped.phase, "stopped");
  assert.equal(twiceStarted.generation, 1);
  assert.equal(twiceStarted.startedAtMs, 300);
  const interrupted = transitionRecovery(twiceStarted, event("startupInterrupted", 350));
  assert.equal(interrupted.phase, "observedFailure");
  assert.equal(interrupted.maintenance, true);
  assert.throws(() => start(interrupted, 370));
  const resumed = start(stop(interrupted, 370), 380);
  assert.equal(resumed.generation, 2);
  const stale = readyEvidence(resumed, 400);
  stale.api.generation = stale.platform.generation = 1;
  assert.throws(() => ready(resumed, 400, stale));
  assert.equal(resumed.maintenance, true);
  assert.equal(ready(resumed, 400).phase, "readyVerified");
});

test("API200 alone, a down database, a failing platform and malformed bodies cannot release maintenance", () => {
  const state = start(stop(policy()));
  const variants = [
    { api: probe(state), schemaVersion: 48 },
    { ...readyEvidence(state), api: probe(state, 400, { status: 503 }) },
    { ...readyEvidence(state), api: probe(state, 400, { body: { ok: true, db: "down" } }) },
    { ...readyEvidence(state), api: probe(state, 400, { body: { ok: false, db: "up" } }) },
    { ...readyEvidence(state), platform: probe(state, 400, { status: 503 }) },
    { ...readyEvidence(state), platform: probe(state, 400, { body: { ok: true } }) },
    { ...readyEvidence(state), schemaVersion: 42 },
  ];
  for (const evidence of variants) assert.throws(() => ready(state, 400, evidence));
  assert.throws(() => transitionRecovery(state, event("serve", 400, { dataEvidence: dataEvidence() })));
  assert.equal(state.phase, "startingTrusted");
  assert.equal(state.maintenance, true);
});

test("both current-generation ready probes must match the trusted backend/client artifact identities", () => {
  const state = start(stop(policy()));
  for (const name of ["api", "platform"]) {
    for (const artifact of ["backend", "frontend"]) {
      const evidence = readyEvidence(state);
      evidence[name].bundle[artifact].sha256 = "f".repeat(64);
      assert.throws(() => ready(state, 400, evidence));
    }
    const evidence = readyEvidence(state);
    evidence[name].bundle = undefined;
    assert.throws(() => ready(state, 400, evidence));
  }
  assert.equal(state.maintenance, true);
});

test("readiness evidence from before this startup, the future, an old generation or past freshness is rejected", () => {
  const state = start(stop(policy()));
  for (const name of ["api", "platform"]) {
    for (const overrides of [
      { observedAtMs: 299 }, { observedAtMs: 401 }, { generation: 0 },
      { observedAtMs: undefined }, { observedAtMs: NaN }, { generation: "1" },
    ]) {
      const evidence = readyEvidence(state);
      evidence[name] = probe(state, 400, overrides);
      assert.throws(() => ready(state, 400, evidence));
    }
  }
  assert.throws(() => ready(state, 1_401, readyEvidence(state, 400)));
  const verified = ready(state);
  assert.throws(() => transitionRecovery(verified, event("serve", 1_401, { dataEvidence: dataEvidence() })));
  assert.equal(verified.maintenance, true);
});

test("the scenario uses a bounded monotonic local budget and never accepts invalid timing limits", () => {
  for (const budgetMs of [0, -1, 30_001, Infinity, NaN, "30000", 1.5]) {
    assert.throws(() => policy({ budgetMs }));
  }
  for (const readyMaxAgeMs of [0, -1, 30_001, Infinity, "1000"]) {
    assert.throws(() => policy({ readyMaxAgeMs }));
  }
  for (const atMs of [-1, NaN, Infinity, "200", Number.MAX_SAFE_INTEGER + 1, 99]) {
    assert.throws(() => stop(policy(), atMs));
  }
  const state = start(stop(policy()));
  assert.throws(() => ready(state, 30_101, readyEvidence(state, 30_101)));
  const boundary = ready(state, 30_100, readyEvidence(state, 30_100));
  const served = transitionRecovery(boundary, event("serve", 30_100, { dataEvidence: dataEvidence() }));
  assert.equal(served.rtoMs, 30_000);
  const decimalTime = stop(policy({ failureAtMs: 100.25 }), 200.5);
  assert.equal(decimalTime.lastAtMs, 200.5);
});

test("serving requires exact receipts for acknowledged data and reports no accepted loss", () => {
  const state = ready(start(stop(policy())));
  for (const receipt of [
    undefined,
    { before: dataEvidence().before },
    { ...dataEvidence(), after: { ...dataEvidence().after, count: 3 } },
    { ...dataEvidence(), after: { ...dataEvidence().after, sha256: "d".repeat(64) } },
    { ...dataEvidence(), before: { ...dataEvidence().before, count: -1 } },
    { ...dataEvidence(), after: { ...dataEvidence().after, count: "4" } },
  ]) assert.throws(() => transitionRecovery(state, event("serve", 500, { dataEvidence: receipt })));
  assert.equal(state.maintenance, true);
  assert.equal(serving().rpoAcknowledgedRecordsLost, 0);
});

test("the controller offers no database restore, down SQL, replay or arbitrary deployment transition", () => {
  const state = stop(policy());
  for (const type of ["restoreDatabase", "downSql", "replay", "deploy", "serve"]) {
    assert.throws(() => transitionRecovery(state, event(type, 300)));
  }
  for (const forbidden of ["restoreDatabase", "downSql", "replay", "workers", "deploy"]) {
    assert.throws(() => transitionRecovery(state, event("start", 300, { bundle: bundle(), [forbidden]: true })));
  }
  assert.equal(state.maintenance, true);
});

test("policy snapshots protect the trusted pair and readiness evidence from later caller mutations", () => {
  const trustedBundle = bundle();
  const initial = policy({ trustedBundle });
  trustedBundle.frontend.sha256 = "f".repeat(64);
  const started = start(stop(initial));
  const evidence = readyEvidence(started);
  const verified = ready(started, 400, evidence);
  evidence.api.bundle.backend.sha256 = "f".repeat(64);
  evidence.api.body.db = "down";
  assert.equal(verified.trustedBundle.frontend.sha256, "b".repeat(64));
  assert.equal(verified.readyEvidence.api.bundle.backend.sha256, "a".repeat(64));
  assert.equal(verified.readyEvidence.api.body.db, "up");
  assert.ok(Object.isFrozen(verified));
  assert.ok(Object.isFrozen(verified.trustedBundle.frontend));
  assert.ok(Object.isFrozen(verified.history));
  assert.equal(transitionRecovery(verified, event("serve", 500, { dataEvidence: dataEvidence() })).phase, "serving");
});

test("an observed application failure or explicit stop immediately holds an already serving client", () => {
  const state = serving();
  const failed = transitionRecovery(state, event("observedFailure", 600));
  const stopped = stop(state, 600);
  assert.equal(failed.phase, "observedFailure");
  assert.equal(stopped.phase, "stopped");
  assert.equal(failed.maintenance, true);
  assert.equal(stopped.maintenance, true);
  assert.equal(failed.readyEvidence, null);
  assert.equal(stopped.readyEvidence, null);
});

test("an expired local recovery budget permits a safe maintenance hold but cannot authorize restart or serving", () => {
  const state = serving();
  const stopped = stop(state, 30_101);
  const failed = transitionRecovery(state, event("observedFailure", 30_101));
  assert.equal(stopped.maintenance, true);
  assert.equal(failed.maintenance, true);
  assert.equal(stopped.budgetExceeded, true);
  assert.equal(failed.budgetExceeded, true);
  assert.throws(() => start(stopped, 30_102));
  const starting = start(stop(policy()));
  const interrupted = transitionRecovery(starting, event("startupInterrupted", 30_101));
  assert.equal(interrupted.maintenance, true);
  assert.equal(interrupted.budgetExceeded, true);
  assert.throws(() => ready(starting, 30_101, readyEvidence(starting, 30_101)));
});
