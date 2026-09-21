import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.doesNotMatch(script, /\.env/);
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
