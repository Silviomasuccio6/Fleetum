import assert from "node:assert/strict";
import test from "node:test";
import { RentalBookingsController } from "../src/interfaces/http/controllers/rental-bookings-controller.js";
import { rentalBookingPricingUpdateSchema } from "../src/interfaces/http/validators/rental-bookings-validators.js";
import { buildRentalPricingTermsSnapshot, computeRentalQuote } from "../src/application/services/rental-pricing-service.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { AppError } from "../src/shared/errors/app-error.js";

const terms = {
  priceList: { id: "historic-list", name: "Listino concordato", baseRateUnit: "DAILY" as const,
    baseRateAmount: 100, vatRate: 0, discountPercent: 0, hourOverflowRule: "FULL_DAY" as const },
  pricePackage: { id: "historic-package", name: "50 km", type: "LIMITED" as const,
    kmIncluded: 50, kmScope: "PER_RENTAL" as const },
  extraKmPolicy: { id: "historic-policy", name: "Scaglioni concordati", type: "TIERED" as const,
    flatRatePerKm: null, tiers: [
      { fromKm: 1, toKm: 50, ratePerKm: 1, sortOrder: 0 },
      { fromKm: 51, toKm: null, ratePerKm: 2, sortOrder: 1 }
    ] }
};
const booking = { id: "booking-a", tenantId: "tenant-a", code: "QUOTE-A", vehicleId: "vehicle-a",
  pickupAt: new Date("2027-03-10T08:00:00Z"), returnAt: new Date("2027-03-12T08:00:00Z"),
  updatedAt: new Date("2026-10-08T08:00:00Z"), expectedTotal: 777, finalTotal: 888 };
const originalQuote = computeRentalQuote({ ...terms, ...booking, estimatedKm: 100, actualKm: 100 });
const originalSnapshot = { id: "snapshot-a", tenantId: "tenant-a", bookingId: booking.id,
  priceListId: terms.priceList.id, pricePackageId: terms.pricePackage.id, extraKmPolicyId: terms.extraKmPolicy.id,
  priceListName: terms.priceList.name, pricePackageName: terms.pricePackage.name, extraKmPolicyName: terms.extraKmPolicy.name,
  baseRateUnit: terms.priceList.baseRateUnit, baseRateAmount: 100, vatRate: 0, discountPercent: 0,
  hourOverflowRule: terms.priceList.hourOverflowRule,
  metadata: buildRentalPricingTermsSnapshot(terms), estimatedKm: 100, actualKm: 100,
  includedKmTotal: 50, extraKmEstimated: 50, extraKmActual: 50, extraKmEstimatedCost: 50,
  extraKmActualCost: 50, daysCharged: 2, expectedSubtotal: 250, expectedTaxAmount: 0,
  expectedTotal: 250, finalSubtotal: 250, finalTaxAmount: 0, finalTotal: 250, notes: "Nota concordata" };

// These doubles expose real controller branches while preventing all database/provider access.
const exercise = async (body: Record<string, unknown>, options: {
  snapshot?: Record<string, unknown> | null; lockedBooking?: typeof booking | null; explicitReprice?: boolean
} = {}) => {
  let snapshot: any = Object.hasOwn(options, "snapshot") ? options.snapshot : structuredClone(originalSnapshot);
  const controller = new RentalBookingsController({ enqueue: async () => assert.fail("No email") } as any);
  const events: string[] = [];
  let selectionCalls = 0;
  const snapshotWrites: any[] = [];
  const bookingWrites: any[] = [];
  const tx = {
    $queryRaw: async () => { events.push("row-lock"); return [{ id: "tenant-a", deletedAt: null }]; },
    vehicle: { findFirst: async () => ({ id: "vehicle-a", tenantId: "tenant-a", siteId: "site-a", deletedAt: null }) },
    rentalBooking: {
      findFirst: async ({ where }: any) => {
        assert.equal(where.tenantId, "tenant-a"); assert.equal(where.id, booking.id);
        events.push("booking-reread");
        return Object.hasOwn(options, "lockedBooking") ? options.lockedBooking : booking;
      },
      update: async ({ data }: any) => { bookingWrites.push(data); return { ...booking, ...data }; }
    },
    rentalBookingPricingSnapshot: {
      findFirst: async ({ where }: any) => {
        assert.equal(where.tenantId, "tenant-a"); assert.equal(where.bookingId, booking.id);
        assert.ok(events.includes("booking-reread")); events.push("snapshot-reread"); return snapshot;
      },
      update: async ({ where, data }: any) => {
        assert.equal(where.id, snapshot.id); snapshotWrites.push(data); snapshot = { ...snapshot, ...data }; return snapshot;
      },
      create: async ({ data }: any) => { snapshotWrites.push(data); snapshot = { id: "new-snapshot", ...data }; return snapshot; }
    },
    rentalBookingNote: { create: async () => ({ id: "note-a" }) }
  };
  (controller as any).getBookingOrThrow = async () => booking;
  (controller as any).lockBookingMutation = async () => { events.push("booking-fence"); };
  (controller as any).lockBookingSchedule = async () => { events.push("schedule-fence"); };
  (controller as any).hydratePricingSnapshot = async (_tenantId: string, value: unknown) => value;
  (controller as any).resolvePricingSelection = async () => {
    selectionCalls += 1;
    if (!options.explicitReprice) assert.fail("Operational editing must never reload mutable pricing");
    return { list: terms.priceList, selectedPackage: terms.pricePackage, selectedPolicy: terms.extraKmPolicy };
  };
  const originalTransaction = prisma.$transaction;
  const originalBookingFindFirst = prisma.rentalBooking.findFirst;
  (prisma.rentalBooking as any).findFirst = async ({ where, include }: any) => {
    assert.equal(where.tenantId, "tenant-a"); assert.equal(where.id, booking.id);
    assert.equal(include, undefined, "Operational lookup must not hydrate live pricing relations");
    return booking;
  };
  (prisma as any).$transaction = async (callback: any) => callback(tx);
  let response: any;
  let error: unknown;
  try {
    await controller.updatePricing({ auth: { tenantId: "tenant-a", userId: "user-a" },
      params: { id: booking.id }, body } as any, { json: (value: unknown) => { response = value; } } as any);
  } catch (caught) { error = caught; }
  finally {
    (prisma as any).$transaction = originalTransaction;
    (prisma.rentalBooking as any).findFirst = originalBookingFindFirst;
  }
  return { response, error, snapshotWrites, bookingWrites, selectionCalls, events };
};

test("preserve terms accepts sparse km/note edits and rejects every live pricing selection", () => {
  assert.deepEqual(rentalBookingPricingUpdateSchema.parse({ preserveTerms: true, actualKm: null, notes: "" }),
    { preserveTerms: true, actualKm: null, notes: "" });
  for (const field of ["priceListId", "pricePackageId", "extraKmPolicyId"]) {
    assert.equal(rentalBookingPricingUpdateSchema.safeParse({ preserveTerms: true, [field]: "live-id" }).success, false);
    assert.equal(rentalBookingPricingUpdateSchema.safeParse({ preserveTerms: true, [field]: "" }).success, false);
    assert.equal(rentalBookingPricingUpdateSchema.safeParse({ preserveTerms: true, [field]: null }).success, false);
  }
  assert.equal(rentalBookingPricingUpdateSchema.safeParse({ preserveTerms: true, metadata: {} }).success, false);
  assert.equal(rentalBookingPricingUpdateSchema.safeParse({ preserveTerms: true, actualKm: "Infinity" }).success, false);
  assert.equal(rentalBookingPricingUpdateSchema.safeParse({ preserveTerms: true, estimatedKm: -1 }).success, false);
  assert.equal(rentalBookingPricingUpdateSchema.safeParse({ actualKm: 10 }).success, false);
});

test("operational actual km uses frozen tier rates and preserves agreed identities/expected override", async () => {
  const result = await exercise({ preserveTerms: true, actualKm: 120 });
  assert.equal(result.error, undefined);
  assert.equal(result.selectionCalls, 0);
  assert.equal(result.response.quote.pricing.finalTotal, 290);
  assert.equal(result.response.snapshot.actualKm, 120);
  assert.equal(result.response.snapshot.estimatedKm, 100);
  assert.deepEqual(result.response.snapshot.metadata, originalSnapshot.metadata);
  for (const key of ["priceListId", "pricePackageId", "extraKmPolicyId", "baseRateAmount", "vatRate", "notes"]) {
    assert.equal(result.response.snapshot[key], (originalSnapshot as any)[key]);
    assert.equal(Object.hasOwn(result.snapshotWrites[0], key), false, `${key} must remain frozen/omitted`);
  }
  assert.deepEqual(result.bookingWrites, [{ finalTotal: 290 }]);
});

test("estimated km patch preserves actual km and booking totals while recalculating its snapshot quote", async () => {
  const result = await exercise({ preserveTerms: true, estimatedKm: 120 });
  assert.equal(result.error, undefined);
  assert.equal(result.response.snapshot.estimatedKm, 120);
  assert.equal(result.response.snapshot.actualKm, 100);
  assert.equal(result.response.snapshot.expectedTotal, 290);
  assert.deepEqual(result.bookingWrites, []);
});

test("note-only operational edit preserves all existing quote amounts and explicitly clears blank notes", async () => {
  const snapshot = { ...originalSnapshot, expectedTotal: 654, finalTotal: 987 };
  const result = await exercise({ preserveTerms: true, notes: "" }, { snapshot });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.snapshotWrites, [{ notes: "" }]);
  assert.deepEqual(result.bookingWrites, []);
  assert.equal(result.response.snapshot.expectedTotal, 654);
  assert.equal(result.response.snapshot.finalTotal, 987);
});

test("explicit null actual km clears actual quote and final booking total without losing the estimate", async () => {
  const result = await exercise({ preserveTerms: true, actualKm: null });
  assert.equal(result.error, undefined);
  assert.equal(result.response.snapshot.actualKm, null);
  assert.equal(result.response.snapshot.estimatedKm, 100);
  assert.equal(result.response.snapshot.extraKmActualCost, 0);
  assert.equal(result.response.snapshot.finalTotal, null);
  assert.deepEqual(result.bookingWrites, [{ finalTotal: null }]);
});

test("explicit null estimated km is distinct from omission", async () => {
  const result = await exercise({ preserveTerms: true, estimatedKm: null });
  assert.equal(result.error, undefined);
  assert.equal(result.response.snapshot.estimatedKm, null);
  assert.equal(result.response.snapshot.actualKm, 100);
  assert.equal(result.response.snapshot.expectedTotal, 200);
  assert.deepEqual(result.bookingWrites, []);
});

test("legacy snapshot permits operational km/note edit without deriving or inventing any amount", async () => {
  const snapshot = { ...originalSnapshot, metadata: null, expectedTotal: 654, finalTotal: 987 };
  const result = await exercise({ preserveTerms: true, actualKm: 120, notes: "Operativa" }, { snapshot });
  assert.equal(result.error, undefined);
  assert.equal(result.response.quote, null);
  assert.deepEqual(result.snapshotWrites, [{ actualKm: 120, notes: "Operativa" }]);
  assert.deepEqual(result.bookingWrites, []);
  assert.equal(result.response.snapshot.expectedTotal, 654);
  assert.equal(result.response.snapshot.finalTotal, 987);
});

test("malformed pricing metadata follows the legacy amount-preserving path", async () => {
  const result = await exercise({ preserveTerms: true, estimatedKm: null }, {
    snapshot: { ...originalSnapshot, metadata: { version: 2 }, expectedTotal: 654 }
  });
  assert.equal(result.error, undefined);
  assert.equal(result.response.quote, null);
  assert.deepEqual(result.snapshotWrites, [{ estimatedKm: null }]);
  assert.equal(result.response.snapshot.expectedTotal, 654);
});

test("missing historical snapshot is rejected without consulting a live list or mutating booking", async () => {
  const result = await exercise({ preserveTerms: true, actualKm: 120 }, { snapshot: null });
  assert.ok(result.error instanceof AppError);
  assert.equal(result.error.statusCode, 409);
  assert.equal(result.error.code, "PRICING_SNAPSHOT_REQUIRED");
  assert.deepEqual(result.snapshotWrites, []);
  assert.deepEqual(result.bookingWrites, []);
  assert.equal(result.selectionCalls, 0);
});

test("operational pricing fences a booking changed since the original owned lookup", async () => {
  const result = await exercise({ preserveTerms: true, actualKm: 120 }, {
    lockedBooking: { ...booking, updatedAt: new Date(booking.updatedAt.getTime() + 1000) }
  });
  assert.ok(result.error instanceof AppError);
  assert.equal(result.error.code, "BOOKING_CHANGED");
  assert.deepEqual(result.snapshotWrites, []);
  assert.equal(result.events.includes("snapshot-reread"), false);
});

test("operational pricing rejects a missing owned booking under its lock before touching snapshot", async () => {
  const result = await exercise({ preserveTerms: true, actualKm: 120 }, { lockedBooking: null });
  assert.ok(result.error instanceof AppError);
  assert.equal(result.error.code, "BOOKING_NOT_FOUND");
  assert.deepEqual(result.snapshotWrites, []);
  assert.deepEqual(result.bookingWrites, []);
});

test("explicit repricing stays available without preserveTerms or with preserveTerms false", async () => {
  for (const body of [{ priceListId: terms.priceList.id, actualKm: 120 },
    { preserveTerms: false, priceListId: terms.priceList.id, actualKm: 120 }]) {
    const result = await exercise(body, { explicitReprice: true });
    assert.equal(result.error, undefined);
    assert.equal(result.selectionCalls, 1);
    assert.deepEqual(result.bookingWrites, [{ expectedTotal: 200, finalTotal: 290 }]);
    assert.equal(result.response.quote.pricing.finalTotal, 290);
  }
  assert.equal(originalQuote.pricing.expectedTotal, 250);
});
