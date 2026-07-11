import { create } from "zustand";
import { FeatureKey, PLAN_MONTHLY_PRICING_EUR, SaasPlan, ensureKnownPlan } from "../../domain/constants/entitlements";

type EntitlementsState = {
  plan: SaasPlan;
  licenseStatus: "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED" | null;
  provider: "stripe" | "local" | null;
  billingCycle: "monthly" | "yearly" | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  priceMonthly: number;
  features: FeatureKey[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  setLoading: (loading: boolean) => void;
  setEntitlements: (input: {
    plan: string;
    priceMonthly: number;
    features: string[];
    licenseStatus?: EntitlementsState["licenseStatus"];
    provider?: EntitlementsState["provider"];
    billingCycle?: EntitlementsState["billingCycle"];
    expiresAt?: string | null;
    daysRemaining?: number | null;
  }) => void;
  setError: (message: string | null) => void;
  reset: () => void;
};

const initialState = {
  plan: "STARTER" as SaasPlan,
  licenseStatus: null,
  provider: null,
  billingCycle: null,
  expiresAt: null,
  daysRemaining: null,
  priceMonthly: PLAN_MONTHLY_PRICING_EUR.STARTER,
  features: [] as FeatureKey[],
  loading: false,
  loaded: false,
  error: null as string | null
};

export const useEntitlementsStore = create<EntitlementsState>((set) => ({
  ...initialState,
  setLoading: (loading) => set({ loading }),
  setEntitlements: ({ plan, priceMonthly, features, licenseStatus, provider, billingCycle, expiresAt, daysRemaining }) =>
    set({
      plan: ensureKnownPlan(plan),
      licenseStatus: licenseStatus ?? null,
      provider: provider ?? null,
      billingCycle: billingCycle ?? null,
      expiresAt: expiresAt ?? null,
      daysRemaining: typeof daysRemaining === "number" ? daysRemaining : null,
      priceMonthly: Number.isFinite(priceMonthly) && priceMonthly > 0 ? priceMonthly : PLAN_MONTHLY_PRICING_EUR.STARTER,
      features: features.filter(Boolean) as FeatureKey[],
      loading: false,
      loaded: true,
      error: null
    }),
  setError: (message) => set({ error: message, loading: false, loaded: true }),
  reset: () => set({ ...initialState })
}));
