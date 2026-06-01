import { describe, expect, it } from "vitest";
import { computeRentalQuote } from "../../../src/application/services/rental-pricing-service.js";

const basePriceList = {
  id: "price_standard",
  name: "Standard",
  baseRateUnit: "DAILY" as const,
  baseRateAmount: 100,
  vatRate: 22,
  discountPercent: 0,
  hourOverflowRule: "FULL_DAY" as const
};

const limitedPackage = {
  id: "km_100_day",
  name: "100 km/giorno",
  type: "LIMITED" as const,
  kmIncluded: 100,
  kmScope: "PER_DAY" as const
};

const flatExtraKmPolicy = {
  id: "extra_flat",
  name: "Extra km flat",
  type: "FLAT" as const,
  flatRatePerKm: 0.5,
  tiers: []
};

describe("computeRentalQuote", () => {
  it("calculates a base rental quote correctly", () => {
    const quote = computeRentalQuote({
      priceList: basePriceList,
      pickupAt: new Date("2026-06-01T09:00:00.000Z"),
      returnAt: new Date("2026-06-03T09:00:00.000Z"),
      estimatedKm: 100
    });

    expect(quote.duration.daysCharged).toBe(2);
    expect(quote.duration.chargedUnits).toBe(2);
    expect(quote.pricing.baseCost).toBe(200);
    expect(quote.pricing.expectedSubtotal).toBe(200);
    expect(quote.pricing.expectedTaxAmount).toBe(44);
    expect(quote.pricing.expectedTotal).toBe(244);
  });

  it("charges fractional days according to HALF_DAY overflow rule", () => {
    const quote = computeRentalQuote({
      priceList: { ...basePriceList, hourOverflowRule: "HALF_DAY" },
      pickupAt: new Date("2026-06-01T09:00:00.000Z"),
      returnAt: new Date("2026-06-02T15:00:00.000Z")
    });

    expect(quote.duration.totalHours).toBe(30);
    expect(quote.duration.daysCharged).toBe(1.5);
    expect(quote.pricing.baseCost).toBe(150);
    expect(quote.pricing.expectedTotal).toBe(183);
  });

  it("calculates extra kilometre supplements", () => {
    const quote = computeRentalQuote({
      priceList: basePriceList,
      pricePackage: limitedPackage,
      extraKmPolicy: flatExtraKmPolicy,
      pickupAt: new Date("2026-06-01T09:00:00.000Z"),
      returnAt: new Date("2026-06-03T09:00:00.000Z"),
      estimatedKm: 260,
      actualKm: 280
    });

    expect(quote.km.includedKmTotal).toBe(200);
    expect(quote.km.extraKmEstimated).toBe(60);
    expect(quote.km.extraKmActual).toBe(80);
    expect(quote.pricing.extraKmEstimatedCost).toBe(30);
    expect(quote.pricing.extraKmActualCost).toBe(40);
    expect(quote.pricing.expectedTotal).toBe(280.6);
    expect(quote.pricing.finalTotal).toBe(292.8);
  });

  it("supports unlimited kilometre packages without extra-km charges", () => {
    const quote = computeRentalQuote({
      priceList: basePriceList,
      pricePackage: {
        id: "km_unlimited",
        name: "Km illimitati",
        type: "UNLIMITED",
        kmIncluded: null,
        kmScope: "PER_RENTAL"
      },
      extraKmPolicy: flatExtraKmPolicy,
      pickupAt: new Date("2026-06-01T09:00:00.000Z"),
      returnAt: new Date("2026-06-02T09:00:00.000Z"),
      estimatedKm: 1000,
      actualKm: 1200
    });

    expect(quote.km.includedKmTotal).toBeNull();
    expect(quote.km.extraKmEstimated).toBe(0);
    expect(quote.km.extraKmActual).toBe(0);
    expect(quote.pricing.extraKmEstimatedCost).toBe(0);
    expect(quote.pricing.extraKmActualCost).toBe(0);
  });

  it("supports tiered extra-km policies", () => {
    const quote = computeRentalQuote({
      priceList: basePriceList,
      pricePackage: { ...limitedPackage, kmScope: "PER_RENTAL", kmIncluded: 100 },
      extraKmPolicy: {
        id: "extra_tiered",
        name: "Extra km tiered",
        type: "TIERED",
        flatRatePerKm: null,
        tiers: [
          { fromKm: 1, toKm: 50, ratePerKm: 0.3, sortOrder: 1 },
          { fromKm: 51, toKm: null, ratePerKm: 0.5, sortOrder: 2 }
        ]
      },
      pickupAt: new Date("2026-06-01T09:00:00.000Z"),
      returnAt: new Date("2026-06-02T09:00:00.000Z"),
      estimatedKm: 180,
      actualKm: 180
    });

    expect(quote.km.extraKmEstimated).toBe(80);
    expect(quote.pricing.extraKmEstimatedCost).toBe(30);
    expect(quote.pricing.extraKmEffectiveRateEstimated).toBe(0.38);
  });

  it("normalizes unordered and open-ended tiers", () => {
    const quote = computeRentalQuote({
      priceList: basePriceList,
      pricePackage: { ...limitedPackage, kmScope: "PER_RENTAL", kmIncluded: 0 },
      extraKmPolicy: {
        id: "extra_unordered",
        name: "Unordered tiers",
        type: "TIERED",
        flatRatePerKm: null,
        tiers: [
          { fromKm: 51, toKm: null, ratePerKm: 0.5 },
          { fromKm: 0, toKm: 10, ratePerKm: 0.2 },
          { fromKm: 11, toKm: 10, ratePerKm: 0.3 }
        ]
      },
      pickupAt: new Date("2026-06-01T09:00:00.000Z"),
      returnAt: new Date("2026-06-02T09:00:00.000Z"),
      estimatedKm: 60
    });

    expect(quote.pricing.extraKmEstimatedCost).toBe(7.3);
    expect(quote.pricing.extraKmEffectiveRateEstimated).toBe(0.12);
  });

  it("keeps extra-km cost at zero when no policy or no tier applies", () => {
    const withoutPolicy = computeRentalQuote({
      priceList: basePriceList,
      pricePackage: { ...limitedPackage, kmScope: "PER_RENTAL", kmIncluded: 10 },
      pickupAt: new Date("2026-06-01T09:00:00.000Z"),
      returnAt: new Date("2026-06-02T09:00:00.000Z"),
      estimatedKm: 100
    });
    const withoutTiers = computeRentalQuote({
      priceList: basePriceList,
      pricePackage: { ...limitedPackage, kmScope: "PER_RENTAL", kmIncluded: 10 },
      extraKmPolicy: {
        id: "extra_empty_tiers",
        name: "No tiers",
        type: "TIERED",
        flatRatePerKm: null,
        tiers: []
      },
      pickupAt: new Date("2026-06-01T09:00:00.000Z"),
      returnAt: new Date("2026-06-02T09:00:00.000Z"),
      estimatedKm: 100
    });
    const tierStartsLater = computeRentalQuote({
      priceList: basePriceList,
      pricePackage: { ...limitedPackage, kmScope: "PER_RENTAL", kmIncluded: 10 },
      extraKmPolicy: {
        id: "extra_late_tier",
        name: "Late tier",
        type: "TIERED",
        flatRatePerKm: null,
        tiers: [{ fromKm: 200, toKm: 300, ratePerKm: 1, sortOrder: 1 }]
      },
      pickupAt: new Date("2026-06-01T09:00:00.000Z"),
      returnAt: new Date("2026-06-02T09:00:00.000Z"),
      estimatedKm: 100
    });

    expect(withoutPolicy.pricing.extraKmEstimatedCost).toBe(0);
    expect(withoutPolicy.pricing.extraKmEffectiveRateEstimated).toBeNull();
    expect(withoutTiers.pricing.extraKmEstimatedCost).toBe(0);
    expect(tierStartsLater.pricing.extraKmEstimatedCost).toBe(0);
  });

  it("clamps invalid monetary inputs and discounts safely", () => {
    const quote = computeRentalQuote({
      priceList: {
        ...basePriceList,
        baseRateAmount: Number.NaN,
        discountPercent: 120,
        vatRate: -10
      },
      pricePackage: { ...limitedPackage, kmIncluded: -10 },
      extraKmPolicy: { ...flatExtraKmPolicy, flatRatePerKm: -1 },
      pickupAt: new Date("2026-06-01T09:00:00.000Z"),
      returnAt: new Date("2026-06-02T09:00:00.000Z"),
      estimatedKm: Number.NaN,
      actualKm: -20
    });

    expect(quote.pricing.baseRateAmount).toBe(0);
    expect(quote.pricing.discountPercent).toBe(100);
    expect(quote.pricing.vatRate).toBe(0);
    expect(quote.km.estimatedKm).toBeNull();
    expect(quote.km.actualKm).toBe(0);
    expect(quote.pricing.expectedTotal).toBe(0);
  });

  it("rounds weekly and monthly charge units", () => {
    const weekly = computeRentalQuote({
      priceList: { ...basePriceList, baseRateUnit: "WEEKLY", baseRateAmount: 500 },
      pickupAt: new Date("2026-06-01T09:00:00.000Z"),
      returnAt: new Date("2026-06-10T09:00:00.000Z")
    });
    const monthly = computeRentalQuote({
      priceList: { ...basePriceList, baseRateUnit: "MONTHLY", baseRateAmount: 1500 },
      pickupAt: new Date("2026-06-01T09:00:00.000Z"),
      returnAt: new Date("2026-07-15T09:00:00.000Z")
    });

    expect(weekly.duration.chargedUnits).toBe(2);
    expect(weekly.pricing.baseCost).toBe(1000);
    expect(monthly.duration.chargedUnits).toBe(2);
    expect(monthly.pricing.baseCost).toBe(3000);
  });

  it("handles equal dates, inverted dates and zero-day inputs without producing zero charged days", () => {
    const equalDates = computeRentalQuote({
      priceList: basePriceList,
      pickupAt: new Date("2026-06-01T09:00:00.000Z"),
      returnAt: new Date("2026-06-01T09:00:00.000Z")
    });
    const invertedDates = computeRentalQuote({
      priceList: basePriceList,
      pickupAt: new Date("2026-06-03T09:00:00.000Z"),
      returnAt: new Date("2026-06-01T09:00:00.000Z")
    });

    expect(equalDates.duration.totalHours).toBe(0);
    expect(equalDates.duration.daysCharged).toBe(1);
    expect(equalDates.pricing.expectedTotal).toBe(122);
    expect(invertedDates.duration.totalHours).toBe(0);
    expect(invertedDates.duration.daysCharged).toBe(1);
    expect(invertedDates.pricing.expectedTotal).toBe(122);
  });
});
