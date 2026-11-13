import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Importing this helper is pure. Every value is synthetic; raw database rows,
// HTTP bodies, credentials and headers stay in memory and never enter receipts.
const guard = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = value => createHash("sha256").update(value).digest("hex");
const canonical = value => typeof value === "string" && path.isAbsolute(value) && path.normalize(value) === value;
const ownedArchive = value => canonical(value) && /^\/private\/tmp\/fleetum-restore-recovery-[A-Za-z0-9-]+\/(source|reserve)$/.test(value);
const instant = new Date("2026-01-05T10:00:00.000Z");
const tenantId = "demo_tenant";
const prefix = "restore_privacy_";
const id = suffix => `${prefix}${suffix}`;
const ids = Object.freeze({ subjectCustomer: id("subject"), siblingCustomer: id("sibling"), erasedCustomer: id("erased"),
  ownBooking: id("booking_own"), otherBooking: id("booking_other"), ownContract: id("contract_own"), otherContract: id("contract_other"),
  ownDelivery: id("delivery_own"), otherDelivery: id("delivery_other"), erasedAttachment: id("removed_attachment"), tombstone: id("tombstone"),
  frozenBooking: id("booking_frozen"), legacyBooking: id("booking_legacy"), frozenSnapshot: id("snapshot_frozen"), legacySnapshot: id("snapshot_legacy"),
  priceList: id("list"), pricePackage: id("package"), extraKmPolicy: id("policy") });
const sharedEmail = "restore-shared@example.invalid";
const piiFields = ["firstName", "lastName", "drivingLicenseNumber", "drivingLicenseIssuedAt", "drivingLicenseExpiresAt", "drivingLicenseAuthority", "drivingLicenseCategory", "email", "phone", "dateOfBirth", "placeOfBirth", "birthCountry", "birthProvince", "birthMunicipalityCode", "birthCity", "nationality", "nationalityCountry", "residenceAddress", "residenceCountry", "residenceRegion", "residenceProvince", "residenceMunicipalityCode", "residenceCity", "residencePostalCode", "residenceStreetAddress", "taxCode", "documentType", "documentNumber", "documentIssuedAt", "documentExpiresAt", "documentAuthority", "companyName", "companyLegalForm", "companyVatNumber", "companyTaxCode", "companyLegalAddress", "companyCountry", "companyRegion", "companyProvince", "companyMunicipalityCode", "companyCity", "companyPostalCode", "companyStreetAddress", "companyPec", "companySdi", "companyRea", "legalRepFirstName", "legalRepLastName", "legalRepTaxCode", "legalRepRole", "legalRepEmail", "legalRepPhone", "notes"];
export const PRIVACY_HISTORY_HTTP_CHECKS = Object.freeze(["privacy-export-owner-receipt-only", "privacy-export-other-tenant-denied", "privacy-export-anonymous-denied", "privacy-erased-late-edit-denied", "privacy-active-sibling-readable", "privacy-erasure-and-tombstone-preserved", "pricing-frozen-terms-noop-250", "pricing-legacy-noop-quote-unavailable", "pricing-other-tenant-denied", "privacy-history-fixture-unchanged", "privacy-export-legitimate-audit-retained"]);

export function parsePrivacyHistoryConfig({ argv, env } = {}) {
  guard(Array.isArray(argv) && argv.length === 2, "Expected explicit privacy/history mode and archive");
  const [mode, archiveRoot] = argv;
  guard(["seed", "check"].includes(mode) && ownedArchive(archiveRoot), "Expected an owned current recovery archive");
  guard(env?.SYNTHETIC_PRIVACY_HISTORY === "true" && env.NODE_ENV === "test" && env.DOTENV_CONFIG_PATH === "/dev/null", "Privacy/history fixture requires explicit test opt-in and disabled dotenv");
  for (const name of ["PRIVACY_RETENTION_CRON_ENABLED", "PRIVACY_RETENTION_GLOBAL_ENABLED", "BILLING_DUNNING_CRON_ENABLED"]) guard(env[name] === "false", "Privacy/history fixture requires disabled background workers");
  for (const name of ["NODE_OPTIONS", "DOTENV_CONFIG_ENCODING", "DOTENV_CONFIG_OVERRIDE", "DOTENV_CONFIG_DEBUG"]) guard(!env[name], "Runtime injection is forbidden");
  const engineEnvironment = {};
  for (const name of ["PRISMA_QUERY_ENGINE_LIBRARY", "PRISMA_SCHEMA_ENGINE_BINARY"]) if (env[name] !== undefined) {
    guard(canonical(env[name]) && env[name].startsWith(`${archiveRoot}/`), "Generated engines must remain in the archive"); engineEnvironment[name] = env[name];
  }
  let url; try { url = new URL(env.DATABASE_URL); } catch { throw new Error("Expected a guarded synthetic database"); }
  guard(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" && /^[0-9]+$/.test(url.port) && Number(url.port) > 0 && Number(url.port) <= 65535, "Expected explicit loopback PostgreSQL");
  guard(url.username === "fleetum_restore" && url.password.length > 0 && /^\/fleetum_restore_[a-f0-9]{32}_(source|first|second)$/.test(url.pathname) && !url.hash, "Expected a task-owned synthetic database");
  const options = [...url.searchParams.entries()];
  guard(new Set(options.map(([name]) => name)).size === options.length && options.every(([name, value]) => name === "schema" && value === "public" || name === "connect_timeout" && /^[1-9]$/.test(value)), "Unexpected database options");
  if (mode === "seed") guard(archiveRoot.endsWith("/source") && url.pathname.endsWith("_source"), "Seed runs only on schema48 current source before its dump");
  return Object.freeze({ mode, archiveRoot, databaseUrl: url.href, engineEnvironment: Object.freeze(engineEnvironment) });
}

export async function validatePrivacyHistoryRuntime(config) {
  guard(ownedArchive(config.archiveRoot), "Expected an owned current archive");
  for (const relative of [".env", "backend/.env", "prisma/.env", "backend/prisma/.env"]) {
    let found = false; try { await lstat(path.join(config.archiveRoot, relative)); found = true; } catch (error) { if (error?.code !== "ENOENT") throw error; }
    guard(!found, "Archive must contain no runtime dotenv");
  }
  let cursor = "/";
  for (const component of config.archiveRoot.split("/").filter(Boolean)) { cursor = path.join(cursor, component); guard(!(await lstat(cursor)).isSymbolicLink(), "Archive path must not traverse symlinks"); }
  guard((await lstat(config.archiveRoot)).isDirectory() && await realpath(config.archiveRoot) === config.archiveRoot, "Expected a canonical archive directory");
  for (const engine of Object.values(config.engineEnvironment)) guard((await lstat(engine)).isFile() && await realpath(engine) === engine, "Generated runtime engine must be a regular archive-owned file");
  const tombstonePath = path.join(config.archiveRoot, "uploads", `tenants/${tenantId}/rental-customers/${ids.erasedAttachment}.pdf`);
  let bytesPresent = false; try { await lstat(tombstonePath); bytesPresent = true; } catch (error) { if (error?.code !== "ENOENT") throw error; }
  guard(!bytesPresent, "Erased fixture must have no live file or file symlink in the served archive");
}

export function buildRestorePrivacyHistoryPlan() {
  const records = [];
  const add = (model, data, updated = true) => records.push({ model, data: { ...data, createdAt: new Date(instant), ...(updated ? { updatedAt: new Date(instant) } : {}) } });
  add("User", { id: id("shared_user"), tenantId, email: sharedEmail, passwordHash: "RESTORE_PRIVATE_SYNTHETIC_INVALID_HASH", firstName: "Synthetic", lastName: "Shared mailbox", status: "SUSPENDED", isEmailVerified: false });
  for (const [customerId, firstName] of [[ids.subjectCustomer, "Synthetic subject"], [ids.siblingCustomer, "Synthetic sibling"]]) add("RentalCustomer", { id: customerId, tenantId, customerType: "PERSONA_FISICA", firstName, lastName: "Restore", drivingLicenseNumber: "", email: sharedEmail, deletedAt: null });
  add("RentalCustomer", { id: ids.erasedCustomer, tenantId, customerType: "PERSONA_FISICA", ...Object.fromEntries(piiFields.map(field => [field, null])), firstName: "Cliente", lastName: `anonimizzato ${sha256(ids.erasedCustomer).slice(0, 8)}`, drivingLicenseNumber: "", deletedAt: new Date(instant) });
  for (const [bookingId, customerId, label] of [[ids.ownBooking, ids.subjectCustomer, "own"], [ids.otherBooking, ids.siblingCustomer, "other"], [ids.frozenBooking, null, "frozen"], [ids.legacyBooking, null, "legacy"]]) add("RentalBooking", {
    id: bookingId, tenantId, vehicleId: "compat_vehicle", customerId, code: `SYNTHETIC-PRIVACY-${label}`, status: "IN_RENT", contractRequired: false,
    customerName: "Synthetic recovery customer", customerEmail: sharedEmail, pickupAt: new Date("2027-03-10T08:00:00.000Z"), returnAt: new Date("2027-03-12T08:00:00.000Z"),
    ...(customerId === null ? { expectedTotal: 777, finalTotal: 888 } : {}), deletedAt: null
  });
  for (const [contractId, bookingId, deliveryId] of [[ids.ownContract, ids.ownBooking, ids.ownDelivery], [ids.otherContract, ids.otherBooking, ids.otherDelivery]]) {
    add("BookingContract", { id: contractId, tenantId, bookingId, title: "Synthetic contract copy", content: "Synthetic contract document", emailTo: sharedEmail, deletedAt: null });
    add("BookingContractDelivery", { id: deliveryId, tenantId, bookingId, contractId, channel: "EMAIL", recipient: sharedEmail, subject: "Synthetic contract delivery", body: "Synthetic document copy", status: "SENT", sentAt: new Date(instant) }, false);
  }
  const ownRefs = { bookingId: ids.ownBooking, contractId: ids.ownContract, contractDeliveryId: ids.ownDelivery };
  for (const [suffix, type, queueTenant, references] of [
    ["own", "BOOKING_CONTRACT", tenantId, ownRefs],
    ["password", "PASSWORD_RESET", tenantId, ownRefs], ["invitation", "USER_INVITATION", tenantId, ownRefs],
    ["unrelated", "BOOKING_CONTRACT", tenantId, { bookingId: ids.otherBooking, contractId: ids.otherContract, contractDeliveryId: ids.otherDelivery }],
    ["unlinked", "BOOKING_CONTRACT", tenantId, {}],
    ["conflicting", "BOOKING_CONTRACT", tenantId, { ...ownRefs, contractDeliveryId: ids.otherDelivery }],
    ["foreign", "BOOKING_CONTRACT", "restore_tenant_b", ownRefs],
    ["partial", "BOOKING_CONTRACT", tenantId, { bookingId: ids.ownBooking, contractId: ids.ownContract }]
  ]) add("EmailQueue", { id: id(`queue_${suffix}`), tenantId: queueTenant, type, recipient: sharedEmail, subject: `RESTORE_PRIVATE_${suffix}_SUBJECT`, body: `RESTORE_PRIVATE_${suffix}_BODY`,
    meta: { ...references, opaqueSentinel: `RESTORE_PRIVATE_${suffix}_META`, resetToken: `RESTORE_PRIVATE_${suffix}_TOKEN` }, lastError: `RESTORE_PRIVATE_${suffix}_ERROR`, status: "SENT", attempts: 1, maxAttempts: 5, nextAttemptAt: new Date(instant) });
  add("StoredFileObject", { id: ids.tombstone, tenantId, provider: "local", bucket: "local", storageKey: `tenants/${tenantId}/rental-customers/${ids.erasedAttachment}.pdf`, originalName: "synthetic-erased.pdf", mimeType: "application/pdf", sizeBytes: 0,
    checksumSha256: sha256(""), resourceType: "RentalCustomerAttachment", resourceId: ids.erasedAttachment, visibility: "private", deletedAt: new Date(instant) }, false);
  add("RentalPriceList", { id: ids.priceList, tenantId, name: "Changed inactive live list", scope: "GLOBAL", baseRateUnit: "DAILY", baseRateAmount: 999, vatRate: 22, discountPercent: 0, hourOverflowRule: "FULL_DAY", isActive: false, deletedAt: new Date(instant) });
  add("RentalPricePackage", { id: ids.pricePackage, tenantId, priceListId: ids.priceList, name: "Changed inactive live package", type: "LIMITED", kmIncluded: 999, kmScope: "PER_RENTAL", isActive: false, deletedAt: new Date(instant) });
  add("RentalExtraKmPolicy", { id: ids.extraKmPolicy, tenantId, priceListId: ids.priceList, packageId: ids.pricePackage, name: "Changed inactive live policy", type: "FLAT", flatRatePerKm: 77, isActive: false, deletedAt: new Date(instant) });
  const metadata = { kind: "fleetum.rental-pricing-terms", version: 1,
    priceList: { id: ids.priceList, name: "Frozen historical list", baseRateUnit: "DAILY", baseRateAmount: 100, vatRate: 0, discountPercent: 0, hourOverflowRule: "FULL_DAY" },
    pricePackage: { id: ids.pricePackage, name: "Frozen 50 km", type: "LIMITED", kmIncluded: 50, kmScope: "PER_RENTAL" },
    extraKmPolicy: { id: ids.extraKmPolicy, name: "Frozen extra km", type: "FLAT", flatRatePerKm: 1, tiers: [] } };
  for (const [snapshotId, bookingId, frozen] of [[ids.frozenSnapshot, ids.frozenBooking, true], [ids.legacySnapshot, ids.legacyBooking, false]]) add("RentalBookingPricingSnapshot", {
    id: snapshotId, tenantId, bookingId, priceListId: ids.priceList, pricePackageId: ids.pricePackage, extraKmPolicyId: ids.extraKmPolicy,
    priceListName: metadata.priceList.name, pricePackageName: metadata.pricePackage.name, extraKmPolicyName: metadata.extraKmPolicy.name,
    baseRateUnit: "DAILY", baseRateAmount: 100, vatRate: 0, discountPercent: 0, hourOverflowRule: "FULL_DAY", estimatedKm: 100, actualKm: 100,
    includedKmTotal: 50, extraKmEstimated: 50, extraKmActual: 50, extraKmEstimatedCost: 50, extraKmActualCost: 50, daysCharged: 2,
    expectedSubtotal: 250, expectedTaxAmount: 0, expectedTotal: 250, finalSubtotal: 250, finalTaxAmount: 0, finalTotal: 250, notes: "Synthetic historical note", metadata: frozen ? metadata : null, deletedAt: null
  });
  assert.equal(records.length, 26);
  return { records, ids, sharedEmail, allowedQueueIds: [id("queue_own")], activeFilesAdded: 0 };
}

const moneyFields = { RentalBooking: ["expectedTotal", "finalTotal"], RentalPriceList: ["baseRateAmount", "vatRate", "discountPercent"], RentalExtraKmPolicy: ["flatRatePerKm"], RentalBookingPricingSnapshot: ["baseRateAmount", "vatRate", "discountPercent", "extraKmEstimatedCost", "extraKmActualCost", "expectedSubtotal", "expectedTaxAmount", "expectedTotal", "finalSubtotal", "finalTaxAmount", "finalTotal"] };
const comparable = value => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(comparable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, comparable(entry)])) : value;
// Prisma persists UTC into PostgreSQL timestamp-without-time-zone columns.
// to_jsonb omits the zone: Date must not reinterpret it in the operator's zone.
const timestampMillis = value => new Date(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value) ? `${value}Z` : value).getTime();
export function buildPrivacyHistorySnapshotSql() {
  const records = buildRestorePrivacyHistoryPlan().records;
  const models = [...new Set(records.map(row => row.model))];
  return `${models.map(model => `SELECT '${model}'::text AS model, to_jsonb(t) AS data FROM "${model}" t WHERE t."id" IN (${records.filter(row => row.model === model).map(row => `'${row.data.id}'`).join(",")})`).join(" UNION ALL ")}
    UNION ALL SELECT 'RentalCustomerAttachment', to_jsonb(t) FROM "RentalCustomerAttachment" t WHERE t."customerId"='${ids.erasedCustomer}' OR t."id"='${ids.erasedAttachment}'
    UNION ALL SELECT 'RentalBookingNote', to_jsonb(t) FROM "RentalBookingNote" t WHERE t."bookingId" IN ('${ids.frozenBooking}','${ids.legacyBooking}');`;
}

async function currentSchema(prisma) {
  const rows = await prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
  guard(rows.length === 1 && Number(rows[0].count) === 48, "Privacy/history proof requires exactly 48 successful current migrations");
}

export async function assertRestorePrivacyHistoryState(prisma, { phase = "check", onStage = () => {} } = {}) {
  onStage("check-schema"); guard(["seed", "check"].includes(phase), "Expected explicit privacy/history receipt phase"); await currentSchema(prisma);
  const plan = buildRestorePrivacyHistoryPlan(); const rows = await prisma.$queryRawUnsafe(buildPrivacyHistorySnapshotSql());
  onStage("check-row-count");
  guard(rows.length === plan.records.length, "Expected every fixture row and no resurrected attachment or pricing note");
  const canonicalRows = [];
  for (const expected of plan.records) {
    onStage(`check-${expected.model}-identity`);
    const matches = rows.filter(row => row.model === expected.model && row.data?.id === expected.data.id);
    guard(matches.length === 1, "Fixture identity missing or duplicated"); const data = matches[0].data;
    for (const [field, value] of Object.entries(expected.data)) {
      onStage(`check-${expected.model}-${field}`);
      if (value instanceof Date) guard(timestampMillis(data[field]) === value.getTime(), "Synthetic fixture timestamp changed");
      else assert.deepEqual(comparable(data[field]), comparable(value), "Synthetic fixture field changed");
    }
    // The ignored exact columns are read from actual PostgreSQL, including the
    // overridden booking totals. No floating-point money oracle is computed.
    for (const field of moneyFields[expected.model] ?? []) if (Object.hasOwn(expected.data, field)) { onStage(`check-${expected.model}-${field}Exact`); guard(data[`${field}Exact`] !== null && Number(data[`${field}Exact`]) === expected.data[field], "Synthetic exact amount changed"); }
    canonicalRows.push({ model: expected.model, data: comparable(data) });
  }
  canonicalRows.sort((a, b) => a.model.localeCompare(b.model) || a.data.id.localeCompare(b.data.id));
  return { format: "fleetum-restore-privacy-history-v1", phase, localOnly: true, schemaMigrations: 48, fixtureRows: 26, erasedCustomers: 1, tombstonedFiles: 1, activeFilesAdded: 0, frozenSnapshots: 1, legacySnapshots: 1, sha256: sha256(JSON.stringify(canonicalRows)) };
}

export async function seedRestorePrivacyHistory(prisma, onStage = () => {}) {
  onStage("seed-schema"); await currentSchema(prisma);
  guard((await prisma.$queryRawUnsafe(buildPrivacyHistorySnapshotSql())).length === 0, "Privacy/history seed refuses pre-existing fixture identities");
  await prisma.$transaction(async tx => {
    guard(await tx.user.findFirst({ where: { tenantId, email: "admin@demo.local", deletedAt: null }, select: { id: true } }), "Current synthetic administrator missing");
    for (const record of buildRestorePrivacyHistoryPlan().records) {
      const data = { ...record.data }; if (record.model === "RentalBookingPricingSnapshot" && data.metadata === null) delete data.metadata;
      onStage(`seed-${record.model}`);
      await tx[record.model[0].toLowerCase() + record.model.slice(1)].create({ data });
    }
  }, { maxWait: 10000, timeout: 30000 });
  onStage("seed-assert"); return assertRestorePrivacyHistoryState(prisma, { phase: "seed", onStage });
}

export function assertPrivacyHistoryExport(value) {
  const plan = buildRestorePrivacyHistoryPlan();
  guard(value?.subject?.type === "rental_customer" && value.subject.id === plan.ids.subjectCustomer, "Export must belong to the selected subject");
  guard(!JSON.stringify(value).includes("RESTORE_PRIVATE_"), "Raw queue or credential content leaked into export");
  const receipts = value?.data?.communications?.emailQueue;
  guard(Array.isArray(receipts) && receipts.length === 1, "Export must contain only the subject's linked contract receipt");
  const allowed = ["attempts", "createdAt", "id", "maxAttempts", "nextAttemptAt", "recipient", "status", "type", "updatedAt"];
  const row = receipts[0]; guard(row && typeof row === "object" && Object.keys(row).sort().join(",") === allowed.join(","), "Export queue receipt must use the exact safe allowlist");
  guard(row.id === plan.allowedQueueIds[0] && row.type === "BOOKING_CONTRACT" && row.recipient === sharedEmail && row.status === "SENT" && row.attempts === 1 && row.maxAttempts === 5, "Wrong exported communication identity");
  for (const field of ["createdAt", "updatedAt", "nextAttemptAt"]) guard(new Date(row[field]).getTime() === instant.getTime(), "Exported communication timestamp changed");
  return { communicationCount: 1 };
}

export async function probeRestorePrivacyHistory({ request, prisma, headers, otherHeaders, setStep = () => {} }) {
  const before = await assertRestorePrivacyHistoryState(prisma);
  const auditCount = async () => {
    const rows = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "AuditLog" WHERE "tenantId"='${tenantId}' AND action='DATA_SUBJECT_EXPORT' AND "resourceId"='${ids.subjectCustomer}';`);
    guard(rows.length === 1 && Number.isSafeInteger(Number(rows[0].count)), "Expected bounded export audit count"); return Number(rows[0].count);
  };
  const auditsBefore = await auditCount(); const checks = [];
  const exportRoute = `/privacy/data-subjects/customers/${ids.subjectCustomer}/export`;
  setStep("privacy-export-owner"); const exported = await request(exportRoute, { headers }); assert.equal(exported.status, 200); assertPrivacyHistoryExport(await exported.json()); checks.push(PRIVACY_HISTORY_HTTP_CHECKS[0]);
  setStep("privacy-export-other-tenant"); assert.equal((await request(exportRoute, { headers: otherHeaders })).status, 404); checks.push(PRIVACY_HISTORY_HTTP_CHECKS[1]);
  setStep("privacy-export-anonymous"); assert.equal((await request(exportRoute)).status, 401); checks.push(PRIVACY_HISTORY_HTTP_CHECKS[2]);
  setStep("privacy-erased-late-edit"); const edited = await request(`/rental-bookings/customers/${ids.erasedCustomer}`, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ firstName: "RESTORE_PRIVATE_RESURRECTED", email: "restore-resurrection@example.invalid" }) });
  assert.equal(edited.status, 404); assert.equal((await edited.json()).error, "CUSTOMER_NOT_FOUND"); checks.push(PRIVACY_HISTORY_HTTP_CHECKS[3]);
  setStep("privacy-active-sibling"); const sibling = await request(`/rental-bookings/customers/${ids.siblingCustomer}`, { headers }); assert.equal(sibling.status, 200); assert.equal((await sibling.json()).id, ids.siblingCustomer); checks.push(PRIVACY_HISTORY_HTTP_CHECKS[4]);
  const pricingBody = JSON.stringify({ preserveTerms: true });
  for (const [bookingId, frozen] of [[ids.frozenBooking, true], [ids.legacyBooking, false]]) {
    setStep(frozen ? "pricing-frozen-noop" : "pricing-legacy-noop");
    const response = await request(`/rental-bookings/${bookingId}/pricing`, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: pricingBody });
    assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.bookingId, bookingId);
    assert.equal(result.snapshot.expectedTotal, 250); assert.equal(result.snapshot.finalTotal, 250);
    if (frozen) { assert.equal(result.quote?.pricing?.expectedTotal, 250); assert.equal(result.quote?.pricing?.finalTotal, 250); assert.equal(result.quote?.km?.includedKmTotal, 50); assert.equal(result.quote?.pricing?.baseRateAmount, 100); checks.push(PRIVACY_HISTORY_HTTP_CHECKS[6]); }
    else { assert.equal(result.quote, null); checks.push(PRIVACY_HISTORY_HTTP_CHECKS[7]); }
  }
  setStep("pricing-other-tenant"); assert.equal((await request(`/rental-bookings/${ids.frozenBooking}/pricing`, { method: "PATCH", headers: { ...otherHeaders, "content-type": "application/json" }, body: pricingBody })).status, 404); checks.push(PRIVACY_HISTORY_HTTP_CHECKS[8]);
  setStep("privacy-history-unchanged"); const after = await assertRestorePrivacyHistoryState(prisma); assert.equal(after.sha256, before.sha256); checks.push(PRIVACY_HISTORY_HTTP_CHECKS[5], PRIVACY_HISTORY_HTTP_CHECKS[9]);
  assert.equal(await auditCount(), auditsBefore + 1); checks.push(PRIVACY_HISTORY_HTTP_CHECKS[10]);
  return { checks, privacyHistory: { ...after, communicationCount: 1, historicalQuoteTotal: 250, legacyQuoteUnavailable: true, unchanged: true, exportAuditDelta: 1 } };
}

function isolateEnvironment(config) {
  const clean = { NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null", SYNTHETIC_PRIVACY_HISTORY: "true", DATABASE_URL: config.databaseUrl,
    JWT_SECRET: "synthetic-restore-jwt-only-000000000000000000000000", STORAGE_PROVIDER: "local", RESEND_API_KEY: "re_ci_placeholder", RESEND_FROM: "Synthetic restore <restore@example.invalid>",
    PRIVACY_RETENTION_CRON_ENABLED: "false", PRIVACY_RETENTION_GLOBAL_ENABLED: "false", BILLING_DUNNING_CRON_ENABLED: "false", PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1", ...config.engineEnvironment };
  for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, clean); process.chdir(config.archiveRoot);
  const blocked = () => { throw new Error("ProviderHttpBlocked"); };
  for (const module of [http, https]) { module.request = blocked; module.get = blocked; } globalThis.fetch = blocked; syncBuiltinESMExports();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const write = process.stdout.write.bind(process.stdout);
  const discard = (_chunk, encoding, callback) => { if (typeof encoding === "function") encoding(); else if (typeof callback === "function") callback(); return true; };
  process.stdout.write = discard; process.stderr.write = discard;
  let prisma; let stage = "config";
  try {
    guard(/^22\.23\./.test(process.versions.node), "Use pinned Node 22.23");
    const config = parsePrivacyHistoryConfig({ argv: process.argv.slice(2), env: process.env }); stage = "runtime-guard"; await validatePrivacyHistoryRuntime(config); stage = "isolate"; isolateEnvironment(config);
    const client = path.join(config.archiveRoot, "backend/src/infrastructure/database/prisma/client.ts"); guard((await lstat(client)).isFile() && await realpath(client) === client, "Expected archive-owned Prisma client");
    stage = "import-client"; ({ prisma } = await import(pathToFileURL(client).href));
    const onStage = value => { stage = value; };
    const receipt = config.mode === "seed" ? await seedRestorePrivacyHistory(prisma, onStage) : await assertRestorePrivacyHistoryState(prisma, { onStage });
    write(`FLEETUM_RESTORE_PRIVACY_HISTORY_JSON ${JSON.stringify(receipt)}\n`);
  } catch (error) { const names = new Set(["Error", "TypeError", "AssertionError", "PrismaClientValidationError", "PrismaClientKnownRequestError", "PrismaClientInitializationError"]); const diagnostic = { stage, errorName: names.has(error?.name) ? error.name : "Error", ...(typeof error?.code === "string" && /^P[0-9]{4}$/.test(error.code) ? { code: error.code } : {}) }; write(`FLEETUM_RESTORE_PRIVACY_HISTORY_JSON ${JSON.stringify({ format: "fleetum-restore-privacy-history-failure-v1", localOnly: true, diagnostic })}\n`); process.exitCode = 1; }
  finally { if (prisma) { try { await prisma.$disconnect(); } catch { process.exitCode = 1; } } }
}
