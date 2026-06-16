export const SAAS_PLANS = ["STARTER", "PRO", "ENTERPRISE"] as const;

export type SaasPlan = (typeof SAAS_PLANS)[number];

export const PLAN_LEVELS: Record<SaasPlan, number> = {
  STARTER: 1,
  PRO: 2,
  ENTERPRISE: 3
};

export const PLAN_MONTHLY_PRICING_EUR: Record<SaasPlan, number> = {
  STARTER: 149,
  PRO: 199,
  ENTERPRISE: 249
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

const cumulative: Record<SaasPlan, Set<FeatureKey>> = {
  STARTER: new Set(PLAN_ENTITLEMENTS.STARTER),
  PRO: new Set([...PLAN_ENTITLEMENTS.STARTER, ...PLAN_ENTITLEMENTS.PRO]),
  ENTERPRISE: new Set([...PLAN_ENTITLEMENTS.STARTER, ...PLAN_ENTITLEMENTS.PRO, ...PLAN_ENTITLEMENTS.ENTERPRISE])
};

export const ensureKnownPlan = (plan: string | null | undefined): SaasPlan => {
  if (plan === "STARTER" || plan === "PRO" || plan === "ENTERPRISE") return plan;
  return "STARTER";
};

export const hasFeature = (plan: string | null | undefined, feature: string) => {
  const normalized = ensureKnownPlan(plan);
  return cumulative[normalized].has(feature as FeatureKey);
};

export const getRequiredPlanForFeature = (feature: string): SaasPlan | null => {
  const plan = SAAS_PLANS.find((entry) => cumulative[entry].has(feature as FeatureKey));
  return plan ?? null;
};

export const getFeatureListForPlan = (plan: string | null | undefined): FeatureKey[] => {
  return Array.from(cumulative[ensureKnownPlan(plan)]);
};
