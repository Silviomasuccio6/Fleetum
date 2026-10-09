import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const preflight = await readFile(
  new URL("../preflight-compliance.sh", import.meta.url),
  "utf8",
);

test("compliance preflight uses isolated database evidence and the repository audit policy", () => {
  assert.match(preflight, /npm run verify:database/);
  assert.match(preflight, /npm run audit:production/);
  assert.doesNotMatch(preflight, /privacy:retention:dry-run/);
  assert.doesNotMatch(preflight, /npm audit --omit=dev/);
});
