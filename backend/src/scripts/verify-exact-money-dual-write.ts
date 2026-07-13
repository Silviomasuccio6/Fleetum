import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { EXACT_NUMERIC_FIELDS } from "../domain/money/exact-money-fields.js";
import { prisma } from "../infrastructure/database/prisma/client.js";
import { logger } from "../infrastructure/logging/logger.js";

type CountRow = { rowCount: number; mismatchCount: number };

const IDS: Record<string, string> = {
  TenantSubscription: "exact_subscription",
  Vehicle: "exact_vehicle",
  VehicleCost: "exact_vehicle_cost",
  VehicleMaintenance: "exact_maintenance",
  VehicleMaintenanceAttachment: "exact_maintenance_attachment",
  RentalBooking: "exact_booking",
  RentalPriceList: "exact_price_list",
  RentalExtraKmPolicy: "exact_km_policy",
  RentalExtraKmTier: "exact_km_tier",
  RentalBookingPricingSnapshot: "exact_pricing_snapshot",
  Stoppage: "exact_stoppage",
  Invoice: "exact_invoice",
  InvoiceItem: "exact_invoice_item"
};

const quoteIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

const executeStaticStatements = async (tx: Prisma.TransactionClient, sql: string) => {
  // PostgreSQL prepared statements accept one command at a time.
  for (const statement of sql.split(";").map((value) => value.trim()).filter(Boolean)) {
    await tx.$executeRawUnsafe(statement);
  }
};

const insertFixtures = (tx: Prisma.TransactionClient) =>
  executeStaticStatements(tx, `
    INSERT INTO "Tenant" ("id", "name", "updatedAt")
    VALUES ('exact_tenant', 'Exact Money Test', NOW());
    INSERT INTO "User" ("id", "tenantId", "email", "passwordHash", "firstName", "lastName", "updatedAt")
    VALUES ('exact_user', 'exact_tenant', 'exact-money@example.invalid', 'not-a-login-hash', 'Exact', 'Test', NOW());
    INSERT INTO "Site" ("id", "tenantId", "name", "address", "city", "updatedAt")
    VALUES ('exact_site', 'exact_tenant', 'Exact Site', 'Test address', 'Test city', NOW());
    INSERT INTO "Workshop" ("id", "tenantId", "name", "updatedAt")
    VALUES ('exact_workshop', 'exact_tenant', 'Exact Workshop', NOW());
    INSERT INTO "Vehicle" ("id", "tenantId", "siteId", "plate", "brand", "model", "purchasePrice", "residualValue", "monthlyFixedCost", "updatedAt")
    VALUES ('exact_vehicle', 'exact_tenant', 'exact_site', 'EXACT001', 'Fleetum', 'Exact', 10000.125, 4999.995, 99.999, NOW());
    INSERT INTO "TenantSubscription" ("id", "tenantId", "priceMonthly", "updatedAt")
    VALUES ('exact_subscription', 'exact_tenant', 149.199, NOW());
    INSERT INTO "VehicleCost" ("id", "tenantId", "vehicleId", "amount", "date", "updatedAt")
    VALUES ('exact_vehicle_cost', 'exact_tenant', 'exact_vehicle', 12.345, NOW(), NOW());
    INSERT INTO "VehicleMaintenance" ("id", "tenantId", "vehicleId", "performedAt", "maintenanceType", "cost", "updatedAt")
    VALUES ('exact_maintenance', 'exact_tenant', 'exact_vehicle', NOW(), 'TEST', 45.678, NOW());
    INSERT INTO "VehicleMaintenanceAttachment" ("id", "tenantId", "maintenanceId", "filePath", "fileName", "mimeType", "sizeBytes", "invoiceTotalAmount")
    VALUES ('exact_maintenance_attachment', 'exact_tenant', 'exact_maintenance', 'test/fixture', 'fixture.pdf', 'application/pdf', 1, 55.555);
    INSERT INTO "RentalBooking" ("id", "tenantId", "vehicleId", "code", "customerName", "pickupAt", "returnAt", "expectedTotal", "finalTotal", "updatedAt")
    VALUES ('exact_booking', 'exact_tenant', 'exact_vehicle', 'EXACT-BOOKING', 'Exact Customer', NOW(), NOW() + INTERVAL '1 day', 123.456, 130.005, NOW());
    INSERT INTO "RentalPriceList" ("id", "tenantId", "name", "baseRateAmount", "vatRate", "discountPercent", "updatedAt")
    VALUES ('exact_price_list', 'exact_tenant', 'Exact Price List', 49.12345, 22.12345, 5.55555, NOW());
    INSERT INTO "RentalExtraKmPolicy" ("id", "tenantId", "priceListId", "name", "flatRatePerKm", "updatedAt")
    VALUES ('exact_km_policy', 'exact_tenant', 'exact_price_list', 'Exact KM Policy', 0.12345, NOW());
    INSERT INTO "RentalExtraKmTier" ("id", "tenantId", "policyId", "ratePerKm", "updatedAt")
    VALUES ('exact_km_tier', 'exact_tenant', 'exact_km_policy', 0.98765, NOW());
    INSERT INTO "RentalBookingPricingSnapshot" (
      "id", "tenantId", "bookingId", "baseRateAmount", "vatRate", "discountPercent",
      "extraKmEstimatedCost", "extraKmActualCost", "expectedSubtotal", "expectedTaxAmount",
      "expectedTotal", "finalSubtotal", "finalTaxAmount", "finalTotal", "updatedAt"
    ) VALUES (
      'exact_pricing_snapshot', 'exact_tenant', 'exact_booking', 40.12345, 22.55555, 3.33335,
      1.235, 2.345, 100.005, 22.225, 122.225, 110.005, 24.205, 134.205, NOW()
    );
    INSERT INTO "Stoppage" (
      "id", "tenantId", "siteId", "vehicleId", "workshopId", "createdByUserId", "reason",
      "estimatedCostPerDay", "openedAt", "updatedAt"
    ) VALUES (
      'exact_stoppage', 'exact_tenant', 'exact_site', 'exact_vehicle', 'exact_workshop',
      'exact_user', 'Exact test', 88.885, NOW(), NOW()
    );
    INSERT INTO "Invoice" (
      "id", "tenantId", "invoiceNumber", "issueDate", "dueDate", "periodStart", "periodEnd",
      "subtotal", "taxRate", "taxAmount", "total", "billingName", "updatedAt"
    ) VALUES (
      'exact_invoice', 'exact_tenant', 'EXACT-INVOICE', NOW(), NOW(), NOW(), NOW(),
      100.005, 22.55555, 22.225, 122.225, 'Exact Billing', NOW()
    );
    INSERT INTO "InvoiceItem" (
      "id", "invoiceId", "description", "quantity", "unitPrice", "subtotal", "taxRate", "taxAmount", "total"
    ) VALUES (
      'exact_invoice_item', 'exact_invoice', 'Exact line', 1.5, 10.005, 15.005, 22.55555, 3.335, 18.335
    );
  `);

const cleanupFixtures = (tx: Prisma.TransactionClient) =>
  executeStaticStatements(tx, `
    DELETE FROM "InvoiceItem" WHERE "id" = 'exact_invoice_item';
    DELETE FROM "Invoice" WHERE "id" = 'exact_invoice';
    DELETE FROM "Stoppage" WHERE "id" = 'exact_stoppage';
    DELETE FROM "RentalBookingPricingSnapshot" WHERE "id" = 'exact_pricing_snapshot';
    DELETE FROM "RentalExtraKmTier" WHERE "id" = 'exact_km_tier';
    DELETE FROM "RentalExtraKmPolicy" WHERE "id" = 'exact_km_policy';
    DELETE FROM "RentalPriceList" WHERE "id" = 'exact_price_list';
    DELETE FROM "RentalBooking" WHERE "id" = 'exact_booking';
    DELETE FROM "VehicleMaintenanceAttachment" WHERE "id" = 'exact_maintenance_attachment';
    DELETE FROM "VehicleMaintenance" WHERE "id" = 'exact_maintenance';
    DELETE FROM "VehicleCost" WHERE "id" = 'exact_vehicle_cost';
    DELETE FROM "TenantSubscription" WHERE "id" = 'exact_subscription';
    DELETE FROM "Vehicle" WHERE "id" = 'exact_vehicle';
    DELETE FROM "Workshop" WHERE "id" = 'exact_workshop';
    DELETE FROM "Site" WHERE "id" = 'exact_site';
    DELETE FROM "User" WHERE "id" = 'exact_user';
    DELETE FROM "Tenant" WHERE "id" = 'exact_tenant';
  `);

const verifyField = async (tx: Prisma.TransactionClient, field: (typeof EXACT_NUMERIC_FIELDS)[number]) => {
  const table = quoteIdentifier(field.table);
  const legacy = quoteIdentifier(field.legacyColumn);
  const exact = quoteIdentifier(field.exactColumn);
  const id = IDS[field.model];
  assert.ok(id, `Missing fixture id for ${field.model}`);

  const mismatch = field.nullable
    ? `((${legacy} IS NULL AND ${exact} IS NOT NULL) OR (${legacy} IS NOT NULL AND (${exact} IS NULL OR ${exact} <> ROUND(${legacy}::numeric, ${field.scale}))))`
    : `(${exact} IS NULL OR ${exact} <> ROUND(${legacy}::numeric, ${field.scale}))`;
  const rows = await tx.$queryRawUnsafe<CountRow[]>(`
    SELECT
      COUNT(*)::int AS "rowCount",
      COUNT(*) FILTER (WHERE ${mismatch})::int AS "mismatchCount"
    FROM ${table}
    WHERE "id" = '${id}'
  `);
  const result = rows[0] ?? { rowCount: 0, mismatchCount: 1 };
  assert.equal(result.rowCount, 1, `${field.model}.${field.legacyField} fixture missing`);
  assert.equal(result.mismatchCount, 0, `${field.model}.${field.legacyField} trigger mismatch`);
};

const verify = async () => {
  await prisma.$transaction(
    async (tx) => {
      await insertFixtures(tx);
      for (const field of EXACT_NUMERIC_FIELDS) await verifyField(tx, field);

      await tx.$executeRawUnsafe(`UPDATE "VehicleCost" SET "amount" = 99.995 WHERE "id" = 'exact_vehicle_cost'`);
      const vehicleCostField = EXACT_NUMERIC_FIELDS.find(
        (field) => field.model === "VehicleCost" && field.legacyField === "amount"
      );
      assert.ok(vehicleCostField);
      await verifyField(tx, vehicleCostField);

      await cleanupFixtures(tx);
    },
    { maxWait: 10_000, timeout: 30_000 }
  );

  logger.info(
    { checkedFields: EXACT_NUMERIC_FIELDS.length, checkedTables: Object.keys(IDS).length },
    "Exact money insert and update triggers verified"
  );
};

verify()
  .catch((error) => {
    logger.error({ error }, "Exact money trigger verification failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
