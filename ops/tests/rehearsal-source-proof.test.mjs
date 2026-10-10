import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const createFixture = (t, initializeGit = true) => {
  const root = mkdtempSync(join(tmpdir(), "fleetum-rehearsal-source-proof-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceRoot = join(root, "checkout");
  const bin = join(root, "bin");
  mkdirSync(join(sourceRoot, "ops/e2e"), { recursive: true });
  mkdirSync(bin);
  for (const file of ["ops/verify-local-rehearsal.mjs", "ops/e2e/validate-config.mjs", "ops/e2e/rehearsal-options.mjs", "ops/e2e/rehearsal-source-proof.mjs"]) {
    if (existsSync(join(repositoryRoot, file))) copyFileSync(join(repositoryRoot, file), join(sourceRoot, file));
  }
  for (const directory of ["backend", "frontend", "website"]) mkdirSync(join(sourceRoot, directory));
  writeFileSync(join(sourceRoot, ".gitignore"), "ignored.txt\n");
  writeFileSync(join(sourceRoot, "tracked.txt"), "committed source\n");
  const dockerTrace = join(root, "docker-trace");
  writeFileSync(join(bin, "docker"), `#!/bin/bash\nprintf '%s\\n' "$*" >> '${dockerTrace}'\nexit 197\n`, { mode: 0o700 });
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: root, TMPDIR: root, DOTENV_CONFIG_PATH: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd: sourceRoot, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  let head = "a".repeat(40);
  if (initializeGit) {
    git("init", "--quiet");
    git("add", ".");
    git("-c", "user.name=Synthetic rehearsal", "-c", "user.email=rehearsal@example.invalid", "commit", "--quiet", "-m", "Synthetic source fixture");
    head = git("rev-parse", "HEAD");
  }
  return { root, sourceRoot, env, git, head, evidence: join(root, "evidence"), dockerTrace };
};
const run = (fixture, sourceSha = fixture.head) => spawnSync(process.execPath, [join(fixture.sourceRoot, "ops/verify-local-rehearsal.mjs"), "--run", "--source-sha", sourceSha, "--evidence-dir", fixture.evidence], { cwd: fixture.sourceRoot, env: fixture.env, encoding: "utf8" });

for (const scenario of ["wrong SHA", "tracked changes", "staged changes", "untracked source", "non-Git directory"]) {
  test(`actual runner rejects ${scenario} before evidence or Docker allocation`, (t) => {
    const fixture = createFixture(t, scenario !== "non-Git directory");
    let suppliedSha = fixture.head;
    if (scenario === "wrong SHA") suppliedSha = fixture.head === "a".repeat(40) ? "b".repeat(40) : "a".repeat(40);
    if (["tracked changes", "staged changes"].includes(scenario)) writeFileSync(join(fixture.sourceRoot, "tracked.txt"), "changed source\n");
    if (scenario === "staged changes") fixture.git("add", "tracked.txt");
    if (scenario === "untracked source") writeFileSync(join(fixture.sourceRoot, "untracked.txt"), "extra source\n");
    const result = run(fixture, suppliedSha);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(fixture.evidence), false, "source rejection must precede evidence allocation");
    assert.equal(existsSync(fixture.dockerTrace), false, "no Docker executable may run before source proof");
    assert.match(result.stderr, /source SHA|clean checkout|Git source/);
  });
}

test("clean source proof records the exact HEAD, tree and status", async (t) => {
  const fixture = createFixture(t);
  const { verifyRehearsalSourceProof } = await import("../e2e/rehearsal-source-proof.mjs");
  const proof = verifyRehearsalSourceProof(fixture.sourceRoot, fixture.head);
  assert.equal(proof.head, fixture.head);
  assert.equal(proof.tree, fixture.git("rev-parse", "HEAD^{tree}"));
  assert.deepEqual(proof.status, { clean: true, trackedChanges: 0, untrackedChanges: 0 });
});

test("ignored local output does not change source proof", async (t) => {
  const fixture = createFixture(t);
  writeFileSync(join(fixture.sourceRoot, "ignored.txt"), "ignored fixture output\n");
  const { verifyRehearsalSourceProof } = await import("../e2e/rehearsal-source-proof.mjs");
  assert.equal(verifyRehearsalSourceProof(fixture.sourceRoot, fixture.head).head, fixture.head);
});

test("proof rejects a repository subdirectory", async (t) => {
  const fixture = createFixture(t);
  const { verifyRehearsalSourceProof } = await import("../e2e/rehearsal-source-proof.mjs");
  assert.throws(() => verifyRehearsalSourceProof(join(fixture.sourceRoot, "ops"), fixture.head), /repository root/);
});

test("invalid source identity is rejected before Git execution", async (t) => {
  const { verifyRehearsalSourceProof } = await import("../e2e/rehearsal-source-proof.mjs");
  assert.throws(() => verifyRehearsalSourceProof("/nonexistent-synthetic-source", "main"), /source SHA/);
});

test("actual runner includes verified source proof in its isolated failure summary", (t) => {
  const fixture = createFixture(t);
  const result = run(fixture);
  assert.equal(result.status, 1, "fixture deliberately lacks a working Docker daemon");
  const summary = JSON.parse(readFileSync(join(fixture.evidence, "summary.json"), "utf8"));
  assert.equal(summary.sourceSha, fixture.head);
  assert.equal(summary.sourceProof.head, fixture.head);
  assert.equal(summary.sourceProof.tree, fixture.git("rev-parse", "HEAD^{tree}"));
  assert.deepEqual(summary.sourceProof.status, { clean: true, trackedChanges: 0, untrackedChanges: 0 });
  assert.equal(summary.success, false);
});
