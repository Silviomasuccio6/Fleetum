import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../../.github/workflows/deploy-staging.yml", import.meta.url), "utf8");
const database = readFileSync(new URL("../verify-database.sh", import.meta.url), "utf8");
const production = readFileSync(new URL("../../.github/workflows/deploy-production.yml", import.meta.url), "utf8");
const sha = "a".repeat(40);
const jobs = ["secret-scan", "sast", "verify", "tenant-isolation", "migration-compatibility", "lighthouse"];
const fixture = () => ({ repository: "Silviomasuccio6/Fleetum", runId: "123", event: "pull_request",
  sourceSha: sha, checkoutSha: sha, jobResults: Object.fromEntries(jobs.map(job => [job, { result: "success" }])) });

test("CI opt-in database flags and local dotenv guard are explicit", () => {
  const job = ci.split("  tenant-isolation:\n")[1].split("  migration-compatibility:\n")[0];
  assert.match(job, /RUN_TENANT_ISOLATION_TESTS: "1"/);
  assert.match(job, /DOTENV_CONFIG_PATH: \/dev\/null/);
  assert.match(database, /export DOTENV_CONFIG_PATH=\/dev\/null/);
});

test("every CI job checks the immutable head before using source", () => {
  assert.match(ci, /CI_SOURCE_SHA:.*github\.event\.pull_request\.head\.sha.*github\.sha/);
  assert.equal((ci.match(/ref: \$\{\{ env\.CI_SOURCE_SHA \}\}/g) ?? []).length, 7);
  assert.equal((ci.match(/ACTUAL_SHA.*git rev-parse HEAD/g) ?? []).length, 7);
  assert.equal((ci.match(/test "\$ACTUAL_SHA" = "\$CI_SOURCE_SHA"/g) ?? []).length, 7);
});

test("manual CI has an explicit migration baseline and cannot qualify as production push", async () => {
  assert.match(ci, /workflow_dispatch:[\s\S]*?previousReleaseSha:[\s\S]*?required: true/);
  assert.match(ci, /inputs\.previousReleaseSha/);
  assert.match(production, /verifyProductionCIRun/);
  const { verifyProductionCIRun } = await import('../production-release-policy.mjs');
  const expected = { repository: 'Silviomasuccio6/Fleetum', sourceSha: sha };
  const run = { id: 123, head_sha: sha, status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', path: '.github/workflows/ci.yml', head_repository: { full_name: expected.repository } };
  assert.equal(verifyProductionCIRun(run, expected).ok, true);
  for (const event of ['pull_request', 'workflow_dispatch', 'workflow_run']) {
    assert.equal(verifyProductionCIRun({ ...run, event }, expected).ok, false);
  }
});

test("staging requires successful CI source proof and publishes a post-health deploy artifact", () => {
  assert.match(ci, /source-attestation:[\s\S]*?needs: \[secret-scan, sast, verify, tenant-isolation, migration-compatibility, lighthouse\]/);
  assert.match(ci, /ci-source-proof-\$\{\{ github\.run_id \}\}/);
  assert.match(deploy, /ci-source-proof-\$\{\{ steps\.ci\.outputs\.ci_run_id \}\}/);
  assert.match(deploy, /node \.fleetum-control\/ops\/ci-release-identity\.mjs verify/);
  assert.match(deploy, /\["push", "pull_request", "workflow_dispatch"\]/);
  assert.ok(deploy.indexOf("Publish staging release proof") > deploy.indexOf("https://platform-staging.fleetum.it/api/health"));
  assert.match(deploy, /staging-release-proof-\$\{\{ github\.run_id \}\}/);
});

test("CI proof binds source and all successful jobs to its repository and run", async () => {
  const { createCIProof, verifyCIProof } = await import("../ci-release-identity.mjs");
  const proof = createCIProof(fixture());
  assert.equal(verifyCIProof(proof, { repository: fixture().repository, runId: "123", sourceSha: sha }), true);
  assert.equal(proof.schemaVersion, 1);
});

for (const [name, mutate] of [
  ["wrong checkout", p => { p.checkoutSha = "b".repeat(40); }],
  ["wrong source", p => { p.sourceSha = "b".repeat(40); }],
  ["foreign repository", p => { p.repository = "foreign/Fleetum"; }],
  ["other run", p => { p.runId = "124"; }],
  ["missing job", p => { delete p.jobResults["tenant-isolation"]; }],
  ["skipped job", p => { p.jobResults["tenant-isolation"].result = "skipped"; }],
  ["failed job", p => { p.jobResults.sast.result = "failure"; }],
  ["invalid event", p => { p.event = "pull_request_target"; }],
  ["invalid run", p => { p.runId = "0"; }]
]) {
  test(`CI proof rejects ${name}`, async () => {
    const { createCIProof, verifyCIProof } = await import("../ci-release-identity.mjs");
    const proof = { ...createCIProof(fixture()) };
    mutate(proof);
    assert.throws(() => verifyCIProof(proof, { repository: fixture().repository, runId: "123", sourceSha: sha }));
  });
}
