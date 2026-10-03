import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { captureRuntime } from "../e2e/capture-staging-runtime.mjs";
import {
  validateBindingInputs, verifyDeployRun, verifyReleaseProof, verifySourceHead,
  verifyRuntimeSnapshot, verifyRuntimeContinuity, validateSshTarget, READONLY_INSPECT_COMMAND
} from "../e2e/staging-release-binding.mjs";

const sha = "a".repeat(40);
const context = { repository: "silviomasuccio6/fleetum", releaseSha: sha, stagingRunId: "42", controlSha: "b".repeat(40) };
const environment = { GITHUB_REPOSITORY: context.repository, E2E_RELEASE_SHA: sha, E2E_STAGING_RUN_ID: "42", FLEETUM_STAGING_TRUSTED_WORKFLOW_SHA: context.controlSha };
const workflow = { id: 7, path: ".github/workflows/deploy-staging.yml", name: "Deploy Staging" };
const run = { id: 42, workflow_id: 7, status: "completed", conclusion: "success", event: "workflow_dispatch", repository: { full_name: context.repository }, head_repository: { full_name: context.repository }, head_sha: "b".repeat(40) };
const proof = { schemaVersion: 1, repository: context.repository, releaseSha: sha, ciRunId: 21, deployRunId: 42, backendImage: `ghcr.io/silviomasuccio6/fleetum-backend@sha256:${"c".repeat(64)}`, frontendImage: `ghcr.io/silviomasuccio6/fleetum-frontend@sha256:${"d".repeat(64)}`, completed: true, isolationPolicyVersion: 1, controlSha: context.controlSha };
const inspect = () => [
  { image: proof.backendImage, running: true, containerId: "e".repeat(64), startedAt: "2026-10-02T09:00:00.000000000Z", restartCount: 0, stagingMode: true, emailDisabled: true, dunningDisabled: true, retentionDisabled: true, retentionGlobalDisabled: true, privateNetworkOnly: true, privateNetworkId: "1".repeat(64), forbiddenEnv: "DO-NOT-COPY" },
  { image: proof.frontendImage, running: true, containerId: "f".repeat(64), startedAt: "2026-10-02T09:00:00.000000000Z", restartCount: 0 },
  { internal: true, networkId: "1".repeat(64), name: "fleetum_staging_private" }
];

test("binding fails closed for missing, malformed, or unsafe SHA/run IDs", () => {
  assert.equal(validateBindingInputs(environment).ok, true);
  for (const change of [{ E2E_RELEASE_SHA: "" }, { E2E_RELEASE_SHA: "main" }, { E2E_STAGING_RUN_ID: "" }, { E2E_STAGING_RUN_ID: "0" }, { E2E_STAGING_RUN_ID: "-1" }, { E2E_STAGING_RUN_ID: "42e0" }, { E2E_STAGING_RUN_ID: "9007199254740993" }]) {
    assert.equal(validateBindingInputs({ ...environment, ...change }).ok, false, JSON.stringify(change));
  }
  assert.equal(verifySourceHead(sha, sha).ok, true);
  assert.equal(verifySourceHead("b".repeat(40), sha).ok, false);
});

test("deploy proof binds a successful run to workflow/repository, independent of dispatch head SHA", () => {
  assert.equal(verifyDeployRun(run, workflow, context).ok, true);
  for (const change of [{ id: 43 }, { workflow_id: 8 }, { status: "in_progress" }, { conclusion: "failure" }, { event: "pull_request" }, { repository: { full_name: "other/repo" } }, { head_repository: { full_name: "other/repo" } }]) {
    assert.equal(verifyDeployRun({ ...run, ...change }, workflow, context).ok, false, JSON.stringify(change));
  }
  assert.equal(verifyDeployRun(run, { ...workflow, path: ".github/workflows/ci.yml" }, context).ok, false);
});

test("artifact requires completed matching release and full immutable backend/frontend images", () => {
  assert.equal(verifyReleaseProof(proof, context).ok, true);
  for (const change of [{ schemaVersion: 2 }, { repository: "other/repo" }, { releaseSha: "b".repeat(40) }, { deployRunId: 43 }, { ciRunId: 0 }, { completed: false }, { backendImage: "ghcr.io/silviomasuccio6/fleetum-backend:latest" }, { frontendImage: `ghcr.io/other/fleetum-frontend@sha256:${"d".repeat(64)}` }, { backendImage: `ghcr.io/silviomasuccio6/fleetum-backend@sha256:${"c".repeat(63)}` }]) {
    assert.equal(verifyReleaseProof({ ...proof, ...change }, context).ok, false, JSON.stringify(change));
  }
});

test("runtime observes only expected immutable running containers and emits a redacted snapshot", () => {
  const result = verifyRuntimeSnapshot(inspect(), proof);
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(result.snapshot), /DO-NOT-COPY|forbiddenEnv|ghcr\.io/);
  assert.equal(result.snapshot.releaseSha, sha);
  for (const change of [{ image: `${proof.backendImage.split("@")[0]}:latest` }, { image: proof.frontendImage }, { running: false }, { containerId: "bad" }, { startedAt: "" }, { restartCount: -1 }]) {
    const values = inspect(); values[0] = { ...values[0], ...change };
    assert.equal(verifyRuntimeSnapshot(values, proof).ok, false, JSON.stringify(change));
  }
  assert.equal(verifyRuntimeSnapshot([inspect()[0]], proof).ok, false);
});

test("runtime continuity rejects replacement, digest changes, stopped containers, and same-ID restart", () => {
  const baseline = verifyRuntimeSnapshot(inspect(), proof).snapshot;
  assert.equal(verifyRuntimeContinuity(baseline, structuredClone(baseline)).ok, true);
  for (const change of [{ containerId: "0".repeat(64) }, { digest: `sha256:${"0".repeat(64)}` }, { running: false }, { startedAt: "2026-10-02T10:00:00.000000000Z" }, { restartCount: 1 }]) {
    const after = structuredClone(baseline); Object.assign(after.backend, change);
    assert.equal(verifyRuntimeContinuity(baseline, after).ok, false, JSON.stringify(change));
  }
  assert.equal(verifyRuntimeContinuity(baseline, { ...baseline, releaseSha: "b".repeat(40) }).ok, false);
});

test("SSH target rejects injection and inspection command is fixed and emits only allowlisted safety booleans", () => {
  assert.equal(validateSshTarget("staging.example.test", "fleetum").ok, true);
  assert.equal(validateSshTarget("10.20.30.40", "fleetum_staging").ok, true);
  for (const host of ["", "-oProxyCommand=id", "host;id", "host/path", "host\nother", "999.20.30.40"]) assert.equal(validateSshTarget(host, "fleetum").ok, false);
  for (const user of ["", "-oProxyCommand", "user;id", "user name", "root@other"]) assert.equal(validateSshTarget("staging.example.test", user).ok, false);
  assert.match(READONLY_INSPECT_COMMAND, /^docker inspect --format /);
  assert.match(READONLY_INSPECT_COMMAND, /\.Config\.Image/);
  assert.match(READONLY_INSPECT_COMMAND, /\.State\.Running/);
  assert.match(READONLY_INSPECT_COMMAND, /\.State\.StartedAt/);
  assert.match(READONLY_INSPECT_COMMAND, /\.RestartCount/);
  assert.match(READONLY_INSPECT_COMMAND, /fleetum_staging_backend fleetum_staging_caddy/);
  assert.doesNotMatch(READONLY_INSPECT_COMMAND, /json \.Config\.Env|\b(?:compose|exec|restart|pull|up)\b|;|&&/);
  assert.match(READONLY_INSPECT_COMMAND, /FLEETUM_ENVIRONMENT=staging/);
  assert.match(READONLY_INSPECT_COMMAND, /EMAIL_PROVIDER=disabled/);
});

const sshEnvironment = {
  PATH: process.env.PATH,
  FLEETUM_STAGING_HOST: "staging.example.test",
  FLEETUM_STAGING_USER: "fleetum",
  FLEETUM_STAGING_SSH_KEY: "SYNTHETIC-KEY-FOR-MOCK-ONLY",
  FLEETUM_STAGING_KNOWN_HOSTS: "staging.example.test ssh-ed25519 SYNTHETIC-PIN-FOR-MOCK-ONLY",
  E2E_TENANT_PASSWORD: "DO-NOT-PASS-THIS-SECRET"
};

test("readonly SSH pins host trust, restricts process environment, protects and cleans temporary credentials", () => {
  let keyPath, knownHostsPath;
  const snapshot = captureRuntime(proof, { env: sshEnvironment, execute(command, args, options) {
    assert.equal(command, "ssh");
    assert.deepEqual(args.slice(0, 2), ["-F", "/dev/null"]);
    assert.ok(args.includes("StrictHostKeyChecking=yes"));
    assert.ok(args.includes("GlobalKnownHostsFile=/dev/null"));
    keyPath = args[args.indexOf("-i") + 1];
    knownHostsPath = args.find((argument) => argument.startsWith("UserKnownHostsFile=")).split("=")[1];
    assert.equal(statSync(keyPath).mode & 0o777, 0o600);
    assert.equal(statSync(knownHostsPath).mode & 0o777, 0o600);
    assert.match(readFileSync(knownHostsPath, "utf8"), /SYNTHETIC-PIN-FOR-MOCK-ONLY/);
    assert.equal(args.at(-1), READONLY_INSPECT_COMMAND);
    assert.equal(options.timeout, 30_000);
    assert.deepEqual(Object.keys(options.env).sort(), ["LC_ALL", "PATH"]);
    assert.doesNotMatch(JSON.stringify(options.env), /DO-NOT-PASS-THIS-SECRET|SYNTHETIC-KEY/);
    return { status: 0, stdout: inspect().map((value) => JSON.stringify(value)).join("\n") };
  } });
  assert.equal(snapshot.releaseSha, sha);
  assert.equal(existsSync(keyPath), false);
  assert.equal(existsSync(knownHostsPath), false);
});

test("missing host trust fails before SSH and failed observation hides SSH stderr and cleans the key", () => {
  let calls = 0, keyPath;
  assert.throws(() => captureRuntime(proof, { env: { ...sshEnvironment, FLEETUM_STAGING_KNOWN_HOSTS: "" }, execute() { calls += 1; } }), /pinned known_hosts/);
  assert.equal(calls, 0);
  assert.throws(() => captureRuntime(proof, { env: sshEnvironment, execute(_command, args) {
    keyPath = args[args.indexOf("-i") + 1];
    return { status: 255, stderr: "DO-NOT-PRINT-SSH-SECRETS" };
  } }), { message: "Readonly staging container observation failed." });
  assert.equal(existsSync(keyPath), false);
});


test("staging release rejects legacy proof without isolation policy", () => {
  const legacy = { ...proof }; delete legacy.isolationPolicyVersion;
  assert.equal(verifyReleaseProof(legacy, context).ok, false);
  assert.equal(verifyReleaseProof({ ...proof, isolationPolicyVersion: 2 }, context).ok, false);
});

test("staging runtime rejects unsafe or absent isolation flags and continuity checks policy", () => {
  for (const field of ["stagingMode", "emailDisabled", "dunningDisabled", "retentionDisabled", "retentionGlobalDisabled"]) {
    for (const value of [false, undefined, "true"]) {
      const observed = inspect(); observed[0][field] = value;
      assert.equal(verifyRuntimeSnapshot(observed, proof).ok, false, field);
    }
  }
  const baseline = verifyRuntimeSnapshot(inspect(), proof).snapshot;
  const after = structuredClone(baseline); after.isolationPolicyVersion = 0;
  assert.equal(verifyRuntimeContinuity(baseline, after).ok, false);
});


test("staging runtime requires exclusively the attested internal backend network", () => {
  for (const change of [{ privateNetworkOnly: false }, { privateNetworkId: "2".repeat(64) }, { privateNetworkId: null }]) {
    const observed = inspect(); Object.assign(observed[0], change);
    assert.equal(verifyRuntimeSnapshot(observed, proof).ok, false);
  }
  for (const change of [{ internal: false }, { name: "other_network" }, { networkId: "2".repeat(64) }]) {
    const observed = inspect(); Object.assign(observed[2], change);
    assert.equal(verifyRuntimeSnapshot(observed, proof).ok, false);
  }
});


test("release proof and deploy run reject unapproved control revisions", () => {
  assert.equal(verifyReleaseProof({ ...proof, controlSha: "0".repeat(40) }, context).ok, false);
  assert.equal(verifyDeployRun({ ...run, head_sha: "0".repeat(40) }, workflow, context).ok, false);
});
