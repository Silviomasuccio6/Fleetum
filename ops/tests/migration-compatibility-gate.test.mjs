import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";

const script = await readFile(
  new URL("../verify-migration-compatibility.sh", import.meta.url),
  "utf8",
);
const ci = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

test("migration compatibility gate uses the real preceding release and synthetic data", () => {
  assert.match(script, /PREVIOUS_RELEASE_REF/);
  assert.match(script, /git merge-base --is-ancestor/);
  assert.match(script, /existing Prisma migrations are immutable/);
  assert.match(script, /git archive "\$PREVIOUS_RELEASE_SHA"/);
  assert.match(script, /npm ci --ignore-scripts/);
  assert.match(script, /compat-fixture\.mjs/);
  assert.match(script, /compat_deposit/);
  assert.match(script, /compat_email/);
  assert.match(script, /compat_demo_lead/);
  assert.match(script, /EmailQueue lease columns missing/);
  assert.match(script, /RentalBookingCreateRequest table missing/);
  assert.match(script, /rental booking idempotency constraint missing/);
  assert.match(script, /contract email command ledger missing/);
  assert.match(script, /invoice email command ledger missing/);
  assert.match(script, /demo idempotency columns missing/);
  assert.match(script, /DOTENV_CONFIG_PATH=\/dev\/null/);
});

test("candidate migrations run after the preceding schema and before old-app smoke tests", () => {
  const oldMigrations = script.indexOf("Applying the previous release migrations");
  const candidateMigrations = script.indexOf("Applying candidate migrations over historical synthetic data");
  const oldApp = script.indexOf("Starting the previous application against the migrated schema");
  assert.ok(oldMigrations >= 0 && candidateMigrations > oldMigrations && oldApp > candidateMigrations);
  assert.match(script, /previous release readiness must pass/);
  assert.match(script, /previous release login must pass/);
  assert.match(script, /previous release must serve an authenticated business read/);
});

test("hosted CI runs the compatibility gate with complete Git history", () => {
  assert.match(ci, /migration-compatibility:/);
  assert.match(ci, /fetch-depth: 0/);
  assert.match(ci, /PREVIOUS_RELEASE_REF: \$\{\{ github\.event_name == 'pull_request'/);
  assert.match(ci, /npm run verify:migration-compatibility/);
});

// Exercise Docker stdin semantics on the actual assertion block; the rest of the
// integration gate is tested separately against temporary PostgreSQL.
test("migration SQL assertions are actually forwarded into Docker", async () => {
  const { mkdtemp, writeFile, chmod, readFile: read, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const block = script.match(/docker exec[^\n]+<<'SQL'[^\n]*\n[\s\S]*?\nSQL/);
  assert(block, "SQL validation block must exist");
  const directory = await mkdtemp(join(tmpdir(), "fleetum-compat-stdin-"));
  try {
    const capture = join(directory, "received.sql");
    const docker = join(directory, "docker");
    await writeFile(docker, '#!/bin/sh\nif [ "$2" = "-i" ]; then cat > "$CAPTURE_PATH"; else : > "$CAPTURE_PATH"; fi\n');
    await chmod(docker, 0o700);
    const result = spawnSync("/bin/bash", ["-c", block[0]], {
      env: { PATH: `${directory}:/usr/bin:/bin`, CAPTURE_PATH: capture, CONTAINER_NAME: "synthetic", DB_USER: "synthetic", DB_NAME: "synthetic" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const sql = await read(capture, "utf8");
    assert(sql.includes("DO $$") && sql.includes("historical rental deposit was not preserved"),
      "all migration assertions must reach PostgreSQL stdin");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const relativePath of [".env", "backend/.env", "backend/prisma/.env", "prisma/.env"]) {
  for (const kind of ["unreadable file", "dangling symlink"]) {
    test(`rejects ${relativePath} as a ${kind} before allocation or external tools`, async (t) => {
      const root = await mkdtemp(join(tmpdir(), "fleetum-compat-dotenv-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      const operations = join(root, "ops");
      const bin = join(root, "bin");
      const gateTemp = join(root, "gate-temp");
      const log = join(root, "calls.log");
      await Promise.all([operations, bin, gateTemp].map((path) => mkdir(path)));
      const helper = join(operations, "verify-migration-compatibility.sh");
      await copyFile(new URL("../verify-migration-compatibility.sh", import.meta.url), helper);

      // All dotenv artifacts are synthetic. Mode 000 makes content reads fail;
      // dangling links must also be blocked even though test -e is false.
      const dotenvPath = join(root, relativePath);
      await mkdir(dirname(dotenvPath), { recursive: true });
      if (kind === "dangling symlink") {
        await symlink(join(root, "missing-synthetic-env"), dotenvPath);
      } else {
        await writeFile(dotenvPath, "SYNTHETIC_ONLY_DO_NOT_READ=true\n", { mode: 0o000 });
      }

      for (const tool of ["docker", "git", "npm", "npx", "mktemp"]) {
        const body = tool === "mktemp"
          ? 'exec /usr/bin/mktemp "$@"\n'
          : tool === "docker" ? 'exit 0\n' : 'exit 97\n';
        const executable = join(bin, tool);
        await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' '${tool}' >> "$CALL_LOG"\n${body}`);
        await chmod(executable, 0o700);
      }

      const result = spawnSync("/bin/bash", [helper], {
        encoding: "utf8",
        timeout: 5_000,
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          TMPDIR: gateTemp,
          CALL_LOG: log
        }
      });
      const calls = await readFile(log, "utf8").catch((error) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      assert.equal(result.error, undefined);
      assert.equal(calls, "", "the filename guard must precede allocation, Docker, Git, npm and Prisma");
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /dotenv.*filename.*present/i);
      assert(result.stderr.includes(dotenvPath), "the guard identifies the blocked filename");
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SYNTHETIC_ONLY_DO_NOT_READ/);
    });
  }
}

const historicalTool = String.raw`#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const { basename } = require("node:path");
const { spawnSync } = require("node:child_process");
const tool = basename(process.argv[1]);
const argv = process.argv.slice(2);
appendFileSync(process.env.CALL_LOG, JSON.stringify({ tool, argv }) + "\n");
if (tool === "docker") process.exit(argv[0] === "info" ? 0 : 95);
if (tool === "mktemp") {
  const result = spawnSync("/usr/bin/mktemp", argv, { encoding: "utf8" });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status);
}
if (tool === "tar") {
  // The mocked archive intentionally fails without emitting an archive. Drain
  // its stdin without letting GNU/BSD tar's empty-input policy mask exit 97.
  readFileSync(0);
  process.exit(0);
}
if (tool !== "git") process.exit(96);
if (argv[0] === "rev-parse") {
  process.stdout.write((argv[1] === "HEAD" ? "b" : "a").repeat(40) + "\n");
  process.exit(0);
}
if (argv[0] === "merge-base") process.exit(0);
if (argv[0] === "diff") {
  process.stdout.write((argv.includes("--name-status") ? "A\t" : "") + "backend/prisma/migrations/synthetic/migration.sql\n");
  process.exit(0);
}
if (argv[0] === "ls-tree") {
  if (process.env.TREE_FAILURE === "true") process.exit(98);
  const files = JSON.parse(readFileSync(process.env.FILES_PATH, "utf8"));
  const separator = argv.includes("-z") ? "\0" : "\n";
  process.stdout.write(files.join(separator) + separator);
  process.exit(0);
}
// Reaching archive is a deliberate boundary failure: no real Git contents or
// dependencies are read, and no PostgreSQL container can be created.
process.exit(97);
`;

const runHistoricalFixture = async (t, files, treeFailure = false) => {
  const root = await mkdtemp(join(tmpdir(), "fleetum-compat-archive-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const operations = join(root, "ops");
  const bin = join(root, "bin");
  const gateTemp = join(root, "gate-temp");
  const log = join(root, "calls.jsonl");
  const filesPath = join(root, "synthetic-tree.json");
  await Promise.all([operations, bin, gateTemp].map((path) => mkdir(path)));
  const helper = join(operations, "verify-migration-compatibility.sh");
  await copyFile(new URL("../verify-migration-compatibility.sh", import.meta.url), helper);
  await writeFile(filesPath, JSON.stringify(files));
  for (const tool of ["docker", "git", "npm", "npx", "mktemp", "tar"]) {
    await writeFile(join(bin, tool), historicalTool, { mode: 0o700 });
  }
  const result = spawnSync("/bin/bash", [helper], {
    encoding: "utf8",
    timeout: 5_000,
    env: {
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      TMPDIR: gateTemp,
      CALL_LOG: log,
      FILES_PATH: filesPath,
      TREE_FAILURE: String(treeFailure)
    }
  });
  assert.equal(result.error, undefined);
  return { root, result, calls: (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse) };
};

const assertHistoricalReadBoundary = (calls) => {
  assert.deepEqual(calls.filter((call) => call.tool === "docker"), [{ tool: "docker", argv: ["info"] }]);
  assert(!calls.some((call) => ["mktemp", "npm", "npx"].includes(call.tool)),
    "an unsafe historical tree must fail before allocation or dependency/Prisma tools");
  assert(!calls.some((call) => call.tool === "git" && call.argv[0] === "archive"),
    "historical dotenv content must never reach git archive");
  assert(!calls.some((call) => call.tool === "tar"),
    "an unsafe historical tree must never reach archive extraction");
};

for (const filename of [".env", "backend/.env.production", "backend/prisma/.env", "prisma/.env.local", "nested/.env.staging", ".environment", '.env"quoted', ".env\nnewline"]) {
  test(`rejects tracked historical dotenv filename ${JSON.stringify(filename)} before archive`, async (t) => {
    const { result, calls } = await runHistoricalFixture(t, [".env.example", filename]);
    assertHistoricalReadBoundary(calls);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /dotenv.*filename.*previous release/i);
  });
}

test("historical dotenv example filenames may reach the archive boundary", async (t) => {
  const { root, result, calls } = await runHistoricalFixture(t, [".env.example", "backend/.env.test.example", "nested/ordinary.txt"]);
  assert.equal(result.status, 97, result.stderr);
  assert.deepEqual(calls.filter((call) => call.tool === "git" && call.argv[0] === "archive"),
    [{ tool: "git", argv: ["archive", "a".repeat(40)] }],
    "example templates must not be rejected as dotenv configuration");
  const extraction = calls.filter((call) => call.tool === "tar");
  assert.equal(extraction.length, 1, "the pinned archive must reach the extraction pipeline exactly once");
  assert.deepEqual(extraction[0].argv.slice(0, 2), ["-x", "-C"]);
  assert.equal(extraction[0].argv.length, 3);
  assert.equal(dirname(dirname(extraction[0].argv[2])), join(root, "gate-temp"));
  assert(extraction[0].argv[2].startsWith(`${join(root, "gate-temp", "fleetum-migration-compat.")}`));
  assert.equal(basename(extraction[0].argv[2]), "previous");
  assert(!calls.some((call) => ["npm", "npx"].includes(call.tool)));
});

test("a failed historical filename listing stops before archive and mutations", async (t) => {
  const { result, calls } = await runHistoricalFixture(t, [], true);
  assertHistoricalReadBoundary(calls);
  assert.equal(result.status, 98, result.stderr);
});
