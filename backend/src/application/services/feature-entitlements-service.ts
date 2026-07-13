import {
  COMMERCIAL_PLAN_CATALOG,
  PLAN_MONTHLY_PRICING_EUR as SHARED_PLAN_MONTHLY_PRICING_EUR,
  PLAN_YEARLY_PRICING_EUR as SHARED_PLAN_YEARLY_PRICING_EUR,
  SAAS_PLAN_CODES
} from "@fleetum/commercial-plan-catalog";
import type { SaasPlanCode } from "@fleetum/commercial-plan-catalog";

export { COMMERCIAL_PLAN_CATALOG };

export const SAAS_PLANS = [...SAAS_PLAN_CODES] as const;

export type SaasPlan = SaasPlanCode;

export const PLAN_LEVELS: Record<SaasPlan, number> = {
  STARTER: 1,
  PRO: 2,
  ENTERPRISE: 3
};

export const PLAN_MONTHLY_PRICING_EUR: Record<SaasPlan, number> = {
  ...SHARED_PLAN_MONTHLY_PRICING_EUR
};

export const PLAN_YEARLY_PRICING_EUR: Record<SaasPlan, number> = {
  ...SHARED_PLAN_YEARLY_PRICING_EUR
};

const STARTER_FEATURES = [
  "dashboard_overview",
  "tenant_basic_view",
  "users_basic",
  "vehicles_basic",
  "fermi_basic",
  "reports_basic",
  "alerts_basic",
  "export_pdf_basic"
] as const;

const PRO_FEATURES = [
  "reports_advanced",
  "export_csv",
  "advanced_filters",
  "scheduled_reports",
  "bulk_actions",
  "alerts_advanced",
  "integrations_basic",
  "audit_standard"
] as const;

const ENTERPRISE_FEATURES = [
  "api_access",
  "sso",
  "custom_roles",
  "audit_advanced",
  "automations_advanced",
  "webhooks",
  "multi_workspace_controls",
  "priority_support_flags",
  "security_insights",
  "white_label_flags"
] as const;

export type FeatureKey =
  | (typeof STARTER_FEATURES)[number]
  | (typeof PRO_FEATURES)[number]
  | (typeof ENTERPRISE_FEATURES)[number];

export const PLAN_ENTITLEMENTS: Record<SaasPlan, readonly FeatureKey[]> = {
  STARTER: STARTER_FEATURES,
  PRO: PRO_FEATURES,
  ENTERPRISE: ENTERPRISE_FEATURES
};

const CUMULATIVE_ENTITLEMENTS: Record<SaasPlan, Set<FeatureKey>> = {
  STARTER: new Set(STARTER_FEATURES),
  PRO: new Set([...STARTER_FEATURES, ...PRO_FEATURES]),
  ENTERPRISE: new Set([...STARTER_FEATURES, ...PRO_FEATURES, ...ENTERPRISE_FEATURES])
};

export const ensureKnownPlan = (plan: string | null | undefined): SaasPlan => {
  if (plan === "STARTER" || plan === "PRO" || plan === "ENTERPRISE") return plan;
  return "STARTER";
};

export const getFeatureListForPlan = (plan: string | null | undefined): FeatureKey[] => {
  const normalizedPlan = ensureKnownPlan(plan);
  return Array.from(CUMULATIVE_ENTITLEMENTS[normalizedPlan]);
};

export const hasFeature = (plan: string | null | undefined, feature: string): feature is FeatureKey => {
  const normalizedPlan = ensureKnownPlan(plan);
  return CUMULATIVE_ENTITLEMENTS[normalizedPlan].has(feature as FeatureKey);
};

export const getRequiredPlanForFeature = (feature: string): SaasPlan | null => {
  const match = (SAAS_PLANS as readonly SaasPlan[]).find((plan) => CUMULATIVE_ENTITLEMENTS[plan].has(feature as FeatureKey));
  return match ?? null;
};

export const getAllowedPlansForFeature = (feature: string): SaasPlan[] => {
  return (SAAS_PLANS as readonly SaasPlan[]).filter((plan) => CUMULATIVE_ENTITLEMENTS[plan].has(feature as FeatureKey));
};

export const getPlanMonthlyPrice = (plan: string | null | undefined): number => {
  return PLAN_MONTHLY_PRICING_EUR[ensureKnownPlan(plan)];
};

export const getPlanYearlyPrice = (plan: string | null | undefined): number => {
  return PLAN_YEARLY_PRICING_EUR[ensureKnownPlan(plan)];
};

export type BillingCycle = "monthly" | "yearly";

export const normalizeBillingCycle = (value: string | null | undefined): BillingCycle => {
  return value === "yearly" ? "yearly" : "monthly";
};

export const estimateLicenseMonthlyRevenue = (input: {
  plan: string;
  seats: number;
  priceMonthly?: number | null;
  billingCycle?: string | null;
}) => {
  const plan = ensureKnownPlan(input.plan);
  const configuredMonthly = Number.isFinite(input.priceMonthly) && Number(input.priceMonthly) > 0
    ? Number(input.priceMonthly)
    : getPlanMonthlyPrice(plan);

  const monthlyBase = normalizeBillingCycle(input.billingCycle) === "yearly"
    ? configuredMonthly / 12
    : configuredMonthly;

  const seats = Number.isFinite(input.seats) ? Math.max(1, Math.floor(Number(input.seats))) : 1;
  const mrr = monthlyBase * seats;

  return {
    plan,
    basePriceMonthly: Number(monthlyBase.toFixed(2)),
    seatsFactor: seats,
    estimatedMrr: Number(mrr.toFixed(2))
  };
};
