import assert from "node:assert/strict";
import test from "node:test";
import { RentalBookingsController } from "../src/interfaces/http/controllers/rental-bookings-controller.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { AppError } from "../src/shared/errors/app-error.js";

const customer = { id: "customer-a", tenantId: "tenant-a", deletedAt: null, customerType: "PERSONA_FISICA",
  firstName: "Synthetic", lastName: "Subject", drivingLicenseNumber: "DL-SYNTHETIC", email: "synthetic@example.test",
  phone: null, companyName: null, companyVatNumber: null, companySdi: null, residenceStreetAddress: "Via Synthetic 1",
  residencePostalCode: "00100", residenceCity: "Roma", residenceProvince: "RM", residenceCountry: "IT",
  residenceAddress: "Original address" };

const exercise = async (body: Record<string, unknown>, options: { erased?: boolean; foreign?: boolean;
  current?: Record<string, unknown> } = {}) => {
  const originals = { findFirst: prisma.rentalCustomer.findFirst, update: prisma.rentalCustomer.update,
    transaction: prisma.$transaction };
  const events: string[] = [];
  const writes: any[] = [];
  const fresh = { ...customer, ...options.current };
  let response: any; let error: unknown;
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes('FROM "Tenant"')) { events.push("tenant-lock"); return [{ id: "tenant-a" }]; }
      assert.ok(sql.includes('FROM "RentalCustomer"') && sql.includes("FOR NO KEY UPDATE"));
      assert.deepEqual(values, [customer.id, "tenant-a"]);
      events.push("customer-lock");
      return options.foreign ? [] : [{ id: customer.id, deletedAt: options.erased ? new Date() : null }];
    },
    rentalCustomer: {
      findFirst: async ({ where }: any) => {
        assert.equal(where.id, customer.id); assert.equal(where.tenantId, "tenant-a"); assert.equal(where.deletedAt, null);
        assert.ok(events.includes("customer-lock")); events.push("fresh-read"); return fresh;
      },
      update: async ({ data }: any) => { assert.ok(events.includes("fresh-read")); writes.push(data); return { ...fresh, ...data }; }
    }
  };
  // Simulate the old unprotected lookup finishing just before erasure commits.
  (prisma.rentalCustomer as any).findFirst = async () => { events.push("unprotected-read"); return customer; };
  (prisma.rentalCustomer as any).update = async ({ data }: any) => {
    events.push("unprotected-write"); writes.push(data); return { ...fresh, ...data };
  };
  (prisma as any).$transaction = async (callback: any) => callback(tx);
  try {
    const controller = new RentalBookingsController();
    await controller.updateCustomer({ auth: { tenantId: "tenant-a" }, params: { customerId: customer.id }, body } as any,
      { json: (value: unknown) => { response = value; } } as any);
  } catch (caught) { error = caught; }
  finally {
    (prisma.rentalCustomer as any).findFirst = originals.findFirst;
    (prisma.rentalCustomer as any).update = originals.update;
    (prisma as any).$transaction = originals.transaction;
  }
  return { error, response, writes, events };
};

test("customer update cannot reintroduce personal data after erasure wins the subject lock", async () => {
  const result = await exercise({ email: "new@example.test", firstName: "Reintroduced" }, { erased: true });
  assert.ok(result.error instanceof AppError);
  assert.equal(result.error.code, "CUSTOMER_NOT_FOUND");
  assert.deepEqual(result.writes, []); assert.equal(result.response, undefined);
});

test("customer update rejects a foreign subject under the same lock without mutation", async () => {
  const result = await exercise({ email: "new@example.test" }, { foreign: true });
  assert.ok(result.error instanceof AppError); assert.equal(result.error.code, "CUSTOMER_NOT_FOUND");
  assert.deepEqual(result.writes, []);
});

test("customer business rules and address composition use the fresh locked customer", async () => {
  const result = await exercise({ residenceStreetAddress: "Via Nuova 2", drivingLicenseNumber: "dl-updated" }, {
    current: { residenceCity: "Milano", residencePostalCode: "20100", residenceProvince: "MI" }
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.events, ["tenant-lock", "customer-lock", "fresh-read"]);
  assert.equal(result.response.drivingLicenseNumber, "DL-UPDATED");
  assert.match(result.response.residenceAddress, /Milano/);
  assert.match(result.response.residenceAddress, /20100/);
  assert.doesNotMatch(result.response.residenceAddress, /Roma/);
  assert.equal(Object.hasOwn(result.writes[0], "deletedAt"), false);
});

test("customer validation rejects an invalid business merge after fresh locked reread", async () => {
  const result = await exercise({ companyName: "" }, { current: {
    customerType: "PERSONA_GIURIDICA", companyName: null, companyVatNumber: "12345678901"
  } });
  assert.ok(result.error instanceof AppError);
  assert.deepEqual(result.writes, []);
  assert.deepEqual(result.events, ["tenant-lock", "customer-lock", "fresh-read"]);
});
