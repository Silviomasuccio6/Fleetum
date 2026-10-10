import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { verifyControlPolicy } from "../staging/control-policy.mjs";
const approved = { GITHUB_WORKFLOW_SHA: "a".repeat(40), FLEETUM_STAGING_TRUSTED_WORKFLOW_SHA: "a".repeat(40), RELEASE_SHA: "b".repeat(40), FLEETUM_STAGING_APPROVED_RELEASE_SHA: "b".repeat(40) };
test("CI green alone cannot authorize a control or release revision", () => {
  assert.equal(verifyControlPolicy(approved).ok, true);
  for (const change of [{ FLEETUM_STAGING_TRUSTED_WORKFLOW_SHA: "" }, { FLEETUM_STAGING_APPROVED_RELEASE_SHA: "" }, { GITHUB_WORKFLOW_SHA: "c".repeat(40) }, { RELEASE_SHA: "c".repeat(40) }]) assert.equal(verifyControlPolicy({ ...approved, ...change }).ok, false);
});
test("remote preflight rejects symlink targets and orphan services without modifying fixtures", () => {
  const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "fleetum-target-preflight-")));
  try {
    const base = path.join(scratch, "staging");
    for (const name of ["app", "env", "postgres", "uploads", "logs", "bin"]) mkdirSync(path.join(base, name), { recursive: true });
    for (const name of ["backend.env", "compose.env"]) writeFileSync(path.join(base, "env", name), "SYNTHETIC-NOT-READ");
    const script = readFileSync(new URL("../staging/target-preflight.sh", import.meta.url), "utf8").replaceAll("/opt/fleetum-staging", base);
    const file = path.join(scratch, "check.sh"); writeFileSync(file, script);
    const docker = path.join(base, "bin", "docker");
    writeFileSync(docker, '#!/bin/sh\ncase "$1" in ps) printf "%s\\n" "${MOCK_MEMBERS:-}";; *) exit 1;; esac\n', { mode: 0o700 });
    writeFileSync(path.join(base, "bin", "realpath"), `#!${process.execPath}\nprocess.stdout.write(require("node:fs").realpathSync(process.argv.at(-1))+"\\n");\n`, { mode: 0o700 });
    const env = { PATH: `${path.dirname(docker)}:/usr/bin:/bin`, MOCK_MEMBERS: "fleetum_staging_backend" };
    const run = (changes = {}) => spawnSync("sh", [file, "a".repeat(40)], { env: { ...env, ...changes }, encoding: "utf8" });
    assert.equal(run().status, 0);
    assert.equal(run({ MOCK_MEMBERS: "fleetum_staging_worker_orphan" }).status, 1);
    const sentinel = path.join(scratch, "production"); mkdirSync(sentinel); writeFileSync(path.join(sentinel, "unchanged"), "UNCHANGED");
    symlinkSync(sentinel, path.join(base, "app", "deploy"));
    assert.equal(run().status, 1);
    assert.equal(readFileSync(path.join(sentinel, "unchanged"), "utf8"), "UNCHANGED");
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
test("deploy executes observer and gates from the trusted workflow checkout", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/deploy-staging.yml", import.meta.url), "utf8");
  assert.match(workflow, /ref: \$\{\{ github\.workflow_sha \}\}/);
  assert.match(workflow, /node \.fleetum-control\/ops\/e2e\/capture-staging-runtime\.mjs deploy/);
  const helper = readFileSync(new URL("../staging/run-deploy.sh", import.meta.url), "utf8");
  assert.match(helper, /--project-name fleetum-staging/g);
  assert.match(workflow, /\.fleetum-control\/ops\/staging\/run-deploy\.sh/);
  assert.match(workflow, /target-preflight\.sh/);
});
