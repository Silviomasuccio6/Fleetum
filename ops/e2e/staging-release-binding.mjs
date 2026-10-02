import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const positiveId = (value) => /^[1-9][0-9]*$/.test(String(value ?? "")) && Number.isSafeInteger(Number(value));
const result = (errors, extra = {}) => ({ ok: errors.length === 0, errors, ...extra });
const imagePattern = (role) => new RegExp(`^ghcr\\.io/silviomasuccio6/fleetum-${role}@sha256:[0-9a-f]{64}$`);

export function validateBindingInputs(env = process.env) {
  const errors = [];
  if (!SHA.test(env.E2E_RELEASE_SHA ?? "")) errors.push("E2E_RELEASE_SHA must be a full lowercase 40-character commit SHA.");
  if (!positiveId(env.E2E_STAGING_RUN_ID)) errors.push("E2E_STAGING_RUN_ID must be a positive safe integer run ID.");
  if (!REPOSITORY.test(env.GITHUB_REPOSITORY ?? "")) errors.push("GITHUB_REPOSITORY must identify the expected owner/repository.");
  return result(errors, { releaseSha: env.E2E_RELEASE_SHA, stagingRunId: env.E2E_STAGING_RUN_ID, repository: env.GITHUB_REPOSITORY });
}

export function verifySourceHead(head, releaseSha) {
  return result(SHA.test(releaseSha ?? "") && head === releaseSha ? [] : ["Checked-out HEAD does not match the bound release SHA."]);
}

export function verifyDeployRun(run, workflow, { repository, stagingRunId }) {
  const errors = [];
  if (!positiveId(stagingRunId) || Number(run?.id) !== Number(stagingRunId)) errors.push("Deploy run ID does not match the requested staging run.");
  if (!positiveId(workflow?.id) || workflow.path !== ".github/workflows/deploy-staging.yml" || workflow.name !== "Deploy Staging" || run?.workflow_id !== workflow.id) errors.push("Run does not belong to the Deploy Staging workflow.");
  if (run?.status !== "completed" || run?.conclusion !== "success" || run?.event !== "workflow_dispatch") errors.push("Deploy Staging run must have completed successfully through workflow dispatch.");
  if (!REPOSITORY.test(repository ?? "") || run?.repository?.full_name !== repository || run?.head_repository?.full_name !== repository) errors.push("Deploy Staging run repository does not match the expected repository.");
  // A dispatch run's head_sha identifies its workflow ref, not necessarily its deployed release.
  return result(errors);
}

export function verifyReleaseProof(proof, { repository, releaseSha, stagingRunId }) {
  const errors = [];
  if (proof?.schemaVersion !== 1 || proof?.completed !== true) errors.push("Release proof must use schemaVersion 1 and record a completed deploy.");
  if (!REPOSITORY.test(repository ?? "") || proof?.repository !== repository) errors.push("Release proof repository does not match.");
  if (!SHA.test(releaseSha ?? "") || proof?.releaseSha !== releaseSha) errors.push("Release proof SHA does not match the requested release.");
  if (!positiveId(stagingRunId) || !positiveId(proof?.deployRunId) || Number(proof.deployRunId) !== Number(stagingRunId)) errors.push("Release proof deployRunId does not match the verified staging run.");
  if (!positiveId(proof?.ciRunId)) errors.push("Release proof requires a positive CI run ID.");
  if (!imagePattern("backend").test(proof?.backendImage ?? "")) errors.push("Release proof backend image must be a full immutable Fleetum GHCR digest.");
  if (!imagePattern("frontend").test(proof?.frontendImage ?? "")) errors.push("Release proof frontend image must be a full immutable Fleetum GHCR digest.");
  return result(errors);
}

export const READONLY_INSPECT_COMMAND = `docker inspect --format '{"image":{{json .Config.Image}},"running":{{json .State.Running}},"containerId":{{json .Id}},"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}}}' fleetum_staging_backend fleetum_staging_caddy`;

export function validateSshTarget(host, user) {
  const errors = [];
  const labels = String(host ?? "").split(".");
  const isHostname = typeof host === "string" && host.length <= 253 && labels.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
  const looksIpv4 = /^[0-9.]+$/.test(host ?? "");
  const validIpv4 = labels.length === 4 && labels.every((label) => /^[0-9]{1,3}$/.test(label) && Number(label) <= 255);
  if (!isHostname || (looksIpv4 && !validIpv4)) errors.push("Staging SSH host must be a safe hostname or IPv4 address.");
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(user ?? "")) errors.push("Staging SSH user contains unsupported characters.");
  return result(errors);
}

function validRuntimeEntry(entry) {
  return entry && /^sha256:[0-9a-f]{64}$/.test(entry.digest ?? "") && CONTAINER_ID.test(entry.containerId ?? "") && entry.running === true
    && typeof entry.startedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(entry.startedAt)
    && Number.isSafeInteger(entry.restartCount) && entry.restartCount >= 0;
}

export function verifyRuntimeSnapshot(inspections, proof) {
  const errors = [];
  const snapshot = { schemaVersion: 1, releaseSha: proof?.releaseSha };
  if (!Array.isArray(inspections) || inspections.length !== 2 || !SHA.test(proof?.releaseSha ?? "")) return result(["Runtime observation must contain both bound staging containers."]);
  for (const [index, role] of ["backend", "frontend"].entries()) {
    const observed = inspections[index];
    const expectedImage = proof[`${role}Image`];
    const entry = { digest: typeof observed?.image === "string" ? observed.image.split("@")[1] : undefined, containerId: observed?.containerId, running: observed?.running, startedAt: observed?.startedAt, restartCount: observed?.restartCount };
    if (!imagePattern(role).test(expectedImage ?? "") || observed?.image !== expectedImage || !validRuntimeEntry(entry)) errors.push(`Staging ${role} does not match the running immutable release identity.`);
    snapshot[role] = entry;
  }
  if (snapshot.backend.containerId === snapshot.frontend.containerId) errors.push("Backend and frontend must be distinct containers.");
  return result(errors, errors.length ? {} : { snapshot });
}

export function verifyRuntimeContinuity(before, after) {
  const errors = [];
  if (before?.schemaVersion !== 1 || after?.schemaVersion !== 1 || !SHA.test(before?.releaseSha ?? "") || before.releaseSha !== after.releaseSha) errors.push("Runtime observations must belong to the same release.");
  for (const role of ["backend", "frontend"]) {
    if (!validRuntimeEntry(before?.[role]) || !validRuntimeEntry(after?.[role]) || ["digest", "containerId", "running", "startedAt", "restartCount"].some((key) => before[role][key] !== after[role][key])) errors.push(`Staging ${role} identity or restart state changed during E2E execution.`);
  }
  return result(errors);
}

export function requireReleaseBinding(proofPath, runMetadataPath, env = process.env) {
  const binding = validateBindingInputs(env);
  if (!binding.ok) throw new Error(binding.errors.join(" "));
  let proof, metadata;
  try { proof = JSON.parse(readFileSync(proofPath, "utf8")); metadata = JSON.parse(readFileSync(runMetadataPath, "utf8")); }
  catch { throw new Error("Unable to read valid staging release and verified run proofs."); }
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const checks = [verifySourceHead(head.status === 0 ? head.stdout.trim() : "", binding.releaseSha), verifyDeployRun(metadata.run, metadata.workflow, binding), verifyReleaseProof(proof, binding)];
  const errors = checks.flatMap((check) => check.errors);
  if (errors.length) throw new Error(errors.join(" "));
  return proof;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv[2] !== "validate" || process.argv.length !== 5) throw new Error("Usage: staging-release-binding.mjs validate <release-proof> <verified-run-proof>");
    requireReleaseBinding(process.argv[3], process.argv[4]);
    console.log("Staging source, deploy run and immutable release proof match.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
