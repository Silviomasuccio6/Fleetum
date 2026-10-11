import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { EXACT_NUMERIC_FIELDS } from "../../backend/src/domain/money/exact-money-fields.ts";

let api;
try { api = await import("../fixtures/restore-recovery-money.mjs"); } catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
const requireApi = () => { assert(api, "The restore fixture must cover all audited monetary fields"); return api; };
const snapshot = () => requireApi().buildRestoreMoneyPlan(EXACT_NUMERIC_FIELDS).projections.map((projection) => ({ fieldKey: projection.fieldKey, rows: projection.rows.map((row) => ({ ...row })) }));

test("restore seed invokes the complete audited money fixture", async () => {
  const seed = await readFile(new URL("../fixtures/restore-recovery-seed.mjs", import.meta.url), "utf8");
  assert.match(seed, /seedRestoreMoney\(prisma, EXACT_NUMERIC_FIELDS\)/);
});

test("the fixture covers exactly 35 audited field pairs in 13 tables", () => {
  const plan = requireApi().buildRestoreMoneyPlan(EXACT_NUMERIC_FIELDS);
  assert.equal(plan.projections.length, 35); assert.equal(new Set(plan.projections.map((row) => row.table)).size, 13);
  assert.deepEqual(plan.projections.map((row) => row.fieldKey).sort(), EXACT_NUMERIC_FIELDS.map((field) => `${field.model}.${field.legacyField}`).sort());
});

test("each non-subscription field has decimal, zero and nullable scenarios in both tenants", () => {
  const plan = requireApi().buildRestoreMoneyPlan(EXACT_NUMERIC_FIELDS);
  for (const projection of plan.projections.filter((row) => row.table !== "TenantSubscription")) {
    assert.equal(projection.rows.length, 6);
    for (const tenantId of ["demo_tenant", "restore_tenant_b"]) {
      const rows = projection.rows.filter((row) => row.tenantId === tenantId); assert.equal(rows.length, 3);
      assert(rows.some((row) => Number(row.legacyValue) > 0)); assert(rows.some((row) => row.legacyValue === "0"));
      const field = EXACT_NUMERIC_FIELDS.find((field) => `${field.model}.${field.legacyField}` === projection.fieldKey);
      assert.equal(rows.filter((row) => row.legacyValue === null).length, field.nullable ? 1 : 0);
    }
  }
});

test("subscriptions retain their uniqueness and distinguish transient null coverage", () => {
  const plan = requireApi().buildRestoreMoneyPlan(EXACT_NUMERIC_FIELDS);
  const subscription = plan.projections.find((row) => row.table === "TenantSubscription");
  assert.equal(subscription.rows.length, 2); assert.equal(subscription.rows[0].legacyValue, "149.199"); assert.equal(subscription.rows[1].legacyValue, "0");
  assert.equal(plan.transientSubscriptionNullChecks, 2); assert.match(plan.limits.join(" "), /subscription null.*preparation/i);
});

test("decimal oracle is fixed text, includes half-cent/four-decimal rounding and realistic rates", () => {
  const plan = requireApi().buildRestoreMoneyPlan(EXACT_NUMERIC_FIELDS);
  const field = (key) => plan.projections.find((row) => row.fieldKey === key).rows[0];
  assert.equal(field("Vehicle.purchasePrice").exactValue, "98765.44");
  assert.equal(field("VehicleCost.amount").exactValue, "0.11");
  assert.equal(field("RentalPriceList.baseRateAmount").exactValue, "42.1235");
  for (const projection of plan.projections.filter((row) => /(?:Rate|Percent)$/.test(row.fieldKey) && !/baseRate/.test(row.fieldKey))) for (const row of projection.rows) if (row.legacyValue !== null) assert(Number(row.legacyValue) >= 0 && Number(row.legacyValue) <= 100);
  assert(!plan.projections.some((row) => /daysCharged|quantity/.test(row.fieldKey)));
});

test("complete money snapshots produce aggregate metadata and stable hashes without values", () => {
  const rows = snapshot(); const report = requireApi().assertRestoreMoneySnapshot(EXACT_NUMERIC_FIELDS, rows, "schema42");
  assert.equal(report.checkedFields, 35); assert.equal(report.checkedTables, 13); assert.equal(report.checkedRows, 206);
  assert.equal(report.mismatchCount, 0); assert.match(report.sha256, /^[a-f0-9]{64}$/);
  assert.equal(requireApi().assertRestoreMoneySnapshot(EXACT_NUMERIC_FIELDS, [...rows].reverse(), "schema48").sha256, report.sha256);
  assert(!JSON.stringify(report).includes("98765.435")); assert.equal(report.fields.length, 35);
});

test("empty or incomplete snapshots cannot produce a successful money coverage claim", () => {
  for (const rows of [[], snapshot().slice(1)]) assert.throws(() => requireApi().assertRestoreMoneySnapshot(EXACT_NUMERIC_FIELDS, rows, "schema42"));
  const rows = snapshot(); rows[3].rows.pop(); assert.throws(() => requireApi().assertRestoreMoneySnapshot(EXACT_NUMERIC_FIELDS, rows, "schema42"));
});

test("duplicate fields or row identities are rejected instead of counted twice", () => {
  const rows = snapshot(); rows.push(rows[0]); assert.throws(() => requireApi().assertRestoreMoneySnapshot(EXACT_NUMERIC_FIELDS, rows, "schema42"));
  const repeated = snapshot(); repeated[1].rows[1] = { ...repeated[1].rows[0] }; assert.throws(() => requireApi().assertRestoreMoneySnapshot(EXACT_NUMERIC_FIELDS, repeated, "schema42"));
});

for (const [name, mutate] of [
  ["wrong tenant", (row) => { row.tenantId = "another_tenant"; }],
  ["legacy value drift", (row) => { row.legacyValue = "98765.436"; }],
  ["Decimal value drift", (row) => { row.exactValue = "98765.43"; }],
  ["missing Decimal", (row) => { row.exactValue = null; }],
  ["incorrect row identity", (row) => { row.caseId = "wrong_case"; }]
]) test(`snapshot rejects ${name}`, () => { const rows = snapshot(); mutate(rows[1].rows[0]); assert.throws(() => requireApi().assertRestoreMoneySnapshot(EXACT_NUMERIC_FIELDS, rows, "schema48")); });

test("nullable fields require null in both representations", () => {
  const rows = snapshot(); const nullRow = rows[1].rows.find((row) => row.legacyValue === null); assert(nullRow); nullRow.exactValue = "0.00";
  assert.throws(() => requireApi().assertRestoreMoneySnapshot(EXACT_NUMERIC_FIELDS, rows, "first-restore"));
});

test("catalogue drift and SQL identifier injection are refused", () => {
  const registry = EXACT_NUMERIC_FIELDS.map((field) => ({ ...field }));
  for (const rows of [registry.slice(1), [...registry, registry[0]], registry.map((field, i) => i === 0 ? { ...field, table: 'Vehicle"; DROP TABLE "User' } : field), registry.map((field, i) => i === 0 ? { ...field, scale: 7 } : field), registry.map((field, i) => i === 0 ? { ...field, nullable: false } : field)]) assert.throws(() => requireApi().buildRestoreMoneyPlan(rows));
});

test("snapshot SQL is one read-only statement, obtains text decimals and follows invoice tenant", () => {
  const sql = requireApi().buildRestoreMoneySnapshotSql(EXACT_NUMERIC_FIELDS);
  assert.equal((sql.match(/;\s*$/g) ?? []).length, 1); assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|COPY)\b/i);
  assert.match(sql, /"purchasePriceExact"::text/); assert.match(sql, /"InvoiceItem" t JOIN "Invoice" i ON i\."id"=t\."invoiceId"/);
  assert.match(sql, /ORDER BY/); assert.equal((sql.match(/'fieldKey'/g) ?? []).length, 35);
});

test("fixture records remain synthetic and use valid enum strings and fractional non-money quantities", () => {
  const plan = requireApi().buildRestoreMoneyPlan(EXACT_NUMERIC_FIELDS);
  assert.equal(plan.records.length, 74);
  for (const record of plan.records) assert(["demo_tenant", "restore_tenant_b"].includes(record.tenantId));
  for (const record of plan.records.filter((row) => row.model === "InvoiceItem")) assert.equal(record.data.quantity, 1.5);
  for (const record of plan.records.filter((row) => row.model === "RentalBookingPricingSnapshot")) assert.equal(record.data.daysCharged, 2.5);
  for (const record of plan.records.filter((row) => row.model === "RentalBooking")) assert.equal(record.data.status, "DRAFT");
  assert(plan.records.every((row) => row.model === "TenantSubscription" || row.data.id.startsWith("restore_money_")));
});

test("synthetic enum values are present in the official Prisma schema", async () => {
  const schema = await readFile(new URL("../../backend/prisma/schema.prisma", import.meta.url), "utf8");
  const enumValues = (name) => {
    const body = schema.match(new RegExp(`enum ${name} \\{([^}]+)\\}`))?.[1]; assert(body, `Official enum ${name} missing`);
    return body.trim().split(/\s+/);
  };
  const rules = {
    VehicleCost: { type: "VehicleCostType" }, RentalBooking: { status: "RentalBookingStatus" },
    RentalPriceList: { scope: "RentalPricingScope", baseRateUnit: "RentalBaseRateUnit", hourOverflowRule: "RentalHourOverflowRule" },
    RentalExtraKmPolicy: { type: "RentalExtraKmPolicyType" }, RentalBookingPricingSnapshot: { baseRateUnit: "RentalBaseRateUnit" },
    Stoppage: { status: "StoppageStatus" }, Invoice: { status: "InvoiceStatus" }
  };
  for (const record of requireApi().buildRestoreMoneyPlan(EXACT_NUMERIC_FIELDS).records) for (const [property, name] of Object.entries(rules[record.model] ?? {})) assert(enumValues(name).includes(record.data[property]), `${record.model}.${property} must use an official enum value`);
});

test("subscription null failure stops fixture creation and cannot emit coverage success", async () => {
  let creates = 0;
  const prisma = { tenantSubscription: { update: async () => {} }, workshop: { create: async () => { creates++; } }, $queryRawUnsafe: async () => [{ tenantId: "demo_tenant", legacyValue: null, exactValue: "0.00" }, { tenantId: "restore_tenant_b", legacyValue: null, exactValue: null }] };
  prisma.$transaction = async (operation) => operation(prisma);
  await assert.rejects(requireApi().seedRestoreMoney(prisma, EXACT_NUMERIC_FIELDS)); assert.equal(creates, 0);
});

test("seed persists six same-tenant relation clusters and checks null subscriptions before final update", async () => {
  const calls = []; const prisma = {};
  for (const model of ["workshop", ...new Set(EXACT_NUMERIC_FIELDS.map((field) => field.model[0].toLowerCase() + field.model.slice(1)))]) prisma[model] = {
    create: async ({ data }) => { calls.push({ method: "create", model, data }); return data; },
    update: async (args) => { calls.push({ method: "update", model, ...args }); return args.data; }
  };
  prisma.$queryRawUnsafe = async () => [{ tenantId: "demo_tenant", legacyValue: null, exactValue: null }, { tenantId: "restore_tenant_b", legacyValue: null, exactValue: null }];
  prisma.user = { findFirst: async () => ({ id: "synthetic_admin_a" }) };
  prisma.$transaction = async (operation) => operation(prisma);
  const report = await requireApi().seedRestoreMoney(prisma, EXACT_NUMERIC_FIELDS);
  assert.equal(calls.filter((row) => row.method === "create" && row.model !== "workshop").length, 72);
  assert.equal(calls.filter((row) => row.method === "update" && row.data.priceMonthly === null).length, 2);
  assert.equal(report.subscriptionNullPreparationChecks, 2);
  const creations = new Map(calls.filter((row) => row.method === "create").map((row) => [row.data.id, row]));
  for (const row of creations.values()) for (const relation of ["vehicleId", "maintenanceId", "priceListId", "policyId", "bookingId", "invoiceId", "workshopId"]) if (row.data[relation]) assert.equal(creations.get(row.data[relation])?.data.tenantId ?? creations.get(row.data[relation])?.tenantId, row.data.tenantId ?? planTenant(row.data.invoiceId));
});

const planTenant = (id) => id.includes("_b_") ? "restore_tenant_b" : "demo_tenant";


test("post-application-recovery verifies every monetary pair with the unchanged oracle", () => {
  const rows = snapshot(); const report = requireApi().assertRestoreMoneySnapshot(EXACT_NUMERIC_FIELDS, rows, "after-application-recovery");
  assert.equal(report.checkedFields, 35); assert.equal(report.checkedRows, 206);
  assert.equal(report.sha256, requireApi().assertRestoreMoneySnapshot(EXACT_NUMERIC_FIELDS, rows, "schema48").sha256);
  rows[1].rows[0].exactValue = "0.00";
  assert.throws(() => requireApi().assertRestoreMoneySnapshot(EXACT_NUMERIC_FIELDS, rows, "after-application-recovery"));
});
