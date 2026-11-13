import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
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
const productionWorkflow = await readFile(
  new URL("../../.github/workflows/deploy-production.yml", import.meta.url),
  "utf8",
);

function imageNameScript(source, stepName) {
  const step = source.split(`      - name: ${stepName}\n`)[1]?.split("\n      - name: ")[0];
  assert(step, "image-name step must exist");
  const script = step.split("        run: |\n")[1];
  assert(script, "image-name step must have an executable script");
  return script.split("\n").map((line) => line.replace(/^          /, "")).join("\n");
}

test("staging and production image publication cannot collide for the same full source SHA", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fleetum-staging-tags-"));
  const sha = "a".repeat(40);
  try {
    const bin = path.join(directory, "bin");
    await mkdir(bin);
    await writeFile(path.join(bin, "git"), `#!/bin/sh\nprintf '%s\\n' '${sha}'\n`);
    await chmod(path.join(bin, "git"), 0o700);
    const resolveNames = async (source, name, label, releaseSha = sha) => {
      const output = path.join(directory, `${label}.txt`);
      const result = spawnSync("/bin/bash", ["-c", imageNameScript(source, name)], {
        env: { PATH: bin, FLEETUM_RELEASE_SHA: releaseSha, GITHUB_OUTPUT: output },
        encoding: "utf8",
      });
      if (releaseSha !== sha) {
        assert.notEqual(result.status, 0, "mismatching checkout must not publish image names");
        return;
      }
      assert.equal(result.status, 0, result.stderr);
      return Object.fromEntries((await readFile(output, "utf8")).trim().split("\n").map((line) => line.split("=")));
    };
    const staging = await resolveNames(workflow, "Resolve SHA-tagged image names", "staging");
    const production = await resolveNames(productionWorkflow, "Resolve image names", "production");
    for (const role of ["backend", "frontend"]) {
      assert.notEqual(staging[`${role}_image`], production[`${role}_image`], "environment builds must not overwrite the same GHCR tag");
      assert.equal(staging[`${role}_image`], `ghcr.io/silviomasuccio6/fleetum-${role}:staging-${sha}`);
      assert.equal(production[`${role}_image`], `ghcr.io/silviomasuccio6/fleetum-${role}:${sha}`);
    }
    await resolveNames(workflow, "Resolve SHA-tagged image names", "wrong-source", "b".repeat(40));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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
  assert.match(workflow, /fleetum-backend:staging-\$\{FLEETUM_RELEASE_SHA\}/);
  assert.match(workflow, /fleetum-frontend:staging-\$\{FLEETUM_RELEASE_SHA\}/);
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
