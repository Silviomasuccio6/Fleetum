import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// These are fixed synthetic expectations, not an alternative money registry or
// reconciliation algorithm. The caller supplies the product's audited registry.
// Exact expectations are literal strings: no binary-float rounding in the oracle.
const decimalValues = {
  TenantSubscription: { priceMonthly: ["149.199", "149.20"] },
  Vehicle: { purchasePrice: ["98765.435", "98765.44"], residualValue: ["43210.125", "43210.13"], monthlyFixedCost: ["199.995", "200.00"] },
  VehicleCost: { amount: ["0.105", "0.11"] },
  VehicleMaintenance: { cost: ["999.995", "1000.00"] },
  VehicleMaintenanceAttachment: { invoiceTotalAmount: ["999.995", "1000.00"] },
  RentalBooking: { expectedTotal: ["122.1295561725", "122.13"], finalTotal: ["134.2755", "134.28"] },
  RentalPriceList: { baseRateAmount: ["42.12345", "42.1235"], vatRate: ["22.12345", "22.1235"], discountPercent: ["5.55555", "5.5556"] },
  RentalExtraKmPolicy: { flatRatePerKm: ["0.12345", "0.1235"] },
  RentalExtraKmTier: { ratePerKm: ["0.98765", "0.9877"] },
  RentalBookingPricingSnapshot: {
    baseRateAmount: ["42.12345", "42.1235"], vatRate: ["22.12345", "22.1235"], discountPercent: ["5.55555", "5.5556"],
    extraKmEstimatedCost: ["1.235", "1.24"], extraKmActualCost: ["2.345", "2.35"],
    expectedSubtotal: ["100.005", "100.01"], expectedTaxAmount: ["22.1245561725", "22.12"], expectedTotal: ["122.1295561725", "122.13"],
    finalSubtotal: ["110.005", "110.01"], finalTaxAmount: ["24.2705", "24.27"], finalTotal: ["134.2755", "134.28"]
  },
  Stoppage: { estimatedCostPerDay: ["88.885", "88.89"] },
  Invoice: { subtotal: ["100.005", "100.01"], taxRate: ["22.12345", "22.1235"], taxAmount: ["22.1245561725", "22.12"], total: ["122.1295561725", "122.13"] },
  InvoiceItem: { unitPrice: ["66.67", "66.67"], subtotal: ["100.005", "100.01"], taxRate: ["22.12345", "22.1235"], taxAmount: ["22.1245561725", "22.12"], total: ["122.1295561725", "122.13"] }
};
const nullableModels = new Set(["TenantSubscription", "Vehicle", "VehicleMaintenance", "VehicleMaintenanceAttachment", "RentalBooking", "RentalExtraKmPolicy", "RentalBookingPricingSnapshot", "Stoppage"]);
const contexts = [
  { suffix: "a", tenantId: "demo_tenant", siteId: "compat_site", userId: null },
  { suffix: "b", tenantId: "restore_tenant_b", siteId: "restore_site_b", userId: "restore_user_b" }
];
const variants = ["decimal", "zero", "nullable"];
const date = "2026-01-05T10:00:00.000Z";
const idFor = (model, suffix, variant) => `restore_money_${suffix}_${variant}_${model}`;
const quoteIdentifier = (value) => `"${value}"`;
const quoteLiteral = (value) => `'${value}'`;
const modelDelegate = (model) => model[0].toLowerCase() + model.slice(1);

function validatedRegistry(fields) {
  assert(Array.isArray(fields), "Money registry must be an array"); assert.equal(fields.length, 35, "Audited money field count changed");
  const expectedKeys = Object.entries(decimalValues).flatMap(([model, values]) => Object.keys(values).map((field) => `${model}.${field}`)).sort();
  const keys = [];
  for (const field of fields) {
    assert(field && typeof field === "object", "Invalid money registry entry");
    for (const name of ["model", "table", "legacyField", "exactField", "legacyColumn", "exactColumn"]) assert.match(field[name], /^[A-Za-z][A-Za-z0-9_]*$/, "Static money identifiers required");
    assert.equal(field.model, field.table); assert.equal(field.legacyField, field.legacyColumn);
    assert.equal(field.exactField, `${field.legacyField}Exact`); assert.equal(field.exactColumn, field.exactField);
    const key = `${field.model}.${field.legacyField}`; assert(!keys.includes(key), "Duplicate money registry field"); keys.push(key);
    const oracle = decimalValues[field.model]?.[field.legacyField]; assert(oracle, "Money fixture oracle missing for audited field");
    assert.equal(field.scale, oracle[1].split(".")[1].length, "Money registry scale changed");
    assert.equal(field.nullable, nullableModels.has(field.model), "Money registry nullability changed");
  }
  assert.deepEqual(keys.sort(), expectedKeys, "Fixture and audited registry differ"); assert.equal(new Set(fields.map((field) => field.table)).size, 13);
  return fields;
}

function valuesFor(fields, model, variant) {
  return Object.fromEntries(fields.filter((field) => field.model === model).map((field) => {
    const value = variant === "nullable" && field.nullable ? null : variant === "decimal" ? decimalValues[model][field.legacyField][0] : "0";
    return [field.legacyField, value === null ? null : Number(value)];
  }));
}

export function buildRestoreMoneyPlan(fields) {
  validatedRegistry(fields);
  const records = []; const projections = fields.map((field) => ({ fieldKey: `${field.model}.${field.legacyField}`, table: field.table, rows: [] }));
  for (const context of contexts) {
    const subscriptionValues = valuesFor(fields, "TenantSubscription", context.suffix === "a" ? "decimal" : "zero");
    records.push({ model: "TenantSubscription", tenantId: context.tenantId, operation: "update", where: { tenantId: context.tenantId }, data: subscriptionValues });
    for (const variant of variants) {
      const id = (model) => idFor(model, context.suffix, variant);
      const common = { tenantId: context.tenantId };
      const base = {
        Vehicle: { ...common, siteId: context.siteId, plate: `RM${context.suffix.toUpperCase()}${variant.toUpperCase()}`, brand: "Synthetic", model: "Restore monetary fixture", year: 2024 },
        VehicleCost: { ...common, vehicleId: id("Vehicle"), type: "MAINTENANCE", description: "Synthetic restore cost", date: new Date(date) },
        VehicleMaintenance: { ...common, vehicleId: id("Vehicle"), performedAt: new Date(date), maintenanceType: "SYNTHETIC_RESTORE" },
        VehicleMaintenanceAttachment: { ...common, maintenanceId: id("VehicleMaintenance"), filePath: `synthetic-money-metadata/${id("VehicleMaintenanceAttachment")}.pdf`, fileName: "synthetic-money-metadata.pdf", mimeType: "application/pdf", sizeBytes: 0 },
        RentalBooking: { ...common, vehicleId: id("Vehicle"), code: `RM-${context.suffix}-${variant}`, status: "DRAFT", contractRequired: false, customerName: "Synthetic monetary fixture", pickupAt: new Date("2026-02-01T10:00:00.000Z"), returnAt: new Date("2026-02-03T22:00:00.000Z") },
        RentalPriceList: { ...common, name: `Synthetic ${context.suffix} ${variant}`, scope: "VEHICLE", vehicleId: id("Vehicle"), baseRateUnit: "DAILY", hourOverflowRule: "HALF_DAY" },
        RentalExtraKmPolicy: { ...common, priceListId: id("RentalPriceList"), name: `Synthetic ${variant} policy`, type: variant === "nullable" ? "TIERED" : "FLAT", currency: "EUR" },
        RentalExtraKmTier: { ...common, policyId: id("RentalExtraKmPolicy"), fromKm: 1, toKm: 100 },
        RentalBookingPricingSnapshot: { ...common, bookingId: id("RentalBooking"), priceListId: id("RentalPriceList"), extraKmPolicyId: id("RentalExtraKmPolicy"), baseRateUnit: "DAILY", daysCharged: 2.5 },
        Stoppage: { ...common, siteId: context.siteId, vehicleId: id("Vehicle"), workshopId: `restore_money_workshop_${context.suffix}`, createdByUserId: context.userId, reason: "Synthetic restore stoppage", status: "CLOSED", openedAt: new Date(date), closedAt: new Date("2026-01-06T10:00:00.000Z") },
        Invoice: { ...common, invoiceNumber: `SYNTHETIC-RM-${context.suffix}-${variant}`, issueDate: new Date(date), dueDate: new Date("2026-02-05T10:00:00.000Z"), periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-02-01T00:00:00.000Z"), billingName: "Synthetic restore invoice", status: "DRAFT", currency: "EUR" },
        InvoiceItem: { invoiceId: id("Invoice"), description: "Synthetic monetary line", quantity: 1.5 }
      };
      for (const model of Object.keys(base)) records.push({ model, tenantId: context.tenantId, operation: "create", data: { id: id(model), ...base[model], ...valuesFor(fields, model, variant) } });
    }
  }
  for (const field of fields) {
    const projection = projections.find((row) => row.fieldKey === `${field.model}.${field.legacyField}`);
    for (const context of contexts) for (const variant of field.model === "TenantSubscription" ? [context.suffix === "a" ? "decimal" : "zero"] : variants) {
      const [legacyValue, exactValue] = variant === "nullable" && field.nullable ? [null, null]
        : variant === "decimal" ? decimalValues[field.model][field.legacyField] : ["0", `0.${"0".repeat(field.scale)}`];
      projection.rows.push({ caseId: field.model === "TenantSubscription" ? `subscription_${context.tenantId}` : idFor(field.model, context.suffix, variant), tenantId: context.tenantId, legacyValue, exactValue });
    }
  }
  return {
    records, projections, transientSubscriptionNullChecks: 2,
    limits: [
      "Subscription null is checked during fixture preparation, then replaced by persisted tenant A decimal and tenant B zero values.",
      "Synthetic maintenance attachments exercise monetary metadata only; they do not register or back up file bytes.",
      "This fixture checks audited storage values and tenant relationships, not invoice calculations, provider settlement, every magnitude or every rounding permutation."
    ]
  };
}

export function buildRestoreMoneySnapshotSql(fields) {
  const plan = buildRestoreMoneyPlan(fields);
  return `${fields.map((field) => {
    const projection = plan.projections.find((row) => row.fieldKey === `${field.model}.${field.legacyField}`);
    const subscription = field.model === "TenantSubscription"; const item = field.model === "InvoiceItem";
    const tenant = item ? 'i."tenantId"' : 't."tenantId"';
    const caseId = subscription ? `'subscription_' || t."tenantId"` : 't."id"';
    const filter = subscription ? `${tenant} IN (${contexts.map((context) => quoteLiteral(context.tenantId)).join(",")})` : `t."id" IN (${projection.rows.map((row) => quoteLiteral(row.caseId)).join(",")})`;
    return `SELECT jsonb_build_object('fieldKey',${quoteLiteral(projection.fieldKey)},'rows',COALESCE(jsonb_agg(jsonb_build_object('caseId',${caseId},'tenantId',${tenant},'legacyValue',t.${quoteIdentifier(field.legacyColumn)}::text,'exactValue',t.${quoteIdentifier(field.exactColumn)}::text) ORDER BY ${caseId}),'[]'::jsonb))::text FROM ${quoteIdentifier(field.table)} t${item ? ' JOIN "Invoice" i ON i."id"=t."invoiceId"' : ""} WHERE ${filter}`;
  }).join("\nUNION ALL\n")};`;
}

export function assertRestoreMoneySnapshot(fields, snapshots, phase) {
  const plan = buildRestoreMoneyPlan(fields);
  assert.match(phase, /^(?:schema42|schema48|first-restore|second-restore|after-application-recovery)$/);
  assert(Array.isArray(snapshots)); assert.equal(snapshots.length, 35, "Money snapshot must contain every audited field");
  const canonical = []; const summaries = []; const seen = new Set();
  for (const projection of plan.projections) {
    const entry = snapshots.find((value) => value?.fieldKey === projection.fieldKey);
    assert(entry && !seen.has(entry.fieldKey), "Money snapshot missing or duplicated field"); seen.add(entry.fieldKey);
    assert.equal(snapshots.filter((value) => value?.fieldKey === entry.fieldKey).length, 1, "Duplicate money snapshot field");
    assert(Array.isArray(entry.rows)); assert.equal(entry.rows.length, projection.rows.length, "Money fixture row missing or duplicated");
    const sorted = []; const rowIds = new Set();
    for (const expected of projection.rows) {
      const row = entry.rows.find((value) => value?.caseId === expected.caseId);
      assert(row && !rowIds.has(row.caseId), "Money fixture identity missing or duplicated"); rowIds.add(row.caseId);
      assert.equal(entry.rows.filter((value) => value?.caseId === expected.caseId).length, 1, "Duplicate money fixture identity");
      for (const property of ["tenantId", "legacyValue", "exactValue"]) assert.equal(row[property], expected[property], `Synthetic money ${property} mismatch for ${projection.fieldKey}`);
      sorted.push({ caseId: row.caseId, tenantId: row.tenantId, legacyValue: row.legacyValue, exactValue: row.exactValue });
    }
    sorted.sort((a, b) => a.caseId.localeCompare(b.caseId)); canonical.push({ fieldKey: projection.fieldKey, rows: sorted });
    summaries.push({ fieldKey: projection.fieldKey, rowCount: sorted.length, decimalCount: sorted.filter((row) => row.legacyValue !== null && row.legacyValue !== "0").length, zeroCount: sorted.filter((row) => row.legacyValue === "0").length, nullCount: sorted.filter((row) => row.legacyValue === null).length });
  }
  canonical.sort((a, b) => a.fieldKey.localeCompare(b.fieldKey)); summaries.sort((a, b) => a.fieldKey.localeCompare(b.fieldKey));
  return { phase, checkedFields: 35, checkedTables: 13, checkedRows: canonical.reduce((sum, row) => sum + row.rows.length, 0), mismatchCount: 0, sha256: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"), fields: summaries, limits: plan.limits };
}

export async function seedRestoreMoney(prisma, fields) {
  const plan = buildRestoreMoneyPlan(fields);
  await prisma.$transaction(async (tx) => {
    // The subscription uniqueness rule permits only one row per tenant. Prove
    // nullable storage before restoring the final values used by every snapshot.
    for (const context of contexts) await tx.tenantSubscription.update({ where: { tenantId: context.tenantId }, data: { priceMonthly: null } });
    const nullRows = await tx.$queryRawUnsafe(`SELECT "tenantId", "priceMonthly"::text AS "legacyValue", "priceMonthlyExact"::text AS "exactValue" FROM "TenantSubscription" WHERE "tenantId" IN ('demo_tenant','restore_tenant_b') ORDER BY "tenantId";`);
    assert.equal(nullRows.length, 2); for (const context of contexts) { const row = nullRows.find((value) => value.tenantId === context.tenantId); assert(row); assert.equal(row.legacyValue, null); assert.equal(row.exactValue, null); }
    const admin = await tx.user.findFirst({ where: { tenantId: "demo_tenant", email: "admin@demo.local" }, select: { id: true } });
    assert(admin?.id, "Synthetic tenant A administrator missing");
    for (const context of contexts) await tx.workshop.create({ data: { id: `restore_money_workshop_${context.suffix}`, tenantId: context.tenantId, name: "Synthetic monetary restore workshop" } });
    for (const record of plan.records) {
      const data = { ...record.data };
      if (record.model === "Stoppage" && record.tenantId === "demo_tenant") data.createdByUserId = admin.id;
      await tx[modelDelegate(record.model)][record.operation]({ ...(record.where ? { where: record.where } : {}), data });
    }
  }, { maxWait: 10000, timeout: 30000 });
  return { checkedFields: 35, checkedTables: 13, subscriptionNullPreparationChecks: 2, persistentFixtureRows: 74, limits: plan.limits };
}

// This module is copied to the root of each pinned archive before execution.
// The TS loader resolves the catalogue from that same archive, never from dist.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { EXACT_NUMERIC_FIELDS } = await import("./backend/src/domain/money/exact-money-fields.ts");
  assert.deepEqual(process.argv.slice(2), ["snapshot-query"], "Only the read-only snapshot-query CLI is supported");
  process.stdout.write(`${buildRestoreMoneySnapshotSql(EXACT_NUMERIC_FIELDS)}\n`);
}
