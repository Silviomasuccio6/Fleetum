import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import test, { afterEach } from "node:test";
import { PrivacyComplianceService } from "../src/application/services/privacy-compliance-service.js";
import { RENTAL_CUSTOMER_PII_FIELDS } from "../src/application/services/rental-customer-pii.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";

const original = {
  rentalCustomerFindFirst: prisma.rentalCustomer.findFirst,
  rentalCustomerAttachmentFindMany: prisma.rentalCustomerAttachment.findMany,
  transaction: prisma.$transaction
};

afterEach(() => {
  (prisma.rentalCustomer as any).findFirst = original.rentalCustomerFindFirst;
  (prisma.rentalCustomerAttachment as any).findMany = original.rentalCustomerAttachmentFindMany;
  (prisma as any).$transaction = original.transaction;
});

const schemaPiiFields = () => {
  const schemaPath = fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url));
  const lines = fs.readFileSync(schemaPath, "utf8").split("\n");
  const fields: string[] = [];
  let inRentalCustomer = false;
  let nextFieldIsPii = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "model RentalCustomer {") {
      inRentalCustomer = true;
      continue;
    }
    if (!inRentalCustomer) continue;
    if (line === "}") break;
    if (line === "/// @pii") {
      nextFieldIsPii = true;
      continue;
    }
    if (!nextFieldIsPii || !line || line.startsWith("//") || line.startsWith("@@")) continue;

    fields.push(line.split(/\s+/)[0]);
    nextFieldIsPii = false;
  }

  return fields;
};

test("customer erasure clears every RentalCustomer field marked as PII", async () => {
  const annotatedPiiFields = schemaPiiFields();
  assert.deepEqual(
    [...RENTAL_CUSTOMER_PII_FIELDS].sort(),
    [...annotatedPiiFields].sort(),
    "The centralized anonymization list must match every RentalCustomer field marked /// @pii"
  );

  const seededPii = Object.fromEntries(
    annotatedPiiFields.map((field) => [
      field,
      field.endsWith("At") || field === "dateOfBirth"
        ? new Date("1990-01-02T00:00:00.000Z")
        : `PII:${field}`
    ])
  ) as Record<string, unknown>;
  const persistedCustomer: Record<string, unknown> = {
    id: "customer_pii",
    tenantId: "tenant_a",
    deletedAt: null,
    ...seededPii
  };

  (prisma.rentalCustomer as any).findFirst = async () => persistedCustomer;
  (prisma.rentalCustomerAttachment as any).findMany = async () => [];
  (prisma as any).$transaction = async (callback: any) =>
    callback({
      rentalBooking: { updateMany: async () => ({ count: 2 }) },
      bookingContract: { updateMany: async () => ({ count: 1 }) },
      rentalCustomerAttachment: { deleteMany: async () => ({ count: 0 }) },
      rentalCustomer: {
        update: async (input: { data: Record<string, unknown> }) => {
          Object.assign(persistedCustomer, input.data);
          return persistedCustomer;
        }
      },
      auditLog: { create: async (input: unknown) => input }
    });

  const result = await new PrivacyComplianceService().anonymizeCustomer({
    tenantId: "tenant_a",
    userId: "user_a",
    customerId: "customer_pii",
    confirmation: "ANONYMIZE_CUSTOMER",
    legalBasis: "Richiesta verificata dell'interessato"
  });

  assert.equal(result.anonymized, true);
  assert.equal(persistedCustomer.firstName, "Cliente");
  assert.match(String(persistedCustomer.lastName), /^anonimizzato [a-f0-9]{8}$/);
  assert.equal(persistedCustomer.drivingLicenseNumber, "");
  assert.ok(persistedCustomer.deletedAt instanceof Date);

  const requiredReplacements = new Set(["firstName", "lastName", "drivingLicenseNumber"]);
  for (const field of annotatedPiiFields) {
    assert.notDeepEqual(
      persistedCustomer[field],
      seededPii[field],
      `${field} retained its original PII value after anonymization`
    );
    if (!requiredReplacements.has(field)) {
      assert.equal(persistedCustomer[field], null, `${field} was not cleared`);
    }
  }
});
