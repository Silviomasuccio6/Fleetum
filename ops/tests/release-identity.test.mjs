import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../../.github/workflows/deploy-production.yml", import.meta.url);
const workflow = await readFile(workflowPath, "utf8");

test("release identity is selected once and reused by every production job", () => {
  assert.match(workflow, /resolve-release:\n[\s\S]*?release_sha: \$\{\{ steps\.release\.outputs\.release_sha \}\}/);
  assert.match(
    workflow,
    /ref: \$\{\{ github\.event_name == 'workflow_run' && github\.event\.workflow_run\.head_sha \|\| inputs\.ref \}\}/,
  );
  assert.match(workflow, /WORKFLOW_RUN_SHA: \$\{\{ github\.event_name == 'workflow_run'/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);

  const immutableCheckoutRefs = workflow.match(
    /ref: \$\{\{ needs\.resolve-release\.outputs\.release_sha \}\}/g,
  );
  assert.equal(immutableCheckoutRefs?.length, 3, "SAST, build and deploy must checkout the same SHA");
  assert.doesNotMatch(workflow, /github\.event\.inputs\.ref \|\| 'main'/);
});

test("manual production releases require a successful CI run for the exact SHA", () => {
  assert.match(workflow, /name: Require successful CI for manual release/);
  assert.match(workflow, /workflow_id: "ci\.yml"/);
  assert.match(workflow, /head_sha: releaseSha/);
  assert.match(workflow, /branch: "main"/);
  assert.match(workflow, /event: "push"/);
  assert.match(workflow, /exclude_pull_requests: true/);
  assert.match(workflow, /run\.head_sha === releaseSha &&\s+run\.conclusion === "success"/);
  assert.match(workflow, /run\.event === "push"/);
  assert.match(workflow, /run\.head_branch === "main"/);
  assert.match(workflow, /run\.head_repository\?\.full_name === expectedRepository/);
  assert.match(workflow, /core\.setFailed\(`No successful CI workflow run exists/);
  assert.match(workflow, /core\.setOutput\("ci_run_id", String\(successfulRun\.id\)\)/);
  assert.match(workflow, /WORKFLOW_RUN_ID: \$\{\{ github\.event_name == 'workflow_run' && github\.event\.workflow_run\.id/);
});

test("SHA-tagged images are deployed through the exact build digests", () => {
  assert.match(workflow, /fleetum-backend:\$\{FLEETUM_RELEASE_SHA\}/);
  assert.match(workflow, /fleetum-frontend:\$\{FLEETUM_RELEASE_SHA\}/);
  assert.doesNotMatch(workflow, /:latest/);
  assert.doesNotMatch(workflow, /rev-parse --short/);
  assert.match(workflow, /BACKEND_DIGEST: \$\{\{ steps\.build_backend\.outputs\.digest \}\}/);
  assert.match(workflow, /FRONTEND_DIGEST: \$\{\{ steps\.build_frontend\.outputs\.digest \}\}/);
  assert.match(
    workflow,
    /backend_image=ghcr\.io\/silviomasuccio6\/fleetum-backend@\$BACKEND_DIGEST/,
  );
  assert.match(
    workflow,
    /frontend_image=ghcr\.io\/silviomasuccio6\/fleetum-frontend@\$FRONTEND_DIGEST/,
  );
  assert.match(workflow, /backend_image: \$\{\{ steps\.deployment_images\.outputs\.backend_image \}\}/);
  assert.match(workflow, /frontend_image: \$\{\{ steps\.deployment_images\.outputs\.frontend_image \}\}/);
  assert.match(workflow, /backend_tag: \$\{\{ steps\.images\.outputs\.backend_image \}\}/);
  assert.match(workflow, /frontend_tag: \$\{\{ steps\.images\.outputs\.frontend_image \}\}/);
  assert.match(workflow, /FLEETUM_RELEASE_SHA='\$FLEETUM_RELEASE_SHA'/);
  assert.match(workflow, /FLEETUM_CI_RUN_ID='\$FLEETUM_CI_RUN_ID'/);
  assert.match(workflow, /FLEETUM_DEPLOY_RUN_ID='\$FLEETUM_DEPLOY_RUN_ID'/);
  assert.match(workflow, /FLEETUM_BACKEND_RELEASE_TAG='\$FLEETUM_BACKEND_RELEASE_TAG'/);
  assert.match(workflow, /FLEETUM_FRONTEND_RELEASE_TAG='\$FLEETUM_FRONTEND_RELEASE_TAG'/);
});

test("deploy failures report the selected release identity", () => {
  assert.match(
    workflow,
    /FLEETUM_RELEASE_SHA: \$\{\{ needs\.resolve-release\.outputs\.release_sha \|\| github\.event\.workflow_run\.head_sha/,
  );
  assert.match(workflow, /const releaseSha = process\.env\.FLEETUM_RELEASE_SHA \|\| "unresolved"/);
  assert.doesNotMatch(workflow, /Production deploy failed for commit \\`\$\{context\.sha\}/);
});

test("deployment manifests are staged and promoted only while holding the VPS lock", () => {
  assert.match(
    workflow,
    /\.\/ "\$FLEETUM_VPS_USER@\$FLEETUM_VPS_HOST:\$FLEETUM_APP_DIR\/\.deploy-staging\/\$FLEETUM_RELEASE_SHA\/"/,
  );
  assert.match(workflow, /exec 9>'\$FLEETUM_DEPLOY_LOCK_FILE'; flock -n 9; rsync -a/);
  assert.match(workflow, /DEPLOY_LOCK_HELD=true FLEETUM_RELEASE_SHA=/);
  assert.doesNotMatch(
    workflow,
    /\.\/ "\$FLEETUM_VPS_USER@\$FLEETUM_VPS_HOST:\$FLEETUM_APP_DIR\/"/,
  );
});
