import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { signTenantAccessToken } from "../helpers/http-auth.js";

const runId = `booking-integrity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl = "";
let tenantId = "";
let userId = "";
let siteId = "";
let customerId = "";
let token = "";

const jsonRequest = async (pathName: string, options: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
};

const cleanup = async () => {
  if (!tenantId) return;
  await prisma.bookingContractDelivery.deleteMany({ where: { tenantId } });
  await prisma.bookingContractEvent.deleteMany({ where: { tenantId } });
  await prisma.bookingContract.deleteMany({ where: { tenantId } });
  await prisma.contractTemplate.deleteMany({ where: { tenantId } });
  await prisma.rentalBookingNote.deleteMany({ where: { tenantId } });
  await prisma.rentalBookingCreateRequest.deleteMany({ where: { tenantId } });
  await prisma.rentalBookingPricingSnapshot.deleteMany({ where: { tenantId } });
  await prisma.rentalExtraKmTier.deleteMany({ where: { tenantId } });
  await prisma.rentalExtraKmPolicy.deleteMany({ where: { tenantId } });
  await prisma.rentalPricePackage.deleteMany({ where: { tenantId } });
  await prisma.rentalPriceList.deleteMany({ where: { tenantId } });
  await prisma.rentalBooking.deleteMany({ where: { tenantId } });
  await prisma.rentalCustomer.deleteMany({ where: { tenantId } });
  await prisma.refreshSession.deleteMany({ where: { tenantId } });
  await prisma.tenantSubscription.deleteMany({ where: { tenantId } });
  await prisma.userRole.deleteMany({ where: { user: { tenantId } } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.vehicle.deleteMany({ where: { tenantId } });
  await prisma.site.deleteMany({ where: { tenantId } });
  await prisma.tenantBranding.deleteMany({ where: { tenantId } });
  await prisma.tenantLegalSettings.deleteMany({ where: { tenantId } });
  await prisma.tenantProfile.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
};

const createVehicle = async (suffix: string, currentKm = 1000) =>
  prisma.vehicle.create({
    data: {
      tenantId,
      siteId,
      plate: `BI${suffix}${runId.slice(-5)}`.replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase(),
      brand: "Concurrency",
      model: suffix,
      year: 2025,
      currentKm,
      isActive: true
    }
  });

const createPricingFixture = async (suffix: string) => {
  const vehicle = await createVehicle(`PRICE${suffix}`, 1000);
  const pickupAt = new Date(`2027-0${suffix === "A" ? "3" : "4"}-10T08:00:00.000Z`);
  const returnAt = new Date(pickupAt.getTime() + 2 * 24 * 60 * 60 * 1000);
  const booking = await prisma.rentalBooking.create({
    data: {
      tenantId,
      vehicleId: vehicle.id,
      customerId,
      createdByUserId: userId,
      code: `PRICE-${suffix}-${runId}`,
      status: "IN_RENT",
      customerName: `Pricing ${suffix}`,
      pickupAt,
      returnAt,
      pickupKm: 1000,
      returnKm: 1120
    }
  });
  const priceList = await prisma.rentalPriceList.create({
    data: {
      tenantId,
      name: `Listino ${suffix}`,
      baseRateUnit: "DAILY",
      baseRateAmount: 100,
      vatRate: 0,
      discountPercent: 0,
      hourOverflowRule: "FULL_DAY"
    }
  });
  const pricePackage = await prisma.rentalPricePackage.create({
    data: {
      tenantId,
      priceListId: priceList.id,
      name: `Pacchetto ${suffix}`,
      type: "LIMITED",
      kmIncluded: 50,
      kmScope: "PER_RENTAL",
      isDefault: true
    }
  });
  const extraKmPolicy = await prisma.rentalExtraKmPolicy.create({
    data: {
      tenantId,
      priceListId: priceList.id,
      packageId: pricePackage.id,
      name: `Extra ${suffix}`,
      type: "TIERED",
      isDefault: true,
      tiers: {
        create: [
          { tenantId, fromKm: 1, toKm: 50, ratePerKm: 1, sortOrder: 0 },
          { tenantId, fromKm: 51, toKm: null, ratePerKm: 2, sortOrder: 1 }
        ]
      }
    },
    include: { tiers: true }
  });

  const pricing = await jsonRequest(`/rental-bookings/${booking.id}/pricing`, {
    method: "PATCH",
    body: JSON.stringify({
      priceListId: priceList.id,
      pricePackageId: pricePackage.id,
      extraKmPolicyId: extraKmPolicy.id,
      estimatedKm: 100
    })
  });
  assert.equal(pricing.response.status, 200, JSON.stringify(pricing.body));

  return { vehicle, booking, priceList, pricePackage, extraKmPolicy };
};

describe("rental booking concurrency and immutable pricing", () => {
  before(async () => {
    await prisma.$connect();

    const tenant = await prisma.tenant.create({
      data: { name: `Booking Integrity ${runId}`, vatNumber: `IT${Date.now().toString().slice(-11)}` }
    });
    tenantId = tenant.id;

    const user = await prisma.user.create({
      data: {
        tenantId,
        email: `${runId}@example.test`,
        passwordHash: "synthetic-test-only",
        firstName: "Booking",
        lastName: "Integrity",
        isEmailVerified: true
      }
    });
    userId = user.id;

    const role = await prisma.role.upsert({
      where: { key: "ADMIN" },
      update: { name: "ADMIN" },
      create: { key: "ADMIN", name: "ADMIN" }
    });
    await prisma.userRole.create({ data: { userId, roleId: role.id } });
    await prisma.tenantSubscription.create({
      data: {
        tenantId,
        provider: "test",
        plan: "ENTERPRISE",
        billingCycle: "monthly",
        status: "ACTIVE",
        seats: 10,
        priceMonthly: 0
      }
    });

    const site = await prisma.site.create({
      data: { tenantId, name: `Site ${runId}`, address: "Via Test 1", city: "Roma" }
    });
    siteId = site.id;
    const customer = await prisma.rentalCustomer.create({
      data: {
        tenantId,
        firstName: "Cliente",
        lastName: "Concorrenza",
        drivingLicenseNumber: `DL-${runId}`
      }
    });
    customerId = customer.id;
    const session = await prisma.refreshSession.create({
      data: {
        tenantId,
        userId,
        tokenHash: `booking-integrity-${runId}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      }
    });
    token = signTenantAccessToken({ tenantId, userId, sessionId: session.id });

    server = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  after(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await cleanup();
    await prisma.$disconnect();
  });

  it("allows only one of concurrent creates for the same vehicle and interval", async () => {
    const vehicle = await createVehicle("CREATE");
    const pickupAt = new Date("2027-01-10T08:00:00.000Z");
    const returnAt = new Date("2027-01-12T08:00:00.000Z");
    const payload = {
      vehicleId: vehicle.id,
      customerId,
      pickupAt: pickupAt.toISOString(),
      returnAt: returnAt.toISOString(),
      generateContract: false
    };

    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        jsonRequest("/rental-bookings", {
          method: "POST",
          headers: { "x-idempotency-key": `${runId}-overlap-${index}` },
          body: JSON.stringify(payload)
        })
      )
    );
    const successes = attempts.filter(({ response }) => response.status === 201);
    const conflicts = attempts.filter(({ response }) => response.status === 409);
    assert.equal(successes.length, 1, attempts.map(({ response, body }) => [response.status, body]));
    assert.equal(conflicts.length, 7, attempts.map(({ response, body }) => [response.status, body]));

    const persisted = await prisma.rentalBooking.count({
      where: {
        tenantId,
        vehicleId: vehicle.id,
        deletedAt: null,
        status: { in: ["DRAFT", "QUOTED", "HOLD", "CONFIRMED", "CONTRACT_SIGNED", "READY_FOR_HANDOVER", "IN_RENT"] },
        pickupAt: { lt: returnAt },
        returnAt: { gt: pickupAt }
      }
    });
    assert.equal(persisted, 1);

    const adjacent = await jsonRequest("/rental-bookings", {
      method: "POST",
      headers: { "x-idempotency-key": `${runId}-adjacent` },
      body: JSON.stringify({
        ...payload,
        pickupAt: returnAt.toISOString(),
        returnAt: new Date(returnAt.getTime() + 24 * 60 * 60 * 1000).toISOString()
      })
    });
    assert.equal(adjacent.response.status, 201, JSON.stringify(adjacent.body));
  });

  it("returns the same booking for concurrent retries with one idempotency key", async () => {
    const vehicle = await createVehicle("IDEMPOTENT");
    const payload = {
      vehicleId: vehicle.id,
      customerId,
      pickupAt: "2027-01-20T08:00:00.000Z",
      returnAt: "2027-01-22T08:00:00.000Z",
      generateContract: false
    };
    const idempotencyKey = `${runId}-same-create`;

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        jsonRequest("/rental-bookings", {
          method: "POST",
          headers: { "x-idempotency-key": idempotencyKey },
          body: JSON.stringify(payload)
        })
      )
    );

    assert.equal(
      attempts.filter(({ response }) => response.status === 201).length,
      attempts.length,
      attempts.map(({ response, body }) => [response.status, body])
    );
    const bookingIds = new Set(attempts.map(({ body }) => String((body as { id: string }).id)));
    assert.equal(bookingIds.size, 1);
    const bookingId = [...bookingIds][0];
    assert.equal(await prisma.rentalBooking.count({ where: { tenantId, id: bookingId } }), 1);
    assert.equal(await prisma.rentalBookingNote.count({ where: { tenantId, bookingId } }), 1);
    assert.equal(await prisma.rentalBookingCreateRequest.count({ where: { tenantId, bookingId } }), 1);
    assert.ok(attempts.some(({ response }) => response.headers.get("idempotency-replayed") === "true"));

    const changedPayload = await jsonRequest("/rental-bookings", {
      method: "POST",
      headers: { "x-idempotency-key": idempotencyKey },
      body: JSON.stringify({ ...payload, returnAt: "2027-01-23T08:00:00.000Z" })
    });
    assert.equal(changedPayload.response.status, 409, JSON.stringify(changedPayload.body));
    assert.equal((changedPayload.body as { error: string }).error, "IDEMPOTENCY_KEY_REUSED");
  });

  it("requires an idempotency key for booking creation", async () => {
    const vehicle = await createVehicle("KEYREQUIRED");
    const result = await jsonRequest("/rental-bookings", {
      method: "POST",
      body: JSON.stringify({
        vehicleId: vehicle.id,
        customerId,
        pickupAt: "2027-01-25T08:00:00.000Z",
        returnAt: "2027-01-26T08:00:00.000Z",
        generateContract: false
      })
    });
    assert.equal(result.response.status, 400, JSON.stringify(result.body));
    assert.equal((result.body as { error: string }).error, "IDEMPOTENCY_KEY_REQUIRED");
  });

  it("rolls back booking, note, and idempotency record when contract persistence fails", async () => {
    const vehicle = await createVehicle("CONTRACTFAIL");
    await prisma.contractTemplate.deleteMany({ where: { tenantId } });

    const triggerName = "test_booking_contract_failure";
    const functionName = "test_raise_booking_contract_failure";
    const safeTenantId = tenantId.replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'synthetic contract persistence failure';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "BookingContract"
      FOR EACH ROW
      WHEN (NEW."tenantId" = '${safeTenantId}')
      EXECUTE FUNCTION "${functionName}"();
    `);

    const idempotencyKey = `${runId}-contract-fault`;
    const requestPayload = {
      vehicleId: vehicle.id,
      customerId,
      pickupAt: "2027-01-27T08:00:00.000Z",
      returnAt: "2027-01-28T08:00:00.000Z",
      generateContract: true
    };
    let result: Awaited<ReturnType<typeof jsonRequest>> | undefined;
    try {
      result = await jsonRequest("/rental-bookings", {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey },
        body: JSON.stringify(requestPayload)
      });
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "BookingContract"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }

    assert.equal(result?.response.status, 500, JSON.stringify(result?.body));
    assert.equal(await prisma.rentalBooking.count({ where: { tenantId, vehicleId: vehicle.id } }), 0);
    assert.equal(await prisma.rentalBookingCreateRequest.count({ where: { tenantId, idempotencyKey } }), 0);
    assert.equal(await prisma.rentalBookingNote.count({ where: { tenantId, booking: { vehicleId: vehicle.id } } }), 0);
    assert.equal(await prisma.contractTemplate.count({ where: { tenantId } }), 0);
    assert.equal(await prisma.tenantBranding.count({ where: { tenantId } }), 0);
    assert.equal(await prisma.tenantLegalSettings.count({ where: { tenantId } }), 0);

    const retry = await jsonRequest("/rental-bookings", {
      method: "POST",
      headers: { "x-idempotency-key": idempotencyKey },
      body: JSON.stringify(requestPayload)
    });
    assert.equal(retry.response.status, 201, JSON.stringify(retry.body));
    assert.equal((retry.body as { contractStatus: string }).contractStatus, "READY");
    const retryBookingId = String((retry.body as { id: string }).id);
    assert.equal(await prisma.rentalBooking.count({ where: { tenantId, id: retryBookingId } }), 1);
    assert.equal(await prisma.rentalBookingNote.count({ where: { tenantId, bookingId: retryBookingId } }), 1);
    assert.equal(await prisma.bookingContract.count({ where: { tenantId, bookingId: retryBookingId } }), 1);
    assert.equal(await prisma.contractTemplate.count({ where: { tenantId, isDefault: true, deletedAt: null } }), 1);
  });

  it("allows only one concurrent update into the same vehicle interval", async () => {
    const targetVehicle = await createVehicle("TARGET");
    const pickupAt = new Date("2027-02-10T08:00:00.000Z");
    const returnAt = new Date("2027-02-12T08:00:00.000Z");
    const candidates = await Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const sourceVehicle = await createVehicle(`SOURCE${index}`);
        return prisma.rentalBooking.create({
          data: {
            tenantId,
            vehicleId: sourceVehicle.id,
            customerId,
            createdByUserId: userId,
            code: `UPDATE-${index}-${runId}`,
            status: "DRAFT",
            customerName: "Cliente Concorrenza",
            pickupAt: new Date(`2027-02-${String(20 + index).padStart(2, "0")}T08:00:00.000Z`),
            returnAt: new Date(`2027-02-${String(21 + index).padStart(2, "0")}T08:00:00.000Z`)
          }
        });
      })
    );

    const attempts = await Promise.all(
      candidates.map((booking) =>
        jsonRequest(`/rental-bookings/${booking.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            vehicleId: targetVehicle.id,
            pickupAt: pickupAt.toISOString(),
            returnAt: returnAt.toISOString()
          })
        })
      )
    );
    const successes = attempts.filter(({ response }) => response.status === 200);
    const conflicts = attempts.filter(({ response }) => response.status === 409);
    assert.equal(successes.length, 1, attempts.map(({ response, body }) => [response.status, body]));
    assert.equal(conflicts.length, 5, attempts.map(({ response, body }) => [response.status, body]));

    const persisted = await prisma.rentalBooking.count({
      where: {
        tenantId,
        vehicleId: targetVehicle.id,
        deletedAt: null,
        pickupAt: { lt: returnAt },
        returnAt: { gt: pickupAt }
      }
    });
    assert.equal(persisted, 1);
  });

  it("closes with the snapshotted terms after the live price list is changed", async () => {
    const fixture = await createPricingFixture("A");

    await prisma.rentalPriceList.update({
      where: { id: fixture.priceList.id },
      data: { baseRateAmount: 999, vatRate: 22, discountPercent: 50 }
    });
    await prisma.rentalPricePackage.update({
      where: { id: fixture.pricePackage.id },
      data: { kmIncluded: 999, type: "LIMITED" }
    });
    await prisma.rentalExtraKmPolicy.update({
      where: { id: fixture.extraKmPolicy.id },
      data: { type: "FLAT", flatRatePerKm: 99 }
    });
    await prisma.rentalExtraKmTier.updateMany({
      where: { policyId: fixture.extraKmPolicy.id },
      data: { ratePerKm: 77 }
    });

    const closed = await jsonRequest(`/rental-bookings/${fixture.booking.id}/transition`, {
      method: "POST",
      body: JSON.stringify({ toStatus: "CLOSED" })
    });
    assert.equal(closed.response.status, 200, JSON.stringify(closed.body));

    const persisted = await prisma.rentalBooking.findUnique({
      where: { id: fixture.booking.id },
      include: { pricingSnapshot: true }
    });
    assert.equal(persisted?.status, "CLOSED");
    assert.equal(persisted?.finalTotal, 290);
    assert.equal(persisted?.pricingSnapshot?.extraKmActual, 70);
    assert.equal(persisted?.pricingSnapshot?.extraKmActualCost, 90);
    assert.equal(persisted?.pricingSnapshot?.finalTotal, 290);
  });

  it("closes with the snapshotted terms after the live price list is deleted", async () => {
    const fixture = await createPricingFixture("B");
    const deletedAt = new Date();
    await prisma.rentalExtraKmPolicy.update({
      where: { id: fixture.extraKmPolicy.id },
      data: { deletedAt, isActive: false }
    });
    await prisma.rentalPricePackage.update({
      where: { id: fixture.pricePackage.id },
      data: { deletedAt, isActive: false }
    });
    await prisma.rentalPriceList.update({
      where: { id: fixture.priceList.id },
      data: { deletedAt, isActive: false }
    });

    const closed = await jsonRequest(`/rental-bookings/${fixture.booking.id}/transition`, {
      method: "POST",
      body: JSON.stringify({ toStatus: "CLOSED" })
    });
    assert.equal(closed.response.status, 200, JSON.stringify(closed.body));

    const persisted = await prisma.rentalBooking.findUnique({
      where: { id: fixture.booking.id },
      include: { pricingSnapshot: true }
    });
    assert.equal(persisted?.status, "CLOSED");
    assert.equal(persisted?.finalTotal, 290);
    assert.equal(persisted?.pricingSnapshot?.extraKmActualCost, 90);
    assert.equal(persisted?.pricingSnapshot?.finalTotal, 290);
  });

  it("closes a legacy snapshot without reloading mutable pricing rows", async () => {
    const fixture = await createPricingFixture("C");
    await prisma.rentalBookingPricingSnapshot.update({
      where: { bookingId: fixture.booking.id },
      data: { metadata: null }
    });
    await prisma.rentalPriceList.update({
      where: { id: fixture.priceList.id },
      data: { baseRateAmount: 999, deletedAt: new Date(), isActive: false }
    });

    const closed = await jsonRequest(`/rental-bookings/${fixture.booking.id}/transition`, {
      method: "POST",
      body: JSON.stringify({ toStatus: "CLOSED" })
    });
    assert.equal(closed.response.status, 200, JSON.stringify(closed.body));

    const persisted = await prisma.rentalBooking.findUnique({
      where: { id: fixture.booking.id },
      include: { pricingSnapshot: true }
    });
    assert.equal(persisted?.status, "CLOSED");
    assert.equal(persisted?.finalTotal, 250);
    assert.equal(persisted?.pricingSnapshot?.actualKm, 120);
    assert.equal(persisted?.pricingSnapshot?.finalTotal, 250);
  });
});
