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

const createController = () => {
  const controller = new RentalBookingsController({ enqueue: async () => undefined } as any);
  (controller as any).getBookingOrThrow = async () => currentBooking;
  (controller as any).getCustomerOrThrow = async () => currentCustomer;
  (controller as any).assertVehicleAvailability = async () => undefined;
  (controller as any).lockBookingMutation = async () => undefined;
  (controller as any).lockBookingSchedule = async () => undefined;
  (controller as any).logNote = async () => undefined;
  return controller;
};

const createResponse = () => ({
  statusCode: 200,
  body: null as unknown,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(payload: unknown) {
    this.body = payload;
    return this;
  }
});

test("booking update rejects a vehicle outside the tenant before mutation or response", async () => {
  const controller = createController();
  const response = createResponse();
  const request = {
    auth: { tenantId: "tenant-a", userId: "user-a" },
    params: { id: currentBooking.id },
    body: { vehicleId: "vehicle-tenant-b" }
  } as any;

  const originalVehicleFindFirst = prisma.vehicle.findFirst;
  const originalBookingFindFirst = prisma.rentalBooking.findFirst;
  const originalBookingUpdate = prisma.rentalBooking.update;
  const originalTransaction = prisma.$transaction;
  let vehicleLookup: any = null;
  let mutations = 0;

  (prisma.vehicle as any).findFirst = async (input: unknown) => {
    vehicleLookup = input;
    return null;
  };
  (prisma.rentalBooking as any).findFirst = async () => currentBooking;
  (prisma.rentalBooking as any).update = async () => {
    mutations += 1;
    return {
      ...currentBooking,
      vehicleId: "vehicle-tenant-b",
      vehicle: { id: "vehicle-tenant-b", brand: "TENANT_B_SECRET" },
      customer: currentCustomer
    };
  };
  (prisma as any).$transaction = async (callback: (tx: typeof prisma) => unknown) => callback(prisma);

  try {
    await assert.rejects(
      () => controller.update(request, response as any),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 404);
        assert.equal(error.code, "VEHICLE_NOT_FOUND");
        return true;
      }
    );

    assert.deepEqual(vehicleLookup?.where, {
      tenantId: "tenant-a",
      id: "vehicle-tenant-b",
      deletedAt: null,
      isActive: true
    });
    assert.equal(mutations, 0);
    assert.equal(response.body, null);
    assert.equal(JSON.stringify(response.body).includes("TENANT_B_SECRET"), false);
  } finally {
    (prisma.vehicle as any).findFirst = originalVehicleFindFirst;
    (prisma.rentalBooking as any).findFirst = originalBookingFindFirst;
    (prisma.rentalBooking as any).update = originalBookingUpdate;
    (prisma as any).$transaction = originalTransaction;
  }
});

test("booking update accepts an active vehicle owned by the tenant", async () => {
  const controller = createController();
  const response = createResponse();
  const request = {
    auth: { tenantId: "tenant-a", userId: "user-a" },
    params: { id: currentBooking.id },
    body: { vehicleId: "vehicle-tenant-a-2" }
  } as any;

  const originalVehicleFindFirst = prisma.vehicle.findFirst;
  const originalBookingFindFirst = prisma.rentalBooking.findFirst;
  const originalBookingUpdate = prisma.rentalBooking.update;
  const originalTransaction = prisma.$transaction;
  let vehicleLookup: any = null;
  let availabilityCheck: any = null;
  let bookingUpdate: any = null;

  (prisma.vehicle as any).findFirst = async (input: unknown) => {
    vehicleLookup = input;
    return { id: "vehicle-tenant-a-2" };
  };
  (prisma.rentalBooking as any).findFirst = async () => currentBooking;
  (prisma.rentalBooking as any).update = async (input: any) => {
    bookingUpdate = input;
    return {
      ...currentBooking,
      vehicleId: input.data.vehicleId,
      vehicle: { id: input.data.vehicleId },
      customer: currentCustomer
    };
  };
  (controller as any).assertVehicleAvailability = async (input: unknown) => {
    availabilityCheck = input;
  };
  (prisma as any).$transaction = async (callback: (tx: typeof prisma) => unknown) => callback(prisma);

  try {
    await controller.update(request, response as any);

    assert.deepEqual(vehicleLookup?.where, {
      tenantId: "tenant-a",
      id: "vehicle-tenant-a-2",
      deletedAt: null,
      isActive: true
    });
    assert.equal(availabilityCheck.tenantId, "tenant-a");
    assert.equal(availabilityCheck.vehicleId, "vehicle-tenant-a-2");
    assert.equal(availabilityCheck.excludeBookingId, currentBooking.id);
    assert.equal(bookingUpdate.data.vehicleId, "vehicle-tenant-a-2");
    assert.equal((response.body as any).vehicle.id, "vehicle-tenant-a-2");
  } finally {
    (prisma.vehicle as any).findFirst = originalVehicleFindFirst;
    (prisma.rentalBooking as any).findFirst = originalBookingFindFirst;
    (prisma.rentalBooking as any).update = originalBookingUpdate;
    (prisma as any).$transaction = originalTransaction;
  }
});

test("booking update does not block unrelated edits when the assigned vehicle is unchanged", async () => {
  const controller = createController();
  const response = createResponse();
  const request = {
    auth: { tenantId: "tenant-a", userId: "user-a" },
    params: { id: currentBooking.id },
    body: { internalNotes: "Nota aggiornata" }
  } as any;

  const originalVehicleFindFirst = prisma.vehicle.findFirst;
  const originalBookingFindFirst = prisma.rentalBooking.findFirst;
  const originalBookingUpdate = prisma.rentalBooking.update;
  const originalTransaction = prisma.$transaction;
  let vehicleLookups = 0;

  (prisma.vehicle as any).findFirst = async () => {
    vehicleLookups += 1;
    return null;
  };
  (prisma.rentalBooking as any).findFirst = async () => currentBooking;
  (prisma.rentalBooking as any).update = async (input: any) => ({
    ...currentBooking,
    ...input.data,
    vehicle: { id: currentBooking.vehicleId },
    customer: currentCustomer
  });
  (prisma as any).$transaction = async (callback: (tx: typeof prisma) => unknown) => callback(prisma);

  try {
    await controller.update(request, response as any);

    assert.equal(vehicleLookups, 0);
    assert.equal((response.body as any).internalNotes, "Nota aggiornata");
    assert.equal((response.body as any).vehicle.id, currentBooking.vehicleId);
  } finally {
    (prisma.vehicle as any).findFirst = originalVehicleFindFirst;
    (prisma.rentalBooking as any).findFirst = originalBookingFindFirst;
    (prisma.rentalBooking as any).update = originalBookingUpdate;
    (prisma as any).$transaction = originalTransaction;
  }
});
