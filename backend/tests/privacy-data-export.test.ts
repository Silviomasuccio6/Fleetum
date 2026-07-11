import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import test, { afterEach } from "node:test";
import {
  RENTAL_CUSTOMER_DATA_EXPORT_SCHEMA_VERSION,
  RENTAL_CUSTOMER_EXPORT_RELATION_INVENTORY
} from "../src/application/services/rental-customer-data-export-inventory.js";
import { PrivacyComplianceService } from "../src/application/services/privacy-compliance-service.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";

const original = {
  rentalCustomerFindFirst: prisma.rentalCustomer.findFirst,
  consentLogFindMany: prisma.consentLog.findMany,
  emailQueueFindMany: prisma.emailQueue.findMany,
  auditLogFindMany: prisma.auditLog.findMany,
  auditLogFindFirst: prisma.auditLog.findFirst,
  auditLogCreate: prisma.auditLog.create,
  storedFileObjectFindMany: prisma.storedFileObject.findMany
};

afterEach(() => {
  (prisma.rentalCustomer as any).findFirst = original.rentalCustomerFindFirst;
  (prisma.consentLog as any).findMany = original.consentLogFindMany;
  (prisma.emailQueue as any).findMany = original.emailQueueFindMany;
  (prisma.auditLog as any).findMany = original.auditLogFindMany;
  (prisma.auditLog as any).findFirst = original.auditLogFindFirst;
  (prisma.auditLog as any).create = original.auditLogCreate;
  (prisma.storedFileObject as any).findMany = original.storedFileObjectFindMany;
});

const rentalCustomerRelationFields = () => {
  const schemaPath = fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url));
  const schema = fs.readFileSync(schemaPath, "utf8");
  const modelNames = new Set(Array.from(schema.matchAll(/^model\s+(\w+)\s+\{/gm), (match) => match[1]));
  const block = schema.match(/model RentalCustomer \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(block, "RentalCustomer model not found in Prisma schema");

  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("/") && !line.startsWith("@@"))
    .map((line) => line.split(/\s+/))
    .filter((parts) => modelNames.has(parts[1].replace(/[?\[\]]/g, "")))
    .map((parts) => parts[0]);
};

test("RentalCustomer export inventory covers every Prisma relation", () => {
  assert.deepEqual(
    Object.keys(RENTAL_CUSTOMER_EXPORT_RELATION_INVENTORY).sort(),
    rentalCustomerRelationFields().sort()
  );
});

test("customer data export returns every inventoried data section", async () => {
  let customerQuery: any;
  let exportAudit: any;
  const contractDelivery = { id: "delivery_1", recipient: "customer@example.test" };

  (prisma.rentalCustomer as any).findFirst = async (input: any) => {
    customerQuery = input;
    return {
      id: "customer_1",
      tenantId: "tenant_a",
      firstName: "Mario",
      lastName: "Rossi",
      email: "customer@example.test",
      attachments: [{ id: "attachment_1", fileName: "patente.pdf" }],
      bookings: [{ id: "booking_1", contract: { id: "contract_1", deliveries: [contractDelivery] } }],
      paymentProfiles: [{ id: "profile_1" }],
      paymentMethods: [{ id: "method_1" }],
      rentalDeposits: [{ id: "deposit_1" }],
      rentalExtraCharges: [{ id: "charge_1" }],
      rentalPaymentEvents: [{ id: "event_1" }]
    };
  };
  (prisma.consentLog as any).findMany = async (input: any) => {
    assert.equal(input.where.tenantId, "tenant_a");
    return [{ id: "consent_1", metadata: { preference: "email", token: "do-not-export" } }];
  };
  (prisma.emailQueue as any).findMany = async (input: any) => {
    assert.equal(input.where.tenantId, "tenant_a");
    assert.ok(input.where.recipient.in.includes("customer@example.test"));
    return [{ id: "email_1" }];
  };
  (prisma.auditLog as any).findMany = async (input: any) => {
    assert.equal(input.where.tenantId, "tenant_a");
    assert.ok(input.where.resourceId.in.includes("booking_1"));
    return [{ id: "audit_1", details: { status: "ok", stripeCustomerId: "cus_internal" } }];
  };
  (prisma.storedFileObject as any).findMany = async (input: any) => {
    assert.equal(input.where.tenantId, "tenant_a");
    assert.ok(input.where.resourceId.in.includes("attachment_1"));
    return [{ id: "file_1" }];
  };
  (prisma.auditLog as any).findFirst = async () => null;
  (prisma.auditLog as any).create = async (input: any) => {
    exportAudit = input.data;
    return input.data;
  };

  const result = await new PrivacyComplianceService().exportCustomerData({
    tenantId: "tenant_a",
    userId: "user_a",
    customerId: "customer_1"
  });

  for (const [relation, decision] of Object.entries(RENTAL_CUSTOMER_EXPORT_RELATION_INVENTORY)) {
    if (decision.included) assert.ok(customerQuery.include[relation], `${relation} is not queried by the export`);
  }
  assert.equal(customerQuery.include.bookings.where, undefined, "Soft-deleted retained bookings must remain exportable");
  assert.equal(customerQuery.include.paymentMethods.select.stripePaymentMethodId, undefined);
  assert.equal(customerQuery.include.rentalPaymentEvents.select.payload, undefined);
  assert.equal(result.schemaVersion, RENTAL_CUSTOMER_DATA_EXPORT_SCHEMA_VERSION);
  assert.equal(result.data.profile.id, "customer_1");
  assert.equal(result.data.attachments.length, 1);
  assert.equal(result.data.bookings.length, 1);
  assert.equal(result.data.payments.profiles.length, 1);
  assert.equal(result.data.payments.methods.length, 1);
  assert.equal(result.data.payments.deposits.length, 1);
  assert.equal(result.data.payments.extraCharges.length, 1);
  assert.equal(result.data.payments.events.length, 1);
  assert.equal(result.data.consents.length, 1);
  assert.equal((result.data.consents[0].metadata as any).token, "[excluded]");
  assert.deepEqual(result.data.communications.contractDeliveries, [contractDelivery]);
  assert.equal(result.data.communications.emailQueue.length, 1);
  assert.equal(result.data.auditTrail.length, 1);
  assert.equal((result.data.auditTrail[0].details as any).stripeCustomerId, "[excluded]");
  assert.equal(result.data.storedFiles.length, 1);
  assert.equal(exportAudit.details.schemaVersion, RENTAL_CUSTOMER_DATA_EXPORT_SCHEMA_VERSION);
  assert.equal(exportAudit.details.paymentRecords, 5);
});
