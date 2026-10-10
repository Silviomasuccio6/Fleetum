// Pure policy for the local synthetic recovery drill. The caller selects the
// trusted pair and gathers process, filesystem, readiness and data evidence.
// This module neither performs recovery actions nor establishes production trust.
const MAX_LOCAL_BUDGET_MS = 30_000;
const SCHEMA_VERSION = 48;
const PHASES = new Set(["observedFailure", "stopped", "startingTrusted", "readyVerified", "serving"]);
const EVENT_FIELDS = {
  observedFailure: ["type", "atMs", "reason"],
  startupInterrupted: ["type", "atMs", "reason"],
  stop: ["type", "atMs", "reason"],
  start: ["type", "atMs", "bundle"],
  ready: ["type", "atMs", "evidence"],
  serve: ["type", "atMs", "dataEvidence"],
};

function requireValue(condition, message) {
  if (!condition) throw new Error(`Application recovery policy: ${message}`);
}

function object(value, name) {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
}

function fields(value, allowed, name) {
  object(value, name);
  requireValue(Object.keys(value).every((key) => allowed.includes(key)), `${name} contains an unsupported field or recovery action`);
}

function time(value, name) {
  requireValue(typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER,
    `${name} must be a finite non-negative monotonic timestamp`);
}

function limit(value, maximum, name) {
  requireValue(Number.isSafeInteger(value) && value > 0 && value <= maximum,
    `${name} must be an explicit integer from 1 to ${maximum}ms`);
}

function identity(value, length, name) {
  requireValue(typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value) && !/^0+$/.test(value),
    `${name} must be a complete lowercase hexadecimal identity`);
}

function freeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Validate and copy a caller-pinned source/artifact pair for schema48. */
export function validateTrustedBundle(bundle) {
  fields(bundle, ["sourceSha", "schemaVersion", "backend", "frontend"], "bundle");
  identity(bundle.sourceSha, 40, "sourceSha");
  requireValue(bundle.schemaVersion === SCHEMA_VERSION, "bundle must use schema48");
  const artifacts = {};
  for (const name of ["backend", "frontend"]) {
    fields(bundle[name], ["sourceSha", "sha256"], `${name} artifact`);
    identity(bundle[name].sourceSha, 40, `${name} sourceSha`);
    identity(bundle[name].sha256, 64, `${name} sha256`);
    requireValue(bundle[name].sourceSha === bundle.sourceSha, `${name} source must match the pinned source`);
    artifacts[name] = { sourceSha: bundle[name].sourceSha, sha256: bundle[name].sha256 };
  }
  return freeze({ sourceSha: bundle.sourceSha, schemaVersion: SCHEMA_VERSION, ...artifacts });
}

function trustedPair(candidate, trusted) {
  const checked = validateTrustedBundle(candidate);
  requireValue(checked.sourceSha === trusted.sourceSha && checked.schemaVersion === trusted.schemaVersion
    && checked.backend.sha256 === trusted.backend.sha256 && checked.frontend.sha256 === trusted.frontend.sha256,
  "backend/client artifacts must match the exact trusted pair");
  return checked;
}

/** Start one bounded local scenario in observedFailure with the client held. */
export function createRecoveryPolicy(options) {
  fields(options, ["trustedBundle", "failureAtMs", "budgetMs", "readyMaxAgeMs"], "options");
  const trustedBundle = validateTrustedBundle(options.trustedBundle);
  time(options.failureAtMs, "failureAtMs");
  limit(options.budgetMs, MAX_LOCAL_BUDGET_MS, "budgetMs");
  limit(options.readyMaxAgeMs, options.budgetMs, "readyMaxAgeMs");
  return freeze({
    scope: "local-synthetic",
    phase: "observedFailure",
    maintenance: true,
    trustedBundle,
    budgetMs: options.budgetMs,
    budgetExceeded: false,
    readyMaxAgeMs: options.readyMaxAgeMs,
    failureAtMs: options.failureAtMs,
    lastAtMs: options.failureAtMs,
    generation: 0,
    startedAtMs: null,
    verifiedAtMs: null,
    servingAtMs: null,
    readyEvidence: null,
    dataEvidence: null,
    rtoMs: null,
    rpoAcknowledgedRecordsLost: null,
    history: [{ type: "observedFailure", phase: "observedFailure", atMs: options.failureAtMs, generation: 0 }],
  });
}

function stateAndEvent(state, event) {
  object(state, "state");
  requireValue(state.scope === "local-synthetic" && PHASES.has(state.phase), "state must belong to a local recovery scenario");
  requireValue(state.maintenance === (state.phase !== "serving"), "state maintenance does not match the recovery phase");
  validateTrustedBundle(state.trustedBundle);
  limit(state.budgetMs, MAX_LOCAL_BUDGET_MS, "budgetMs");
  limit(state.readyMaxAgeMs, state.budgetMs, "readyMaxAgeMs");
  time(state.failureAtMs, "failureAtMs");
  time(state.lastAtMs, "lastAtMs");
  requireValue(Number.isSafeInteger(state.generation) && state.generation >= 0, "startup generation must be a non-negative integer");
  object(event, "event");
  requireValue(Object.hasOwn(EVENT_FIELDS, event.type), "unsupported recovery event");
  fields(event, EVENT_FIELDS[event.type], "event");
  time(event.atMs, "atMs");
  requireValue(event.atMs >= state.lastAtMs && state.lastAtMs >= state.failureAtMs, "timestamps must be monotonic");
  // A deadline prevents recovery approval, never a transition into maintenance.
  const safeHold = ["stop", "observedFailure", "startupInterrupted"].includes(event.type);
  requireValue(safeHold || event.atMs - state.failureAtMs <= state.budgetMs, "local scenario recovery budget exceeded");
  if (event.reason !== undefined) requireValue(typeof event.reason === "string" && event.reason.length <= 512, "reason must be a bounded string");
}

function verifyProbe(state, candidate, atMs, name) {
  fields(candidate, ["status", "body", "observedAtMs", "generation", "bundle"], `${name} readiness evidence`);
  object(candidate.body, `${name} readiness body`);
  requireValue(candidate.status === 200 && candidate.body.ok === true && candidate.body.db === "up",
    `${name} readiness requires HTTP200, ok=true and db=up`);
  requireValue(candidate.generation === state.generation, `${name} readiness belongs to an old startup generation`);
  time(candidate.observedAtMs, `${name} observedAtMs`);
  time(state.startedAtMs, "startedAtMs");
  requireValue(candidate.observedAtMs >= state.startedAtMs && candidate.observedAtMs <= atMs,
    `${name} readiness must be observed during the current startup`);
  requireValue(atMs - candidate.observedAtMs <= state.readyMaxAgeMs, `${name} readiness evidence is stale`);
  const bundle = trustedPair(candidate.bundle, state.trustedBundle);
  return {
    status: 200, body: { ok: true, db: "up" }, observedAtMs: candidate.observedAtMs,
    generation: candidate.generation, bundle,
  };
}

function verifyReadiness(state, evidence, atMs) {
  fields(evidence, ["api", "platform", "schemaVersion"], "readiness evidence");
  requireValue(evidence.schemaVersion === SCHEMA_VERSION, "readiness must attest schema48");
  return {
    api: verifyProbe(state, evidence.api, atMs, "API"),
    platform: verifyProbe(state, evidence.platform, atMs, "platform"),
    schemaVersion: SCHEMA_VERSION,
  };
}

function verifyAcknowledgedData(evidence) {
  fields(evidence, ["before", "after"], "acknowledged data evidence");
  const receipts = {};
  for (const name of ["before", "after"]) {
    fields(evidence[name], ["count", "sha256"], `${name} acknowledged data receipt`);
    requireValue(Number.isSafeInteger(evidence[name].count) && evidence[name].count >= 0,
      `${name} acknowledged record count must be a non-negative integer`);
    identity(evidence[name].sha256, 64, `${name} acknowledged data sha256`);
    receipts[name] = { count: evidence[name].count, sha256: evidence[name].sha256 };
  }
  requireValue(receipts.before.count === receipts.after.count && receipts.before.sha256 === receipts.after.sha256,
    "acknowledged data must match exactly for local RPO0");
  return receipts;
}

function next(state, event, changes) {
  const phase = changes.phase ?? state.phase;
  const generation = changes.generation ?? state.generation;
  const entry = { type: event.type, phase, atMs: event.atMs, generation };
  if (event.reason !== undefined) entry.reason = event.reason;
  return freeze({
    ...state, ...changes, phase, generation,
    budgetExceeded: event.atMs - state.failureAtMs > state.budgetMs,
    maintenance: phase !== "serving", lastAtMs: event.atMs,
    history: [...state.history, entry],
  });
}

const held = {
  startedAtMs: null, verifiedAtMs: null, servingAtMs: null,
  readyEvidence: null, dataEvidence: null, rtoMs: null, rpoAcknowledgedRecordsLost: null,
};

/**
 * Return an immutable snapshot or reject the event without changing its input.
 * stop/start are idempotent; interruption invalidates all previous ready probes.
 * Only fresh readiness plus exact acknowledged-data receipts permit serving.
 */
export function transitionRecovery(state, event) {
  stateAndEvent(state, event);
  switch (event.type) {
    case "observedFailure":
      return next(state, event, { ...held, phase: "observedFailure" });
    case "startupInterrupted":
      requireValue(state.phase === "startingTrusted", "startup interruption requires an in-progress startup");
      return next(state, event, { ...held, phase: "observedFailure" });
    case "stop":
      return next(state, event, { ...held, phase: "stopped" });
    case "start":
      trustedPair(event.bundle, state.trustedBundle);
      requireValue(state.phase === "stopped" || state.phase === "startingTrusted", "trusted startup must follow stop");
      if (state.phase === "startingTrusted") return next(state, event, {});
      requireValue(state.generation < Number.MAX_SAFE_INTEGER, "startup generation exceeded its safe limit");
      return next(state, event, { ...held, phase: "startingTrusted", startedAtMs: event.atMs, generation: state.generation + 1 });
    case "ready": {
      requireValue(state.phase === "startingTrusted", "ready verification must follow trusted startup");
      const readyEvidence = verifyReadiness(state, event.evidence, event.atMs);
      return next(state, event, { phase: "readyVerified", verifiedAtMs: event.atMs, readyEvidence });
    }
    case "serve": {
      requireValue(state.phase === "readyVerified", "serving requires verified readiness");
      verifyReadiness(state, state.readyEvidence, event.atMs);
      const dataEvidence = verifyAcknowledgedData(event.dataEvidence);
      return next(state, event, {
        phase: "serving", servingAtMs: event.atMs, dataEvidence,
        rtoMs: event.atMs - state.failureAtMs, rpoAcknowledgedRecordsLost: 0,
      });
    }
    default:
      throw new Error("Application recovery policy: unsupported recovery event");
  }
}
