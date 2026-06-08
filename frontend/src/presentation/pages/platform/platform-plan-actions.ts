import { LicenseStatus } from "../../../application/usecases/platform/platform-admin-usecases";
import { PLAN_MONTHLY_PRICING_EUR } from "../../../domain/constants/entitlements";

export type PlanTier = "STARTER" | "PRO" | "ENTERPRISE";

export const PLAN_TIERS: PlanTier[] = ["STARTER", "PRO", "ENTERPRISE"];

const PLAN_ORDER: Record<PlanTier, number> = {
  STARTER: 1,
  PRO: 2,
  ENTERPRISE: 3
};

export const isPlanTier = (value: string): value is PlanTier => PLAN_TIERS.includes(value as PlanTier);

export const normalizePlanTier = (value?: string | null): PlanTier => (value && isPlanTier(value) ? value : "STARTER");

export const isPlanDowngrade = (currentPlan: PlanTier, nextPlan: PlanTier) => PLAN_ORDER[nextPlan] < PLAN_ORDER[currentPlan];

export const hasPlanChange = (currentPlan: PlanTier, nextPlan: PlanTier) => currentPlan !== nextPlan;

export const canApplyPlanChange = (input: { busy: boolean; currentPlan: PlanTier; nextPlan: PlanTier }) =>
  !input.busy && hasPlanChange(input.currentPlan, input.nextPlan);

export const canApplyPlanAndActivate = (input: {
  busy: boolean;
  currentPlan: PlanTier;
  nextPlan: PlanTier;
  licenseStatus: LicenseStatus;
}) => !input.busy && (hasPlanChange(input.currentPlan, input.nextPlan) || input.licenseStatus !== "ACTIVE");

export const clearPlanDraft = (drafts: Record<string, PlanTier>, tenantId: string) => {
  const clone = { ...drafts };
  delete clone[tenantId];
  return clone;
};

export const rollbackPlanDraft = (drafts: Record<string, PlanTier>, tenantId: string, currentPlan: PlanTier) => ({
  ...drafts,
  [tenantId]: currentPlan
});

type LicenseSnapshot = {
  plan?: string;
  seats?: number;
  status?: LicenseStatus;
  expiresAt?: string | null;
  priceMonthly?: number | null;
  billingCycle?: "monthly" | "yearly";
} | null;

export const buildPlanUpdatePayload = (input: { nextPlan: PlanTier; license?: LicenseSnapshot; forceActive?: boolean }) => {
  const license = input.license ?? null;
  const status = input.forceActive ? "ACTIVE" : (license?.status ?? "PENDING");
  return {
    plan: input.nextPlan,
    seats: license?.seats ?? 3,
    status,
    expiresAt: license?.expiresAt ?? null,
    priceMonthly: license?.priceMonthly ?? PLAN_MONTHLY_PRICING_EUR[input.nextPlan],
    billingCycle: license?.billingCycle ?? "monthly"
  };
};
