import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { PrivacyComplianceService } from "../src/application/services/privacy-compliance-service.js";
import { AppError } from "../src/shared/errors/app-error.js";

let originalRentalCustomer: unknown;

beforeEach(() => {
  originalRentalCustomer = (prisma as unknown as { rentalCustomer?: unknown }).rentalCustomer;
});

afterEach(() => {
  Object.defineProperty(prisma, "rentalCustomer", {
    value: originalRentalCustomer,
    configurable: true
  });
});

const assertAppError = (error: unknown, statusCode: number, code: string) => {
  assert.ok(error instanceof AppError);
  assert.equal(error.statusCode, statusCode);
  assert.equal(error.code, code);
};

const anonymize = (input: Partial<Parameters<PrivacyComplianceService["anonymizeCustomer"]>[0]> = {}) => {
  const service = new PrivacyComplianceService();
  return service.anonymizeCustomer({
    tenantId: "tenant_test",
    userId: "user_test",
    customerId: "customer_test",
    confirmation: "ANONYMIZE_CUSTOMER",
    legalBasis: "Richiesta privacy verificata",
    ...input
  });
};

describe("PrivacyComplianceService.anonymizeCustomer", () => {
  it("requires explicit confirmation", async () => {
    await assert.rejects(
      () => anonymize({ confirmation: "WRONG_CONFIRMATION" }),
      (error) => {
        assertAppError(error, 400, "PRIVACY_CONFIRMATION_REQUIRED");
        return true;
      }
    );
  });

  it("requires a legal basis", async () => {
    await assert.rejects(
      () => anonymize({ legalBasis: "  " }),
      (error) => {
        assertAppError(error, 422, "PRIVACY_LEGAL_BASIS_REQUIRED");
        return true;
      }
    );
  });

  it("returns CUSTOMER_NOT_FOUND when the customer does not exist in the tenant", async () => {
    Object.defineProperty(prisma, "rentalCustomer", {
      value: {
        async findFirst() {
          return null;
        }
      },
      configurable: true
    });

    await assert.rejects(
      () => anonymize(),
      (error) => {
        assertAppError(error, 404, "CUSTOMER_NOT_FOUND");
        return true;
      }
    );
  });
});
