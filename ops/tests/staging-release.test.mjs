import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../../.github/workflows/deploy-staging.yml", import.meta.url),
  "utf8",
);
const compose = await readFile(
  new URL("../../docker-compose.staging.yml", import.meta.url),
  "utf8",
);
const runbook = await readFile(
  new URL("../../docs/deployment/staging.md", import.meta.url),
  "utf8",
);

test("staging resolves one immutable release and requires CI for that exact SHA", () => {
  assert.match(
    workflow,
    /resolve-release:\n[\s\S]*?release_sha: \$\{\{ steps\.release\.outputs\.release_sha \}\}/,
  );
  assert.match(workflow, /ref: \$\{\{ inputs\.ref \}\}/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);

  const immutableCheckoutRefs = workflow.match(
    /ref: \$\{\{ needs\.resolve-release\.outputs\.release_sha \}\}/g,
  );
  assert.equal(immutableCheckoutRefs?.length, 2, "build and deploy must use the resolved SHA");

  assert.match(workflow, /name: Require successful CI for the release SHA/);
  assert.match(workflow, /workflow_id: "ci\.yml"/);
  assert.match(workflow, /head_sha: releaseSha/);
  assert.match(workflow, /run\.head_sha === releaseSha/);
  assert.match(workflow, /run\.conclusion === "success"/);
  assert.match(workflow, /run\.head_repository\?\.full_name === expectedRepository/);
  assert.match(workflow, /core\.setOutput\("ci_run_id", String\(successfulRun\.id\)\)/);
});

test("staging publishes SHA tags and deploys only their immutable digests", () => {
  assert.match(workflow, /fleetum-backend:\$\{FLEETUM_RELEASE_SHA\}/);
  assert.match(workflow, /fleetum-frontend:\$\{FLEETUM_RELEASE_SHA\}/);
  assert.doesNotMatch(workflow, /staging-latest/);
  assert.doesNotMatch(workflow, /rev-parse --short/);
  assert.match(workflow, /id: build_backend/);
  assert.match(workflow, /id: build_frontend/);
  assert.match(workflow, /BACKEND_DIGEST: \$\{\{ steps\.build_backend\.outputs\.digest \}\}/);
  assert.match(workflow, /FRONTEND_DIGEST: \$\{\{ steps\.build_frontend\.outputs\.digest \}\}/);
  assert.match(workflow, /backend_image=ghcr\.io\/silviomasuccio6\/fleetum-backend@\$BACKEND_DIGEST/);
  assert.match(workflow, /frontend_image=ghcr\.io\/silviomasuccio6\/fleetum-frontend@\$FRONTEND_DIGEST/);
  assert.match(workflow, /FLEETUM_RELEASE_SHA: \$\{\{ needs\.resolve-release\.outputs\.release_sha \}\}/);
  assert.match(workflow, /Deploy checkout does not match the resolved release SHA/);
});

test("staging compose refuses an implicit or mutable application image", () => {
  assert.match(compose, /image: \$\{FLEETUM_BACKEND_IMAGE:\?[^\n]+\}/);
  assert.match(compose, /image: \$\{FLEETUM_FRONTEND_IMAGE:\?[^\n]+\}/);
  assert.doesNotMatch(compose, /staging-latest|:latest/);
});

test("staging runbook requires CI-backed SHA and records digest identity", () => {
  assert.match(runbook, /CI[^\n]*SHA/i);
  assert.match(runbook, /digest/i);
  assert.doesNotMatch(runbook, /staging-latest/);
});
