import assert from "node:assert/strict";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const helper = resolve(dirname(fileURLToPath(import.meta.url)), "../restore-db-test.sh");
const container = "fleetum-restore-unit";
const target = "fleetum_restore_unit";
const user = "restore_user";
const backupSql = "-- trusted fixture\nCREATE TABLE restore_sentinel (id integer);\nINSERT INTO restore_sentinel VALUES (7);\n";

// This executable records the actual shell argv/stdin and models psql's default
// success exit after a SQL error, ON_ERROR_STOP, and CREATE's existing-db failure.
// It never invokes Docker or a database server.
const fakeDocker = String.raw`#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const argv = process.argv.slice(2);
const stdin = readFileSync(0, "utf8");
appendFileSync(process.env.RESTORE_FAKE_LOG, JSON.stringify({ argv, stdin }) + "\n");
const statePath = process.env.RESTORE_FAKE_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const value = (flag) => argv[argv.indexOf(flag) + 1];
const save = () => writeFileSync(statePath, JSON.stringify(state));
if (argv[0] !== "exec" || !argv.includes("psql")) process.exit(90);
if (argv.includes("-c")) {
  const sql = value("-c");
  const drop = /^DROP DATABASE IF EXISTS "([^"]+)";$/.exec(sql);
  const create = /^CREATE DATABASE "([^"]+)";$/.exec(sql);
  if (drop) {
    delete state[drop[1]];
    save();
    process.exit(0);
  }
  if (!create) process.exit(91);
  if (process.env.RESTORE_FAKE_MODE === "create-failure") process.exit(44);
  if (Object.hasOwn(state, create[1])) {
    process.stderr.write("ERROR: database already exists\n");
    process.exit(1);
  }
  state[create[1]] = { tables: [] };
  save();
  process.exit(0);
}
if (process.env.RESTORE_FAKE_MODE === "restore-failure") process.exit(42);
const database = value("-d");
if (!Object.hasOwn(state, database)) process.exit(92);
const hasSqlError = stdin.includes("broken_restore_token");
const stop = argv.includes("ON_ERROR_STOP=1") || argv.includes("--set=ON_ERROR_STOP=1");
const transactional = argv.includes("--single-transaction");
if (!hasSqlError || !transactional) {
  if (stdin.includes("CREATE TABLE restore_sentinel")) state[database].tables.push("restore_sentinel");
  save();
}
if (hasSqlError) {
  process.stderr.write("ERROR: column broken_restore_token does not exist\n");
  process.exit(stop ? 3 : 0);
}
process.exit(0);
`;

const fixture = (t, initialState = {}) => {
  const root = mkdtempSync(join(tmpdir(), "fleetum-restore-helper-unit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "docker"), fakeDocker, { mode: 0o755 });
  const backup = join(root, "trusted backup.sql");
  const log = join(root, "docker.jsonl");
  const state = join(root, "state.json");
  writeFileSync(backup, backupSql);
  writeFileSync(state, JSON.stringify(initialState));
  const args = [backup, container, target, user];
  return {
    root,
    backup,
    args,
    calls: () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) : [],
    state: () => JSON.parse(readFileSync(state, "utf8")),
    run: (requestedArgs = args, mode = "") => spawnSync("bash", [helper, ...requestedArgs], {
      encoding: "utf8",
      input: "",
      timeout: 10_000,
      env: {
        PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        RESTORE_FAKE_LOG: log,
        RESTORE_FAKE_STATE: state,
        RESTORE_FAKE_MODE: mode
      }
    })
  };
};

const output = (result) => `${result.stdout}\n${result.stderr}`;
const assertRejected = (f, result) => {
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, output(result));
  assert.doesNotMatch(output(result), /Restore completato/);
  assert.deepEqual(f.calls(), [], "invalid input must be rejected before Docker");
};

test("restores trusted bytes through stdin into a newly created isolated target", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /Restore completato/);
  assert.deepEqual(f.calls(), [
    {
      argv: ["exec", "-i", container, "psql", "-X", "--set", "ON_ERROR_STOP=1", "-U", user, "-d", "postgres", "-c", `CREATE DATABASE "${target}";`],
      stdin: ""
    },
    {
      argv: ["exec", "-i", container, "psql", "-X", "--set", "ON_ERROR_STOP=1", "--single-transaction", "-U", user, "-d", target, "--file=-"],
      stdin: backupSql
    }
  ]);
  assert.deepEqual(f.state()[target].tables, ["restore_sentinel"]);
});

test("SQL errors fail the helper without publishing success or retaining partial statements", (t) => {
  const f = fixture(t);
  writeFileSync(f.backup, `${backupSql}SELECT broken_restore_token;\n`);
  const result = f.run();
  assert.equal(result.status, 3, output(result));
  assert.match(result.stderr, /ERROR: column broken_restore_token/);
  assert.doesNotMatch(output(result), /Restore completato/);
  assert.equal(f.calls().length, 2);
  assert.deepEqual(f.state()[target].tables, []);
});

test("an existing target database keeps its sentinel and is never dropped or restored", (t) => {
  const initialState = { [target]: { tables: ["preexisting_sentinel"], rows: [7] } };
  const f = fixture(t, initialState);
  const result = f.run();
  assert.notEqual(result.status, 0, output(result));
  assert.doesNotMatch(output(result), /Restore completato/);
  assert.deepEqual(f.state(), initialState);
  assert.deepEqual(f.calls().map((call) => call.argv.at(-1)), [`CREATE DATABASE "${target}";`]);
});

test("CREATE failure prevents any restore input or follow-up mutation", (t) => {
  const f = fixture(t);
  const result = f.run(f.args, "create-failure");
  assert.equal(result.status, 44, output(result));
  assert.doesNotMatch(output(result), /Restore completato/);
  assert.equal(f.calls().length, 1);
  assert.equal(f.calls()[0].stdin, "");
  assert.deepEqual(f.state(), {});
});

test("a failed Docker restore exit is propagated and the helper performs no cleanup", (t) => {
  const f = fixture(t);
  const result = f.run(f.args, "restore-failure");
  assert.equal(result.status, 42, output(result));
  assert.doesNotMatch(output(result), /Restore completato/);
  assert.equal(f.calls().length, 2);
  assert.deepEqual(f.state(), { [target]: { tables: [] } });
});

for (const count of [0, 1, 2, 3, 5]) {
  test(`requires exactly four explicit arguments (received ${count})`, (t) => {
    const f = fixture(t);
    const args = count < 4 ? f.args.slice(0, count) : [...f.args, "extra"];
    assertRejected(f, f.run(args));
  });
}

for (const invalid of ["", "fleetum", "fleetum_restore_", "fleetum_restore_UPPER", "fleetum_restore_unit;DROP DATABASE fleetum", "fleetum_restore_" + "x".repeat(64 - "fleetum_restore_".length)]) {
  test(`rejects unsafe or non-isolated target ${JSON.stringify(invalid)} before Docker`, (t) => {
    const f = fixture(t);
    assertRejected(f, f.run([f.backup, container, invalid, user]));
  });
}

for (const invalid of ["", "-option", "two words", "restore_user\";DROP DATABASE fleetum;--", "x".repeat(64)]) {
  test(`rejects unsafe user ${JSON.stringify(invalid)} before Docker`, (t) => {
    const f = fixture(t);
    assertRejected(f, f.run([f.backup, container, target, invalid]));
  });
}

for (const invalid of ["", "-option", "two words", "container/path", "container;true", "x".repeat(64)]) {
  test(`rejects unsafe container ${JSON.stringify(invalid)} before Docker`, (t) => {
    const f = fixture(t);
    assertRejected(f, f.run([f.backup, invalid, target, user]));
  });
}

for (const kind of ["missing", "directory", "empty", "unreadable"]) {
  test(`rejects a ${kind} backup before Docker`, (t) => {
    const f = fixture(t);
    const path = join(f.root, `backup-${kind}`);
    if (kind === "directory") mkdirSync(path);
    if (kind === "empty") writeFileSync(path, "");
    if (kind === "unreadable") {
      writeFileSync(path, backupSql);
      chmodSync(path, 0o000);
      try {
        accessSync(path, constants.R_OK);
        t.skip("this execution user can read a mode-000 file");
        return;
      } catch {
        // The helper must reject an actually unreadable regular file.
      }
    }
    assertRejected(f, f.run([path, container, target, user]));
  });
}

test("accepts valid identifiers at the 63-character PostgreSQL boundary", (t) => {
  const f = fixture(t);
  const targetAtLimit = "fleetum_restore_" + "x".repeat(63 - "fleetum_restore_".length);
  const userAtLimit = "u".repeat(63);
  const result = f.run([f.backup, container, targetAtLimit, userAtLimit]);
  assert.equal(result.status, 0, output(result));
  assert.deepEqual(f.state()[targetAtLimit].tables, ["restore_sentinel"]);
});
