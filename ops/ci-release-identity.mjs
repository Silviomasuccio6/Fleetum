import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_CI_JOBS = ["secret-scan", "sast", "verify", "tenant-isolation", "migration-compatibility", "lighthouse"];
const shaPattern = /^[0-9a-f]{40}$/;
const validRun = value => typeof value === "string" && /^[1-9][0-9]*$/.test(value);

export function verifyCIProof(proof, { repository, runId, sourceSha }) {
  assert.equal(proof?.schemaVersion, 1, "Unsupported CI source proof");
  assert.ok(typeof repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), "Expected repository identity");
  assert.ok(shaPattern.test(sourceSha), "Expected full source SHA");
  assert.ok(validRun(String(runId)), "Expected positive CI run ID");
  assert.equal(proof.repository, repository, "CI repository mismatch");
  assert.equal(proof.runId, String(runId), "CI run mismatch");
  assert.ok(validRun(proof.runId), "Invalid CI run ID");
  assert.equal(proof.sourceSha, sourceSha, "CI source mismatch");
  assert.equal(proof.checkoutSha, sourceSha, "CI checkout mismatch");
  assert.ok(["push", "pull_request", "workflow_dispatch"].includes(proof.event), "Unsupported CI event");
  assert.deepEqual(Object.keys(proof.jobResults ?? {}).sort(), [...REQUIRED_CI_JOBS].sort(), "CI jobs incomplete");
  for (const job of REQUIRED_CI_JOBS) assert.equal(proof.jobResults[job]?.result, "success", "CI job not successful");
  return true;
}

export function createCIProof(input) {
  const proof = { schemaVersion: 1, repository: input.repository, runId: String(input.runId), event: input.event,
    sourceSha: input.sourceSha, checkoutSha: input.checkoutSha, jobResults: input.jobResults };
  verifyCIProof(proof, input);
  return proof;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const [mode, file] = process.argv.slice(2);
    assert.ok(file, "Proof path required");
    const expected = { repository: process.env.GITHUB_REPOSITORY, runId: process.env.CI_RUN_ID ?? process.env.GITHUB_RUN_ID,
      sourceSha: process.env.RELEASE_SHA ?? process.env.CI_SOURCE_SHA };
    if (mode === "write") {
      const proof = createCIProof({ ...expected, checkoutSha: process.env.CI_ACTUAL_SHA,
        event: process.env.GITHUB_EVENT_NAME, jobResults: JSON.parse(process.env.CI_JOB_RESULTS ?? "null") });
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(proof, null, 2) + "\n");
    } else {
      assert.equal(mode, "verify", "Unsupported proof operation");
      assert.ok(readFileSync(file).length <= 64 * 1024, "CI proof too large");
      verifyCIProof(JSON.parse(readFileSync(file, "utf8")), expected);
    }
    console.log("CI source identity verified.");
  } catch {
    console.error("CI source proof is missing, invalid or differs from the release/run.");
    process.exitCode = 1;
  }
}
