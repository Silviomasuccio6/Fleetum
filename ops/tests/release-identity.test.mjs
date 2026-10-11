import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const workflowPath = new URL("../../.github/workflows/deploy-production.yml", import.meta.url);
const workflow = await readFile(workflowPath, "utf8");
const parsed = createRequire(import.meta.url)("js-yaml").load(workflow);

test("release identity is selected once and reused by every production job", () => {
  assert.match(workflow, /resolve-release:\n[\s\S]*?release_sha: \$\{\{ steps\.release\.outputs\.release_sha \}\}/);
  assert.deepEqual(Object.keys(parsed.on), ["workflow_dispatch"]);
  const gate = parsed.jobs["resolve-release"];
  assert.equal(gate.steps[0].with.ref, "${{ github.workflow_sha }}");
  assert.match(gate.steps.find(step => step.name === "Bind explicit release and protected workflow before effects").run,
    /node ops\/production-release-policy\.mjs/);
  const proofIndex = gate.steps.findIndex(step => step.name === "Verify complete actual source proof");
  const outputIndex = gate.steps.findIndex(step => step.id === "release");
  assert.ok(proofIndex >= 0 && outputIndex > proofIndex);

  const immutableCheckoutRefs = workflow.match(
    /ref: \$\{\{ needs\.resolve-release\.outputs\.release_sha \}\}/g,
  );
  assert.equal(immutableCheckoutRefs?.length, 3, "SAST, build and deploy must checkout the same SHA");
  assert.doesNotMatch(workflow, /github\.event\.inputs\.ref \|\| 'main'/);
});

test("manual production releases require a successful CI run for the exact SHA", () => {
  const gate = parsed.jobs["resolve-release"];
  const ci = gate.steps.find(step => step.name === "Require exact successful current main CI");
  assert.equal(ci.env.RELEASE_SHA, "${{ inputs.ref }}");
  assert.match(ci.with.script, /workflow_id:'ci\.yml',head_sha:sourceSha,branch:'main',event:'push',status:'completed'/);
  assert.match(ci.with.script, /exclude_pull_requests:\s*true/);
  assert.match(ci.with.script, /head\.sha !== sourceSha/);
  assert.match(ci.with.script, /verifyProductionCIRun\(r,\{repository,sourceSha\}\)\.ok/);
  assert.match(ci.with.script, /if \(!run\) throw new Error\('Exact successful push\/main CI missing\.'\)/);
  const download = gate.steps.find(step => step.uses?.startsWith("actions/download-artifact"));
  assert.equal(download.with.name, "ci-source-proof-${{ steps.ci.outputs.run_id }}");
  assert.equal(download.with["run-id"], "${{ steps.ci.outputs.run_id }}");
  assert.match(gate.steps.find(step => step.id === "release").run, /ci_run_id=\$CI_RUN_ID/);
  assert.doesNotMatch(workflow, /github\.event\.workflow_run/);
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

test("post-gate jobs use only the validated release identity, including failure paths", () => {
  for (const name of ["sast", "build-images", "deploy"]) {
    for (const step of parsed.jobs[name].steps) {
      if (step.env?.FLEETUM_RELEASE_SHA) {
        assert.equal(step.env.FLEETUM_RELEASE_SHA, "${{ needs.resolve-release.outputs.release_sha }}");
      }
    }
  }
  assert.equal(parsed.permissions.issues, undefined);
  assert.doesNotMatch(workflow, /needs\.resolve-release\.outputs\.release_sha \|\|/);
  assert.doesNotMatch(workflow, /Production deploy failed for commit \\`\$\{context\.sha\}/);
});

test("deployment manifests are staged and promoted only while holding the VPS lock", () => {
  assert.match(
    workflow,
    /\.\/ "\$FLEETUM_VPS_USER@\$FLEETUM_VPS_HOST:\$FLEETUM_APP_DIR\/\.deploy-staging\/\$FLEETUM_RELEASE_SHA\/"/,
  );
  assert.match(workflow, /exec 9>'\$FLEETUM_DEPLOY_LOCK_FILE'; flock -n 9; gateway_id=.*?rsync -a/);
  assert.match(workflow, /DEPLOY_LOCK_HELD=true FLEETUM_SHARED_STAGING_INGRESS='\$FLEETUM_SHARED_STAGING_INGRESS' FLEETUM_RELEASE_SHA=/);
  assert.doesNotMatch(
    workflow,
    /\.\/ "\$FLEETUM_VPS_USER@\$FLEETUM_VPS_HOST:\$FLEETUM_APP_DIR\/"/,
  );
});
