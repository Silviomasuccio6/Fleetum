import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parseRehearsalOptions } from "../e2e/rehearsal-options.mjs";

const sha = "a".repeat(40);
test("rehearsal opt-in requires a full release SHA and accepts only known single options", () => {
  assert.deepEqual(parseRehearsalOptions([]), { run: false, sourceSha: null, evidenceDirectory: null });
  assert.deepEqual(parseRehearsalOptions(["--run", "--source-sha", sha]), { run: true, sourceSha: sha, evidenceDirectory: null });
  assert.deepEqual(parseRehearsalOptions(["--evidence-dir", "/private/tmp/evidence", "--source-sha", sha, "--run"]), { run: true, sourceSha: sha, evidenceDirectory: "/private/tmp/evidence" });
});

test("rehearsal rejects missing, duplicate, positional or unsupported options and invalid SHAs", () => {
  for (const args of [
    ["--run"], ["--run", "--run", "--source-sha", sha], ["--run", "--source-sha"],
    ["--run", "--source-sha", "main"], ["--run", "--source-sha", "a".repeat(39)],
    ["--run", "--source-sha", sha, "--source-sha", sha], ["--run", "--source-sha", sha, "--evidence-dir"],
    ["--run", "--source-sha", sha, "--evidence-dir", "/private/tmp/one", "--evidence-dir", "/private/tmp/two"],
    ["--run", "--source-sha", sha, "--unknown"], ["--run", "--source-sha", sha, "extra"],
    ["--source-sha", sha], ["--evidence-dir", "/private/tmp/evidence"], ["--help"]
  ]) assert.throws(() => parseRehearsalOptions(args), Error, JSON.stringify(args));
});

test("evidence destination must be a safe absolute non-root directory without traversal", () => {
  for (const directory of ["relative/path", "", "/", "/private/tmp/../elsewhere", "/private/tmp/./evidence", "/private/tmp/evidence/", "/private//tmp/evidence", "/private/tmp/evidence\n", "/private/tmp/evidence\0", "https://staging.fleetum.it", "--source-sha"]) {
    assert.throws(() => parseRehearsalOptions(["--run", "--source-sha", sha, "--evidence-dir", directory]), Error, directory);
  }
});

test("runner rejects malformed arguments before allocating resources or touching destinations", () => {
  const runner = readFileSync("ops/verify-local-rehearsal.mjs", "utf8");
  const parsePosition = runner.indexOf("parseRehearsalOptions(process.argv.slice(2))");
  assert.ok(parsePosition >= 0 && parsePosition < runner.indexOf("const scratch = await mkdtemp"));
  const directory = `/private/tmp/fleetum-staging-isolation-e2e-options-${process.pid}`;
  for (const args of [["--run", "--evidence-dir", directory], ["--run", "--source-sha", sha, "--evidence-dir", directory, "--unknown"], ["--run", "--source-sha", sha, "--source-sha", sha, "--evidence-dir", directory]]) {
    const child = spawnSync(process.execPath, ["ops/verify-local-rehearsal.mjs", ...args], { encoding: "utf8", env: { PATH: process.env.PATH, DOTENV_CONFIG_PATH: "/dev/null" } });
    assert.equal(child.status, 1);
    assert.equal(existsSync(directory), false);
    assert.doesNotMatch(child.stderr, /Starting isolated PostgreSQL|DO-NOT-LOG/);
  }
});
