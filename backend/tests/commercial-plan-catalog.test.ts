import assert from "node:assert/strict";
import test from "node:test";
import {
  ANNUAL_DISCOUNT_BASIS_POINTS,
  COMMERCIAL_PLAN_CATALOG,
  SAAS_PLAN_CODES,
  getCommercialPlanPriceCents
} from "@fleetum/commercial-plan-catalog";
import {
  PLAN_MONTHLY_PRICING_EUR,
  PLAN_YEARLY_PRICING_EUR
} from "../src/application/services/feature-entitlements-service.js";

test("commercial plan catalog is the backend pricing source of truth", () => {
  const expectedMonthlyCents = { STARTER: 14_900, PRO: 19_900, ENTERPRISE: 24_900 } as const;
  const expectedYearlyCents = { STARTER: 151_980, PRO: 202_980, ENTERPRISE: 253_980 } as const;

  assert.equal(ANNUAL_DISCOUNT_BASIS_POINTS, 1500);
  assert.deepEqual([...SAAS_PLAN_CODES], ["STARTER", "PRO", "ENTERPRISE"]);
  assert.deepEqual(PLAN_MONTHLY_PRICING_EUR, { STARTER: 149, PRO: 199, ENTERPRISE: 249 });
  assert.deepEqual(PLAN_YEARLY_PRICING_EUR, { STARTER: 1519.8, PRO: 2029.8, ENTERPRISE: 2539.8 });

  for (const plan of SAAS_PLAN_CODES) {
    assert.equal(COMMERCIAL_PLAN_CATALOG[plan].taxInclusive, true);
    assert.equal(getCommercialPlanPriceCents(plan, "monthly"), expectedMonthlyCents[plan]);
    assert.equal(getCommercialPlanPriceCents(plan, "yearly"), expectedYearlyCents[plan]);
  }
});
