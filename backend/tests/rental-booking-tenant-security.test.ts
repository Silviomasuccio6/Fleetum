import assert from "node:assert/strict";
import test from "node:test";
import { RentalBookingsController } from "../src/interfaces/http/controllers/rental-bookings-controller.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { AppError } from "../src/shared/errors/app-error.js";

const currentBooking = {
  id: "booking-tenant-a",
  vehicleId: "vehicle-tenant-a",
  customerId: "customer-tenant-a",
  pickupAt: new Date("2026-09-20T08:00:00.000Z"),
  returnAt: new Date("2026-09-21T08:00:00.000Z"),
  pickupKm: null,
  returnKm: null,
  contractSignedAt: null
};

const currentCustomer = {
  id: "customer-tenant-a",
  customerType: "PERSONA_FISICA",
  firstName: "Mario",
  lastName: "Rossi",
  email: "mario.rossi@example.test",
  phone: null,
  documentNumber: null,
  drivingLicenseNumber: "DL-TEST"
};

const vehicle = (id: string, extra: Record<string, unknown> = {}) => ({
  id, tenantId: "tenant-a", siteId: "site-a", isActive: true, deletedAt: null, ...extra
});

const createResponse = () => ({
  statusCode: 200,
  body: null as unknown,
  status(code: number) { this.statusCode = code; return this; },
  json(payload: unknown) { this.body = payload; return this; }
});

// These unit doubles implement only synthetic row locks and lookups. They never
// open a database connection; persistent concurrency cases live in the DB suite.
type UpdateResult = {
  response: ReturnType<typeof createResponse>;
  mutations: number;
  availability: any;
  work: Promise<unknown>;
};

const exerciseUpdate = async (
  body: Record<string, unknown>,
  vehicles: ReturnType<typeof vehicle>[],
  assertResult: (result: UpdateResult) => Promise<void>
) => {
  const controller = new RentalBookingsController({ enqueue: async () => undefined } as any);
  (controller as any).getCustomerOrThrow = async () => currentCustomer;
  (controller as any).lockBookingMutation = async () => undefined;
  (controller as any).lockBookingSchedule = async () => undefined;
  (controller as any).logNote = async () => undefined;
  let availability: any = null;
  (controller as any).assertVehicleAvailability = async (input: unknown) => { availability = input; };
  const response = createResponse();
  const originals = {
    vehicle: prisma.vehicle.findFirst,
    booking: prisma.rentalBooking.findFirst,
    update: prisma.rentalBooking.update,
    transaction: prisma.$transaction,
    query: prisma.$queryRaw
  };
  let mutations = 0;
  (prisma.vehicle as any).findFirst = async ({ where }: any) => {
    const found = vehicles.find((row) => row.id === where.id && row.tenantId === where.tenantId);
    if (!found || (where.deletedAt === null && found.deletedAt !== null)) return null;
    return found;
  };
  (prisma.rentalBooking as any).findFirst = async () => currentBooking;
  (prisma.rentalBooking as any).update = async ({ data }: any) => {
    mutations += 1;
    return { ...currentBooking, ...data, vehicle: { id: data.vehicleId ?? currentBooking.vehicleId }, customer: currentCustomer };
  };
  (prisma as any).$queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes('FROM "Tenant"')) return values[0] === "tenant-a" ? [{ id: "tenant-a" }] : [];
    if (sql.includes('FROM "Site"')) return values[0] === "site-a" && values[1] === "tenant-a" ? [{ deletedAt: null }] : [];
    return [{ id: values[0] }];
  };
  (prisma as any).$transaction = async (callback: (tx: typeof prisma) => unknown) => callback(prisma);
  try {
    const work = controller.update({
      auth: { tenantId: "tenant-a", userId: "user-a" }, params: { id: currentBooking.id }, body
    } as any, response as any);
    await assertResult({ response, get mutations() { return mutations; }, get availability() { return availability; }, work });
  } finally {
    (prisma.vehicle as any).findFirst = originals.vehicle;
    (prisma.rentalBooking as any).findFirst = originals.booking;
    (prisma.rentalBooking as any).update = originals.update;
    (prisma as any).$transaction = originals.transaction;
    (prisma as any).$queryRaw = originals.query;
  }
};

const rejectedWithoutMutation = async (result: UpdateResult) => {
  await assert.rejects(result.work, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 404);
    assert.equal(error.code, "VEHICLE_NOT_FOUND");
    return true;
  });
  assert.equal(result.mutations, 0);
  assert.equal(result.response.body, null);
};

test("booking update rejects a vehicle outside the tenant before mutation or response", async () => {
  await exerciseUpdate({ vehicleId: "vehicle-tenant-b" }, [vehicle(currentBooking.vehicleId)], rejectedWithoutMutation);
});

test("booking update rejects an owned vehicle linked to another tenant Site before mutation", async () => {
  await exerciseUpdate({ vehicleId: "vehicle-tenant-a-2" }, [
    vehicle(currentBooking.vehicleId), vehicle("vehicle-tenant-a-2", { siteId: "site-b" })
  ], rejectedWithoutMutation);
});

test("booking update accepts an active vehicle owned by the tenant and its Site", async () => {
  await exerciseUpdate({ vehicleId: "vehicle-tenant-a-2" }, [
    vehicle(currentBooking.vehicleId), vehicle("vehicle-tenant-a-2")
  ], async (result: UpdateResult) => {
    await result.work;
    assert.equal(result.mutations, 1);
    assert.equal(result.availability.tenantId, "tenant-a");
    assert.equal(result.availability.vehicleId, "vehicle-tenant-a-2");
    assert.equal(result.availability.excludeBookingId, currentBooking.id);
    assert.equal((result.response.body as any).vehicle.id, "vehicle-tenant-a-2");
  });
});

test("booking update permits unrelated edits on an unchanged historical inactive and deleted vehicle", async () => {
  await exerciseUpdate({ internalNotes: "Nota aggiornata" }, [
    vehicle(currentBooking.vehicleId, { isActive: false, deletedAt: new Date("2026-09-20T00:00:00Z") })
  ], async (result: UpdateResult) => {
    await result.work;
    assert.equal(result.mutations, 1);
    assert.equal(result.availability, null);
    assert.equal((result.response.body as any).internalNotes, "Nota aggiornata");
    assert.equal((result.response.body as any).vehicle.id, currentBooking.vehicleId);
  });
});
