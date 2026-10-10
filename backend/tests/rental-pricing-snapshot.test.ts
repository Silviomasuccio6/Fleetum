import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRentalPricingTermsSnapshot,
  computeRentalQuote,
  restoreRentalPricingTermsSnapshot
} from "../src/application/services/rental-pricing-service.js";

const terms = {
  priceList: {
    id: "list-1",
    name: "Listino concordato",
    baseRateUnit: "DAILY" as const,
    baseRateAmount: 100,
    vatRate: 0,
    discountPercent: 0,
    hourOverflowRule: "FULL_DAY" as const
  },
  pricePackage: {
    id: "package-1",
    name: "50 km",
    type: "LIMITED" as const,
    kmIncluded: 50,
    kmScope: "PER_RENTAL" as const
  },
  extraKmPolicy: {
    id: "policy-1",
    name: "Scaglioni",
    type: "TIERED" as const,
    flatRatePerKm: null,
    tiers: [
      { fromKm: 1, toKm: 50, ratePerKm: 1, sortOrder: 0 },
      { fromKm: 51, toKm: null, ratePerKm: 2, sortOrder: 1 }
    ]
  }
};

test("pricing terms snapshot preserves all calculation inputs independently of live objects", () => {
  const metadata = buildRentalPricingTermsSnapshot(terms);
  terms.priceList.baseRateAmount = 999;
  terms.pricePackage.kmIncluded = 999;
  terms.extraKmPolicy.tiers[0]!.ratePerKm = 77;

  const restored = restoreRentalPricingTermsSnapshot(metadata);
  assert.ok(restored);
  const quote = computeRentalQuote({
    ...restored,
    pickupAt: new Date("2027-03-10T08:00:00.000Z"),
    returnAt: new Date("2027-03-12T08:00:00.000Z"),
    actualKm: 120
  });

  assert.equal(quote.pricing.baseCost, 200);
  assert.equal(quote.km.includedKmTotal, 50);
  assert.equal(quote.km.extraKmActual, 70);
  assert.equal(quote.pricing.extraKmActualCost, 90);
  assert.equal(quote.pricing.finalTotal, 290);
});

test("legacy or malformed metadata is not treated as authoritative pricing terms", () => {
  assert.equal(restoreRentalPricingTermsSnapshot(null), null);
  assert.equal(restoreRentalPricingTermsSnapshot({}), null);
  assert.equal(
    restoreRentalPricingTermsSnapshot({
      kind: "fleetum.rental-pricing-terms",
      version: 1,
      priceList: { ...terms.priceList, baseRateAmount: "not-a-number" },
      pricePackage: null,
      extraKmPolicy: null
    }),
    null
  );
});
