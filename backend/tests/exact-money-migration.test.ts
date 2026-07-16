import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  EXACT_NUMERIC_FIELDS,
  NON_MONETARY_FLOAT_FIELDS
} from "../src/domain/money/exact-money-fields.js";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = readFileSync(resolve(backendRoot, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(backendRoot, "prisma/migrations/20260713130000_exact_money_shadow_columns/migration.sql"),
  "utf8"
);
const deployScript = readFileSync(
  resolve(backendRoot, "../deploy/scripts/safe-production-deploy.sh"),
  "utf8"
);
const backendEnvExample = readFileSync(resolve(backendRoot, ".env.example"), "utf8");
const productionEnvExample = readFileSync(
  resolve(backendRoot, "../deploy/env/backend.env.production.example"),
  "utf8"
);
const migrationGuide = readFileSync(
  resolve(backendRoot, "../docs/database/exact-money-migration.md"),
  "utf8"
);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fieldKey = (model: string, field: string) => `${model}.${field}`;

const listFloatFields = () => {
  const fields: string[] = [];
  const modelPattern = /model\s+(\w+)\s+\{([\s\S]*?)\n\}/g;

  for (const modelMatch of schema.matchAll(modelPattern)) {
    const [, model, body] = modelMatch;
    for (const line of body.split("\n")) {
      const fieldMatch = line.match(/^\s*(\w+)\s+Float\??\b/);
      if (fieldMatch) fields.push(fieldKey(model, fieldMatch[1]));
    }
  }

  return fields.sort();
};

test("every Prisma Float field is explicitly classified", () => {
  const classified = [
    ...EXACT_NUMERIC_FIELDS.map((field) => fieldKey(field.model, field.legacyField)),
    ...NON_MONETARY_FLOAT_FIELDS.map((field) => fieldKey(field.model, field.field))
  ].sort();

  assert.equal(EXACT_NUMERIC_FIELDS.length, 35);
  assert.equal(NON_MONETARY_FLOAT_FIELDS.length, 2);
  assert.deepEqual(listFloatFields(), classified);
});

test("each monetary Float has an ignored Decimal shadow and migration rule", () => {
  for (const field of EXACT_NUMERIC_FIELDS) {
    const fieldPattern = new RegExp(
      `^\\s*${escapeRegExp(field.exactField)}\\s+Decimal\\??.*$`,
      "m"
    );
    const fieldLine = schema.match(fieldPattern)?.[0] ?? "";
    assert.ok(fieldLine.includes("@ignore"), `${fieldKey(field.model, field.exactField)} must be ignored`);
    assert.match(
      fieldLine,
      new RegExp(`@db\\.Decimal\\((?:9|19),\\s*${field.scale}\\)`),
      `${fieldKey(field.model, field.exactField)} must use the audited Decimal scale`
    );
    assert.ok(
      migration.includes(`ADD COLUMN "${field.exactColumn}" DECIMAL(`),
      `${fieldKey(field.model, field.exactField)} must be added by the migration`
    );
    assert.ok(
      migration.includes(`ROUND("${field.legacyColumn}"::numeric, ${field.scale})`),
      `${fieldKey(field.model, field.legacyField)} must be backfilled exactly`
    );
  }
});

test("expand migration is non-destructive and enforces dual-write consistency", () => {
  assert.doesNotMatch(migration, /DROP\s+COLUMN/i);
  assert.doesNotMatch(migration, /ALTER\s+COLUMN\s+"?\w+"?\s+TYPE/i);
  assert.equal((migration.match(/CREATE TRIGGER "fleetum_exact_/g) ?? []).length, 13);
  assert.equal((migration.match(/ADD CONSTRAINT "fleetum_exact_\d{3}"/g) ?? []).length, 35);
  assert.equal((migration.match(/VALIDATE CONSTRAINT "fleetum_exact_\d{3}"/g) ?? []).length, 35);
});

test("production deploy reconciles exact values before restarting the application", () => {
  const migrationIndex = deployScript.indexOf("npx prisma migrate deploy");
  const reconciliationIndex = deployScript.indexOf("npm run money:reconcile:prod");
  const restartIndex = deployScript.indexOf("restarting production containers");

  assert.ok(migrationIndex >= 0);
  assert.ok(reconciliationIndex > migrationIndex);
  assert.ok(restartIndex > reconciliationIndex);
});

test("controlled reads remain opt-in and document compare, exact and rollback", () => {
  assert.match(backendEnvExample, /^EXACT_MONEY_READ_MODE=legacy$/m);
  assert.match(productionEnvExample, /^EXACT_MONEY_READ_MODE=legacy$/m);
  assert.match(migrationGuide, /`legacy` is the safe default/);
  assert.match(migrationGuide, /`compare` reads exact shadows in parallel/);
  assert.match(migrationGuide, /`exact` replaces audited legacy fields/);
  assert.match(migrationGuide, /set `EXACT_MONEY_READ_MODE=legacy`/);
});
