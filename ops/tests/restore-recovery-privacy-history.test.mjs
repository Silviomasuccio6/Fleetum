import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as recovery from "../verify-restore-recovery.mjs";

const fixture = await import("../fixtures/restore-recovery-privacy-history.mjs").catch(() => null);
const api = () => { assert(fixture, "Current privacy/history fixture must exist"); return fixture; };
const archiveRoot = "/private/tmp/fleetum-restore-recovery-privacy-test/source";
const databaseUrl = "postgresql://fleetum_restore:synthetic-only@127.0.0.1:54339/fleetum_restore_0123456789abcdef0123456789abcdef_source?schema=public";
const config = () => ({ argv: ["seed", archiveRoot], env: { NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null", SYNTHETIC_PRIVACY_HISTORY: "true", DATABASE_URL: databaseUrl, PRIVACY_RETENTION_CRON_ENABLED: "false", PRIVACY_RETENTION_GLOBAL_ENABLED: "false", BILLING_DUNNING_CRON_ENABLED: "false" } });
const receipt = phase => ({ format: "fleetum-restore-privacy-history-v1", phase, localOnly: true, schemaMigrations: 48, fixtureRows: 26, erasedCustomers: 1, tombstonedFiles: 1, activeFilesAdded: 0, frozenSnapshots: 1, legacySnapshots: 1, sha256: "c".repeat(64) });
const output = value => `FLEETUM_RESTORE_PRIVACY_HISTORY_JSON ${JSON.stringify(value)}\n`;

test("privacy/history fixture requires explicit opt-in, test, disabled dotenv and owned current archive/DB", () => {
  const { parsePrivacyHistoryConfig } = api();
  assert.equal(parsePrivacyHistoryConfig(config()).mode, "seed");
  for (const [key, value] of [["SYNTHETIC_PRIVACY_HISTORY", undefined], ["SYNTHETIC_PRIVACY_HISTORY", "false"], ["PRIVACY_RETENTION_CRON_ENABLED", "true"], ["PRIVACY_RETENTION_GLOBAL_ENABLED", undefined], ["BILLING_DUNNING_CRON_ENABLED", "true"], ["NODE_ENV", "production"], ["DOTENV_CONFIG_PATH", ".env"], ["NODE_OPTIONS", "--import external"], ["DATABASE_URL", databaseUrl.replace("127.0.0.1", "localhost")], ["DATABASE_URL", databaseUrl.replace("_source?", "_production?")]]) {
    const valueConfig = config(); valueConfig.env[key] = value;
    assert.throws(() => parsePrivacyHistoryConfig(valueConfig));
  }
  for (const suffix of ["baseline", "reserve"]) { const valueConfig = config(); valueConfig.argv[1] = archiveRoot.replace("source", suffix); assert.throws(() => parsePrivacyHistoryConfig(valueConfig)); }
  const check = config(); check.argv[0] = "check"; check.argv[1] = archiveRoot.replace("source", "reserve"); check.env.DATABASE_URL = databaseUrl.replace("_source?", "_first?");
  assert.equal(parsePrivacyHistoryConfig(check).mode, "check");
  const restoredSeed = config(); restoredSeed.env.DATABASE_URL = check.env.DATABASE_URL; assert.throws(() => parsePrivacyHistoryConfig(restoredSeed));
});

test("synthetic plan separates shared-email own communications from credentials, unrelated and contradictory linkage", () => {
  const { buildRestorePrivacyHistoryPlan } = api(); const plan = buildRestorePrivacyHistoryPlan();
  const queues = plan.records.filter(row => row.model === "EmailQueue").map(row => row.data);
  assert.equal(queues.length, 8);
  assert.equal(queues.filter(row => row.type === "BOOKING_CONTRACT").length, 6);
  assert(queues.some(row => row.type === "PASSWORD_RESET")); assert(queues.some(row => row.type === "USER_INVITATION"));
  const customers = plan.records.filter(row => row.model === "RentalCustomer").map(row => row.data);
  const shared = customers.filter(row => row.email === plan.sharedEmail); assert.equal(shared.length, 2);
  assert(plan.records.some(row => row.model === "User" && row.data.email === plan.sharedEmail));
  assert(queues.every(row => row.body.includes("RESTORE_PRIVATE_") && row.meta.opaqueSentinel.includes("RESTORE_PRIVATE_")));
  assert.equal(plan.allowedQueueIds.length, 1);
});

test("erased fixture has no resurrectable PII, no attachment record and only a deleted stored object", () => {
  const { buildRestorePrivacyHistoryPlan } = api(); const plan = buildRestorePrivacyHistoryPlan();
  const erased = plan.records.find(row => row.data.id === plan.ids.erasedCustomer).data;
  assert(erased.deletedAt instanceof Date); assert.equal(erased.firstName, "Cliente"); assert.match(erased.lastName, /^anonimizzato [a-f0-9]{8}$/);
  assert.equal(erased.drivingLicenseNumber, ""); for (const field of ["email", "phone", "taxCode", "documentNumber", "notes"]) assert.equal(erased[field], null);
  assert(!plan.records.some(row => row.model === "RentalCustomerAttachment"));
  const stored = plan.records.find(row => row.model === "StoredFileObject").data;
  assert(stored.deletedAt instanceof Date); assert.equal(stored.resourceId, plan.ids.erasedAttachment);
  assert.equal(plan.activeFilesAdded, 0);
});

test("historical pricing oracle retains 250 quote, 777/888 overrides and legacy null metadata despite changed inactive catalogue", () => {
  const { buildRestorePrivacyHistoryPlan } = api(); const plan = buildRestorePrivacyHistoryPlan();
  const booking = plan.records.find(row => row.data.id === plan.ids.frozenBooking).data;
  assert.equal(booking.expectedTotal, 777); assert.equal(booking.finalTotal, 888);
  const frozen = plan.records.find(row => row.data.id === plan.ids.frozenSnapshot).data;
  assert.equal(frozen.metadata.version, 1); assert.equal(frozen.metadata.priceList.baseRateAmount, 100);
  assert.equal(frozen.metadata.pricePackage.kmIncluded, 50); assert.equal(frozen.metadata.extraKmPolicy.flatRatePerKm, 1);
  assert.equal(frozen.expectedTotal, 250); assert.equal(frozen.estimatedKm, 100);
  assert.equal(plan.records.find(row => row.data.id === plan.ids.legacySnapshot).data.metadata, null);
  for (const model of ["RentalPriceList", "RentalPricePackage", "RentalExtraKmPolicy"]) {
    const row = plan.records.find(row => row.model === model).data; assert.equal(row.isActive, false); assert(row.deletedAt instanceof Date);
  }
});

test("seed rejects schema42 before any transaction, and state rejects missing fixture rows", async () => {
  const { seedRestorePrivacyHistory, assertRestorePrivacyHistoryState } = api(); let transactions = 0;
  const historical = { $queryRawUnsafe: async () => [{ count: 42 }], $transaction: async () => { transactions++; } };
  await assert.rejects(seedRestorePrivacyHistory(historical)); assert.equal(transactions, 0);
  const missing = { $queryRawUnsafe: async sql => sql.includes("_prisma_migrations") ? [{ count: 48 }] : [] };
  await assert.rejects(assertRestorePrivacyHistoryState(missing));
});

const exactFields = { RentalBooking: ["expectedTotal", "finalTotal"], RentalPriceList: ["baseRateAmount", "vatRate", "discountPercent"], RentalExtraKmPolicy: ["flatRatePerKm"], RentalBookingPricingSnapshot: ["baseRateAmount", "vatRate", "discountPercent", "extraKmEstimatedCost", "extraKmActualCost", "expectedSubtotal", "expectedTaxAmount", "expectedTotal", "finalSubtotal", "finalTaxAmount", "finalTotal"] };
const jsonCopy = value => JSON.parse(JSON.stringify(value));
function memoryDatabase(seeded = true) {
  const plan = api().buildRestorePrivacyHistoryPlan();
  const store = { rows: [], audits: 0, transactions: 0, created: [] };
  const save = (model, data) => {
    const row = jsonCopy(data); if (model === "RentalBookingPricingSnapshot" && !Object.hasOwn(row, "metadata")) row.metadata = null;
    for (const field of exactFields[model] ?? []) if (Object.hasOwn(row, field)) row[`${field}Exact`] = row[field];
    store.rows.push({ model, data: row });
  };
  if (seeded) for (const record of plan.records) save(record.model, record.data);
  const prisma = {
    $queryRawUnsafe: async sql => sql.includes("_prisma_migrations") ? [{ count: 48 }] : sql.includes('FROM "AuditLog"') ? [{ count: store.audits }] : jsonCopy(store.rows),
    $transaction: async run => { store.transactions++; return run(prisma); },
    user: { findFirst: async () => ({ id: "existing-synthetic-admin" }) }
  };
  for (const model of new Set(plan.records.map(record => record.model))) {
    const delegate = model[0].toLowerCase() + model.slice(1); prisma[delegate] ??= {};
    prisma[delegate].create = async ({ data }) => { store.created.push({ model, data }); save(model, data); return data; };
  }
  return { prisma, store, plan };
}

test("schema48 seed persists exactly the new rows once and restored canonical hashes retain exact overrides", async () => {
  const { seedRestorePrivacyHistory, assertRestorePrivacyHistoryState } = api();
  const { prisma, store } = memoryDatabase(false); const seed = await seedRestorePrivacyHistory(prisma);
  assert.equal(store.transactions, 1); assert.equal(store.created.length, 26); assert.equal(seed.fixtureRows, 26);
  const restored = await assertRestorePrivacyHistoryState(prisma); assert.equal(seed.sha256, restored.sha256);
  assert(!store.created.some(row => row.model === "AuditLog" || row.model === "RentalCustomerAttachment"));
  await assert.rejects(seedRestorePrivacyHistory(prisma)); assert.equal(store.transactions, 1);
  const { prisma: corrupted, store: corruptStore, plan } = memoryDatabase();
  corruptStore.rows.find(row => row.data.id === plan.ids.frozenBooking).data.expectedTotalExact = 0;
  await assert.rejects(assertRestorePrivacyHistoryState(corrupted));
});

test("canonical state refuses erased PII, resurrected attachments, tombstone removal and historical terms drift", async () => {
  const { assertRestorePrivacyHistoryState } = api();
  for (const mutate of [
    ({ store, plan }) => { store.rows.find(row => row.data.id === plan.ids.erasedCustomer).data.email = "restored-pii@example.invalid"; },
    ({ store, plan }) => { store.rows.find(row => row.data.id === plan.ids.tombstone).data.deletedAt = null; },
    ({ store, plan }) => { store.rows.find(row => row.data.id === plan.ids.frozenSnapshot).data.metadata = null; },
    ({ store, plan }) => { store.rows.push({ model: "RentalCustomerAttachment", data: { id: plan.ids.erasedAttachment, customerId: plan.ids.erasedCustomer } }); }
  ]) { const db = memoryDatabase(); mutate(db); await assert.rejects(assertRestorePrivacyHistoryState(db.prisma)); }
});

test("PostgreSQL timestamp JSON is interpreted as UTC regardless of the operator timezone", async () => {
  const { assertRestorePrivacyHistoryState } = api();
  const db = memoryDatabase();
  for (const row of db.store.rows) for (const [field, value] of Object.entries(row.data)) {
    if (typeof value === "string" && /^202[67]-.*Z$/.test(value)) row.data[field] = value.slice(0, -1);
  }
  const previous = process.env.TZ;
  try {
    process.env.TZ = "Europe/Rome"; const rome = await assertRestorePrivacyHistoryState(db.prisma);
    process.env.TZ = "Pacific/Auckland"; const auckland = await assertRestorePrivacyHistoryState(db.prisma);
    assert.equal(rome.sha256, auckland.sha256);
    db.store.rows[0].data.createdAt = "2026-01-05T11:00:00.000";
    await assert.rejects(assertRestorePrivacyHistoryState(db.prisma));
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

function probeHarness({ mutateLateEdit, quoteTotal = 250, recordAudit = true } = {}) {
  const db = memoryDatabase(); const { plan, store } = db; const calls = [];
  const headers = { cookie: "synthetic-local-cookie-a", "x-csrf-token": "synthetic-local-csrf-a" };
  const otherHeaders = { cookie: "synthetic-local-cookie-b", "x-csrf-token": "synthetic-local-csrf-b" };
  const response = (status, body) => ({ status, json: async () => body });
  const request = async (route, options = {}) => {
    calls.push({ route, ...options });
    if (route === `/privacy/data-subjects/customers/${plan.ids.subjectCustomer}/export`) {
      if (!options.headers) return response(401, {});
      if (options.headers.cookie === otherHeaders.cookie) return response(404, {});
      if (recordAudit) store.audits++;
      return response(200, { subject: { type: "rental_customer", id: plan.ids.subjectCustomer }, data: { communications: { emailQueue: [{ id: plan.allowedQueueIds[0], type: "BOOKING_CONTRACT", recipient: plan.sharedEmail, status: "SENT", attempts: 1, maxAttempts: 5, nextAttemptAt: "2026-01-05T10:00:00.000Z", createdAt: "2026-01-05T10:00:00.000Z", updatedAt: "2026-01-05T10:00:00.000Z" }] } } });
    }
    if (route === `/rental-bookings/customers/${plan.ids.erasedCustomer}` && options.method === "PATCH") { mutateLateEdit?.(db); return response(404, { error: "CUSTOMER_NOT_FOUND" }); }
    if (route === `/rental-bookings/customers/${plan.ids.siblingCustomer}` && !options.method) return response(200, { id: plan.ids.siblingCustomer });
    for (const [bookingId, frozen] of [[plan.ids.frozenBooking, true], [plan.ids.legacyBooking, false]]) if (route === `/rental-bookings/${bookingId}/pricing` && options.method === "PATCH") {
      if (options.headers.cookie === otherHeaders.cookie) return response(404, {});
      assert.deepEqual(JSON.parse(options.body), { preserveTerms: true });
      return response(200, { bookingId, snapshot: { expectedTotal: 250, finalTotal: 250 }, quote: frozen ? { pricing: { expectedTotal: quoteTotal, finalTotal: quoteTotal, baseRateAmount: 100 }, km: { includedKmTotal: 50 } } : null });
    }
    assert.fail(`Unexpected local fixture route: ${route}`);
  };
  return { ...db, calls, request, headers, otherHeaders };
}

test("HTTP probes use real customer aliases, cookie/CSRF patches, frozen terms, tenant isolation and retain one export audit", async () => {
  const { probeRestorePrivacyHistory, PRIVACY_HISTORY_HTTP_CHECKS } = api(); const probe = probeHarness();
  const value = await probeRestorePrivacyHistory(probe);
  assert.deepEqual([...value.checks].sort(), [...PRIVACY_HISTORY_HTTP_CHECKS].sort());
  assert.equal(value.privacyHistory.exportAuditDelta, 1); assert.equal(probe.store.audits, 1);
  assert.equal(value.privacyHistory.historicalQuoteTotal, 250); assert.equal(value.privacyHistory.legacyQuoteUnavailable, true);
  assert(probe.calls.some(call => call.route === `/rental-bookings/customers/${probe.plan.ids.erasedCustomer}` && call.method === "PATCH"));
  assert(probe.calls.some(call => call.route === `/rental-bookings/customers/${probe.plan.ids.siblingCustomer}` && !call.method));
  for (const call of probe.calls.filter(call => call.method === "PATCH")) assert(call.headers.cookie && call.headers["x-csrf-token"]);
  assert(!JSON.stringify(value).includes(probe.headers.cookie)); assert(!JSON.stringify(value).includes("RESTORE_PRIVATE_"));
});

test("HTTP evidence fails if denied edit still restores PII, live pricing replaces history, or legitimate export audit is absent", async () => {
  const { probeRestorePrivacyHistory } = api();
  for (const options of [
    { mutateLateEdit: ({ store, plan }) => { store.rows.find(row => row.data.id === plan.ids.erasedCustomer).data.phone = "RESTORE_PRIVATE_RESURRECTED"; } },
    { quoteTotal: 999 }, { recordAudit: false }
  ]) await assert.rejects(probeRestorePrivacyHistory(probeHarness(options)));
});

test("export oracle rejects raw message payload, credential receipts, missing own message and sibling linkage", () => {
  const { assertPrivacyHistoryExport, buildRestorePrivacyHistoryPlan } = api(); const plan = buildRestorePrivacyHistoryPlan();
  const own = { id: plan.allowedQueueIds[0], type: "BOOKING_CONTRACT", recipient: plan.sharedEmail, status: "SENT", attempts: 1, maxAttempts: 5, nextAttemptAt: "2026-01-05T10:00:00.000Z", createdAt: "2026-01-05T10:00:00.000Z", updatedAt: "2026-01-05T10:00:00.000Z" };
  const exported = rows => ({ subject: { type: "rental_customer", id: plan.ids.subjectCustomer }, data: { communications: { emailQueue: rows } } });
  assert.equal(assertPrivacyHistoryExport(exported([own])).communicationCount, 1);
  for (const rows of [[], [own, own], [{ ...own, body: "RESTORE_PRIVATE_body" }], [{ ...own, meta: {} }], [{ ...own, type: "PASSWORD_RESET" }], [{ ...own, id: "restore_privacy_queue_unrelated" }]]) assert.throws(() => assertPrivacyHistoryExport(exported(rows)));
  assert.throws(() => assertPrivacyHistoryExport({ ...exported([own]), extra: "RESTORE_PRIVATE_leak" }));
});

test("runner receipts retain bounded evidence only and refuse malformed/duplicated/mismatched seed identities", () => {
  assert.equal(typeof recovery.parseRestorePrivacyHistoryReceipt, "function");
  const secret = "synthetic-password-never-in-evidence";
  assert.deepEqual(recovery.parseRestorePrivacyHistoryReceipt(output({ ...receipt("seed"), password: secret, body: secret }), "seed"), receipt("seed"));
  for (const text of ["", output(receipt("seed")).repeat(2), output({ ...receipt("seed"), phase: "check" }), output({ ...receipt("seed"), schemaMigrations: 42 }), output({ ...receipt("seed"), activeFilesAdded: 1 }), output({ ...receipt("seed"), sha256: secret })]) assert.throws(() => recovery.parseRestorePrivacyHistoryReceipt(text, "seed"));
});

test("runner launches seed/check with forced test and opt-in and binds both restores to the pre-dump seed", async () => {
  assert.equal(typeof recovery.runRestoreRecoveryPrivacyHistoryFixture, "function");
  const calls = []; let returned = receipt("seed");
  const run = async (command, args, label, details) => { calls.push({ command, args, label, ...details }); return { stdout: Buffer.from(output(returned)) }; };
  const common = { run, directory: archiveRoot, databaseUrl, engines: { NODE_ENV: "production", SYNTHETIC_PRIVACY_HISTORY: "false" } };
  const seed = await recovery.runRestoreRecoveryPrivacyHistoryFixture({ ...common, phase: "seed", label: "privacy-seed" });
  returned = receipt("check");
  for (const suffix of ["first", "second"]) await recovery.runRestoreRecoveryPrivacyHistoryFixture({ ...common, databaseUrl: databaseUrl.replace("_source?", `_${suffix}?`), phase: "check", label: `privacy-${suffix}`, expectedReceipt: seed });
  assert.equal(calls.length, 3);
  for (const call of calls) { assert.equal(call.extraEnv.NODE_ENV, "test"); assert.equal(call.extraEnv.DOTENV_CONFIG_PATH, "/dev/null"); assert.equal(call.extraEnv.SYNTHETIC_PRIVACY_HISTORY, "true"); assert.equal(call.command, process.execPath); }
  returned = { ...returned, sha256: "d".repeat(64) };
  await assert.rejects(recovery.runRestoreRecoveryPrivacyHistoryFixture({ ...common, phase: "check", label: "privacy-drift", expectedReceipt: seed }));
});

test("HTTP receipt requires every current privacy/history probe and drops any raw headers/response fields", () => {
  const { PRIVACY_HISTORY_HTTP_CHECKS } = api(); assert.equal(typeof recovery.parseRestorePrivacyHistoryHttpReceipt, "function");
  const value = { checks: [...PRIVACY_HISTORY_HTTP_CHECKS], providerCalls: 0, workersStarted: false, privacyHistory: { ...receipt("check"), communicationCount: 1, historicalQuoteTotal: 250, legacyQuoteUnavailable: true, unchanged: true, exportAuditDelta: 1, cookie: "must-not-retain" } };
  const parsed = recovery.parseRestorePrivacyHistoryHttpReceipt(value); assert(!JSON.stringify(parsed).includes("must-not-retain"));
  for (const change of [{ checks: value.checks.slice(1) }, { providerCalls: 1 }, { workersStarted: true }, { privacyHistory: { ...value.privacyHistory, historicalQuoteTotal: 999 } }, { privacyHistory: { ...value.privacyHistory, unchanged: false } }]) assert.throws(() => recovery.parseRestorePrivacyHistoryHttpReceipt({ ...value, ...change }));
});

test("runner copies current helper to source/reserve and opts in restore and compiled fault probes without baseline seed", async () => {
  const runner = await readFile(new URL("../verify-restore-recovery.mjs", import.meta.url), "utf8");
  assert.match(runner, /label !== "baseline"[^\n]*restore-recovery-privacy-history\.mjs/);
  assert.match(runner, /privacy-history-seed-before-backup48/);
  assert(runner.indexOf("privacy-history-seed-before-backup48") < runner.indexOf("const dump48 ="));
  assert.match(runner, /SYNTHETIC_PRIVACY_HISTORY: includeModern \? "true" : undefined/);
  assert.match(runner, /SYNTHETIC_PRIVACY_HISTORY: "true"/);
  assert.match(runner, /parseRestorePrivacyHistoryHttpReceipt\(receipt\)/);
  const http = await readFile(new URL("../fixtures/restore-recovery-http.mjs", import.meta.url), "utf8");
  assert.match(http, /SYNTHETIC_PRIVACY_HISTORY/); assert.match(http, /probeRestorePrivacyHistory/);
});
