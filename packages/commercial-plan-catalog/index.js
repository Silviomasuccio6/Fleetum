export const COMMERCIAL_CURRENCY = "EUR";
export const COMMERCIAL_PRICES_INCLUDE_TAX = true;
export const ANNUAL_DISCOUNT_BASIS_POINTS = 1500;
export const ANNUAL_DISCOUNT_PERCENT = ANNUAL_DISCOUNT_BASIS_POINTS / 100;
export const SAAS_PLAN_CODES = Object.freeze(["STARTER", "PRO", "ENTERPRISE"]);

const annualPrice = (monthlyPriceCents) =>
  Math.round(monthlyPriceCents * 12 * (10_000 - ANNUAL_DISCOUNT_BASIS_POINTS) / 10_000);

const plan = (code, label, monthlyPriceCents, monthlyEnvKey, yearlyEnvKey) => Object.freeze({
  code,
  label,
  currency: COMMERCIAL_CURRENCY,
  taxInclusive: COMMERCIAL_PRICES_INCLUDE_TAX,
  monthlyPriceCents,
  yearlyPriceCents: annualPrice(monthlyPriceCents),
  stripePriceEnv: Object.freeze({ monthly: monthlyEnvKey, yearly: yearlyEnvKey })
});

export const COMMERCIAL_PLAN_CATALOG = Object.freeze({
  STARTER: plan("STARTER", "Starter", 14_900, "STRIPE_PRICE_STARTER_MONTHLY", "STRIPE_PRICE_STARTER_YEARLY"),
  PRO: plan("PRO", "Pro", 19_900, "STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_PRO_YEARLY"),
  ENTERPRISE: plan("ENTERPRISE", "Enterprise", 24_900, "STRIPE_PRICE_ENTERPRISE_MONTHLY", "STRIPE_PRICE_ENTERPRISE_YEARLY")
});

export const PLAN_MONTHLY_PRICING_EUR = Object.freeze(Object.fromEntries(
  SAAS_PLAN_CODES.map((code) => [code, COMMERCIAL_PLAN_CATALOG[code].monthlyPriceCents / 100])
));

export const PLAN_YEARLY_PRICING_EUR = Object.freeze(Object.fromEntries(
  SAAS_PLAN_CODES.map((code) => [code, COMMERCIAL_PLAN_CATALOG[code].yearlyPriceCents / 100])
));

export const getCommercialPlan = (code) => COMMERCIAL_PLAN_CATALOG[code] ?? COMMERCIAL_PLAN_CATALOG.STARTER;

export const getCommercialPlanPriceCents = (code, billingCycle = "monthly") => {
  const selectedPlan = getCommercialPlan(code);
  return billingCycle === "yearly" ? selectedPlan.yearlyPriceCents : selectedPlan.monthlyPriceCents;
};
