import assert from "node:assert/strict";
import test from "node:test";
import { RentalBookingsController } from "../src/interfaces/http/controllers/rental-bookings-controller.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { AppError } from "../src/shared/errors/app-error.js";

test("a customer edit cannot reintroduce PII after the observed active customer is erased", async () => {
  const originals = {
    transaction: prisma.$transaction,
    findFirst: prisma.rentalCustomer.findFirst,
    update: prisma.rentalCustomer.update
  };
  const current: Record<string, any> = {
    id: "customer_synthetic", tenantId: "tenant_synthetic", customerType: "PERSONA_FISICA",
    firstName: "Synthetic", lastName: "Subject", drivingLicenseNumber: "SYNTHETIC-123",
    email: "original@example.test", deletedAt: null
  };
  const erase = () => Object.assign(current, {
    firstName: "Cliente", lastName: "anonimizzato", drivingLicenseNumber: "", email: null, deletedAt: new Date()
  });
  let writes = 0;
  // The old path retains this active precheck while erasure wins before update.
  (prisma.rentalCustomer as any).findFirst = async () => { const observed = { ...current }; erase(); return observed; };
  (prisma.rentalCustomer as any).update = async ({ data }: any) => { writes++; return Object.assign(current, data); };
  // A fenced path encounters the same erasure before starting its transaction.
  (prisma as any).$transaction = async (callback: any) => {
    erase();
    let locks = 0;
    return callback({
      $queryRaw: async () => ++locks === 1 ? [{ id: current.tenantId }] : [{ id: current.id, deletedAt: current.deletedAt }],
      rentalCustomer: {
        findFirst: async () => current.deletedAt ? null : current,
        update: async ({ data }: any) => { writes++; return Object.assign(current, data); }
      }
    });
  };
  try {
    const controller = new RentalBookingsController({ enqueue: async () => assert.fail("No email/provider") } as any);
    await assert.rejects(controller.updateCustomer({ auth: { tenantId: current.tenantId },
      params: { customerId: current.id }, body: { email: "restored-pii@example.test" }
    } as any, { json: () => undefined } as any), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, "CUSTOMER_NOT_FOUND");
      return true;
    });
    assert.equal(writes, 0);
    assert.equal(current.email, null);
    assert.equal(current.firstName, "Cliente");
    assert.ok(current.deletedAt);
  } finally {
    (prisma as any).$transaction = originals.transaction;
    (prisma.rentalCustomer as any).findFirst = originals.findFirst;
    (prisma.rentalCustomer as any).update = originals.update;
  }
});
