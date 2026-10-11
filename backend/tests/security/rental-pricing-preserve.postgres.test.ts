import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { RentalBookingsController } from "../../src/interfaces/http/controllers/rental-bookings-controller.js";
import { buildRentalPricingTermsSnapshot } from "../../src/application/services/rental-pricing-service.js";
import { AppError } from "../../src/shared/errors/app-error.js";

const runId = `preserve-pricing-${randomUUID()}`;
const tenants: string[] = [];
let connected = false;
const controller = new RentalBookingsController({ enqueue: async () => assert.fail("No provider/email in pricing test") } as any);

async function fixture(legacy = false, withSnapshot = true) {
  const tenant = await prisma.tenant.create({ data: { name: `${runId}-${tenants.length}` } });
  tenants.push(tenant.id);
  const site = await prisma.site.create({ data: {
    tenantId: tenant.id, name: "Synthetic pricing site", address: "Synthetic address", city: "Synthetic city"
  } });
  const vehicle = await prisma.vehicle.create({ data: {
    tenantId: tenant.id, siteId: site.id, plate: randomUUID().slice(0, 12), brand: "Synthetic", model: "Pricing", year: 2025
  } });
  const list = await prisma.rentalPriceList.create({ data: {
    tenantId: tenant.id, name: "Condizioni storiche", baseRateUnit: "DAILY", baseRateAmount: 100,
    vatRate: 0, discountPercent: 0, hourOverflowRule: "FULL_DAY"
  } });
  const kmPackage = await prisma.rentalPricePackage.create({ data: {
    tenantId: tenant.id, priceListId: list.id, name: "50 km storici", type: "LIMITED", kmIncluded: 50, kmScope: "PER_RENTAL"
  } });
  const policy = await prisma.rentalExtraKmPolicy.create({ data: {
    tenantId: tenant.id, priceListId: list.id, packageId: kmPackage.id, name: "Extra storici", type: "FLAT", flatRatePerKm: 1
  } });
  const metadata = buildRentalPricingTermsSnapshot({ priceList: list, pricePackage: kmPackage, extraKmPolicy: policy });
  const booking = await prisma.rentalBooking.create({ data: {
    tenantId: tenant.id, vehicleId: vehicle.id, code: runId, status: "IN_RENT", customerName: "Synthetic pricing subject",
    pickupAt: new Date("2027-03-10T08:00:00Z"), returnAt: new Date("2027-03-12T08:00:00Z"),
    expectedTotal: 777, finalTotal: 888
  } });
  const snapshot = withSnapshot ? await prisma.rentalBookingPricingSnapshot.create({ data: {
    tenantId: tenant.id, bookingId: booking.id, priceListId: list.id, pricePackageId: kmPackage.id, extraKmPolicyId: policy.id,
    priceListName: list.name, pricePackageName: kmPackage.name, extraKmPolicyName: policy.name,
    baseRateUnit: list.baseRateUnit, baseRateAmount: 100, vatRate: 0, discountPercent: 0, hourOverflowRule: "FULL_DAY",
    estimatedKm: 100, actualKm: 100, includedKmTotal: 50, extraKmEstimated: 50, extraKmActual: 50,
    extraKmEstimatedCost: 50, extraKmActualCost: 50, daysCharged: 2,
    expectedSubtotal: 250, expectedTaxAmount: 0, expectedTotal: 250,
    finalSubtotal: 250, finalTaxAmount: 0, finalTotal: 250, notes: "Nota storica",
    ...(!legacy ? { metadata } : {})
  } }) : null;
  // The operational path must survive ordinary retirement and changes of all
  // mutable references. The saved terms, identities and rates remain unchanged.
  const deletedAt = new Date();
  await prisma.rentalPriceList.update({ where: { id: list.id }, data: {
    name: "Listino modificato", baseRateAmount: 999, vatRate: 22, isActive: false, deletedAt
  } });
  await prisma.rentalPricePackage.update({ where: { id: kmPackage.id }, data: { kmIncluded: 999, isActive: false, deletedAt } });
  await prisma.rentalExtraKmPolicy.update({ where: { id: policy.id }, data: { flatRatePerKm: 77, isActive: false, deletedAt } });
  return { tenant, booking, snapshot, metadata, list, kmPackage, policy };
}

async function patch(data: Awaited<ReturnType<typeof fixture>>, body: Record<string, unknown>, tenantId = data.tenant.id) {
  let response: any;
  await controller.updatePricing({ auth: { tenantId }, params: { id: data.booking.id }, body } as any,
    { json: (value: unknown) => { response = value; } } as any);
  return response;
}

async function exactAmounts(bookingId: string) {
  const [amounts] = await prisma.$queryRaw<Array<Record<string, string | null>>>`
    SELECT b."expectedTotal"::text AS "bookingExpected", b."expectedTotalExact"::text AS "bookingExpectedExact",
      b."finalTotal"::text AS "bookingFinal", b."finalTotalExact"::text AS "bookingFinalExact",
      s."expectedTotal"::text AS "snapshotExpected", s."expectedTotalExact"::text AS "snapshotExpectedExact",
      s."finalTotal"::text AS "snapshotFinal", s."finalTotalExact"::text AS "snapshotFinalExact"
    FROM "RentalBooking" b JOIN "RentalBookingPricingSnapshot" s ON s."bookingId" = b."id"
    WHERE b."id" = ${bookingId}
  `;
  assert.ok(amounts);
  return amounts;
}

describe("preserve agreed pricing on temporary synthetic PostgreSQL", () => {
  before(async () => {
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(process.env.DOTENV_CONFIG_PATH, "/dev/null");
    assert.equal(process.env.RUN_TENANT_ISOLATION_TESTS, "1");
    const database = new URL(process.env.DATABASE_URL!);
    assert.ok(database.hostname === "127.0.0.1" && database.port && database.username === "fleetum");
    assert.equal(database.pathname, "/fleetum_ci");
    await prisma.$connect(); connected = true;
  });
  after(async () => {
    if (connected && tenants.length) {
      const own = { tenantId: { in: tenants } };
      await prisma.rentalBookingNote.deleteMany({ where: own });
      await prisma.rentalBookingPricingSnapshot.deleteMany({ where: own });
      await prisma.rentalBooking.deleteMany({ where: own });
      await prisma.rentalExtraKmPolicy.deleteMany({ where: own });
      await prisma.rentalPricePackage.deleteMany({ where: own });
      await prisma.rentalPriceList.deleteMany({ where: own });
      await prisma.vehicle.deleteMany({ where: own });
      await prisma.site.deleteMany({ where: own });
      await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
    }
    await prisma.$disconnect();
  });

  it("uses saved rates after all pricing references are changed and retired, preserving expected override", async () => {
    const data = await fixture();
    const result = await patch(data, { preserveTerms: true, actualKm: 120 });
    assert.equal(result.quote.pricing.finalTotal, 270);
    assert.equal(result.snapshot.expectedTotal, 250);
    assert.equal(result.snapshot.finalTotal, 270);
    assert.equal(result.snapshot.estimatedKm, 100);
    assert.equal(result.snapshot.actualKm, 120);
    assert.equal(result.snapshot.baseRateAmount, 100);
    assert.equal(result.snapshot.priceListId, data.list.id);
    assert.equal(result.snapshot.pricePackageId, data.kmPackage.id);
    assert.equal(result.snapshot.extraKmPolicyId, data.policy.id);
    assert.deepEqual(result.snapshot.metadata, data.metadata);
    assert.deepEqual(await exactAmounts(data.booking.id), {
      bookingExpected: "777", bookingExpectedExact: "777.00", bookingFinal: "270", bookingFinalExact: "270.00",
      snapshotExpected: "250", snapshotExpectedExact: "250.00", snapshotFinal: "270", snapshotFinalExact: "270.00"
    });
  });

  it("distinguishes omitted fields from null and blank notes without resetting booking overrides", async () => {
    const data = await fixture();
    const beforeAmounts = await exactAmounts(data.booking.id);
    const noteResult = await patch(data, { preserveTerms: true, notes: "" });
    assert.equal(noteResult.snapshot.notes, "");
    assert.equal(noteResult.snapshot.estimatedKm, 100);
    assert.equal(noteResult.snapshot.actualKm, 100);
    assert.deepEqual(await exactAmounts(data.booking.id), beforeAmounts);
    const clearResult = await patch(data, { preserveTerms: true, actualKm: null });
    assert.equal(clearResult.snapshot.actualKm, null);
    assert.equal(clearResult.snapshot.estimatedKm, 100);
    assert.equal(clearResult.snapshot.notes, "");
    const cleared = await exactAmounts(data.booking.id);
    assert.equal(cleared.bookingExpectedExact, "777.00");
    assert.equal(cleared.bookingFinal, null); assert.equal(cleared.bookingFinalExact, null);
    assert.equal(cleared.snapshotFinal, null); assert.equal(cleared.snapshotFinalExact, null);
  });

  it("legacy metadata retains every persisted amount while allowing sparse operational km and notes", async () => {
    const data = await fixture(true);
    const beforeAmounts = await exactAmounts(data.booking.id);
    const result = await patch(data, { preserveTerms: true, actualKm: 120, estimatedKm: null, notes: "Operativa" });
    assert.equal(result.quote, null);
    assert.equal(result.snapshot.actualKm, 120);
    assert.equal(result.snapshot.estimatedKm, null);
    assert.equal(result.snapshot.notes, "Operativa");
    assert.deepEqual(await exactAmounts(data.booking.id), beforeAmounts);
    assert.equal(result.snapshot.metadata, null);
  });

  it("rejects mixed selection and a foreign tenant before altering pricing or producing data", async () => {
    const data = await fixture();
    const foreign = await fixture();
    const beforeSnapshot = await prisma.rentalBookingPricingSnapshot.findUniqueOrThrow({ where: { bookingId: data.booking.id } });
    await assert.rejects(patch(data, { preserveTerms: true, priceListId: foreign.list.id, actualKm: 120 }));
    await assert.rejects(patch(data, { preserveTerms: true, actualKm: 120 }, foreign.tenant.id), (error: unknown) => {
      assert.ok(error instanceof AppError); assert.equal(error.code, "BOOKING_NOT_FOUND"); return true;
    });
    assert.deepEqual(await prisma.rentalBookingPricingSnapshot.findUniqueOrThrow({ where: { bookingId: data.booking.id } }), beforeSnapshot);
    assert.equal(await prisma.rentalBookingNote.count({ where: { bookingId: data.booking.id } }), 0);
  });

  it("does not fabricate a pricing snapshot when historical terms are absent", async () => {
    const data = await fixture(false, false);
    await assert.rejects(patch(data, { preserveTerms: true, actualKm: 120 }), (error: unknown) => {
      assert.ok(error instanceof AppError); assert.equal(error.code, "PRICING_SNAPSHOT_REQUIRED"); return true;
    });
    assert.equal(await prisma.rentalBookingPricingSnapshot.count({ where: { bookingId: data.booking.id } }), 0);
    assert.equal((await prisma.rentalBooking.findUniqueOrThrow({ where: { id: data.booking.id } })).expectedTotal, 777);
  });
});
