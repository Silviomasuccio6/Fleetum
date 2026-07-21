import { create } from "zustand";
import { FeatureKey, PLAN_MONTHLY_PRICING_EUR, SaasPlan } from "../../domain/constants/entitlements";
import type { BillingCycle, BillingProvider, LicenseStatus } from "../../domain/policies/billing-access";

export type EntitlementsSnapshot = {
  tenantId: string;
  plan: SaasPlan;
  licenseStatus: LicenseStatus;
  provider: BillingProvider;
  billingCycle: BillingCycle;
  expiresAt: string | null;
  daysRemaining: number | null;
  expiringSoon: boolean;
  priceMonthly: number;
  features: FeatureKey[];
};

type RefreshOptions = {
  force?: boolean;
  tenantId: string;
  load: () => Promise<EntitlementsSnapshot>;
};

type EntitlementsState = Omit<EntitlementsSnapshot, "licenseStatus" | "provider" | "billingCycle"> & {
  licenseStatus: LicenseStatus | null;
  provider: BillingProvider | null;
  billingCycle: BillingCycle | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  setEntitlements: (snapshot: EntitlementsSnapshot) => void;
  setError: (message: string | null) => void;
  refreshEntitlements: (options: RefreshOptions) => Promise<EntitlementsSnapshot>;
  reset: () => void;
};

const initialState = {
  tenantId: "",
  plan: "STARTER" as SaasPlan,
  licenseStatus: null,
  provider: null,
  billingCycle: null,
  expiresAt: null,
  daysRemaining: null,
  expiringSoon: false,
  priceMonthly: PLAN_MONTHLY_PRICING_EUR.STARTER,
  features: [] as FeatureKey[],
  loading: false,
  loaded: false,
  error: null as string | null,
  lastUpdatedAt: null as number | null
};

let requestSequence = 0;
let inFlightRequest: Promise<EntitlementsSnapshot> | null = null;

export const useEntitlementsStore = create<EntitlementsState>((set, get) => ({
  ...initialState,
  setEntitlements: (snapshot) =>
    set({
      ...snapshot,
      loading: false,
      loaded: true,
      error: null,
      lastUpdatedAt: Date.now()
    }),
  setError: (message) => set({ error: message, loading: false }),
  refreshEntitlements: async ({ force = false, tenantId, load }) => {
    const current = get();
    const tenantChanged = Boolean(current.tenantId && current.tenantId !== tenantId);

    if (tenantChanged) {
      requestSequence += 1;
      inFlightRequest = null;
      set({ ...initialState, tenantId });
    } else if (current.loaded && !force) {
      return {
        tenantId,
        plan: current.plan,
        licenseStatus: current.licenseStatus!,
        provider: current.provider!,
        billingCycle: current.billingCycle!,
        expiresAt: current.expiresAt,
        daysRemaining: current.daysRemaining,
        expiringSoon: current.expiringSoon,
        priceMonthly: current.priceMonthly,
        features: current.features
      };
    }

    if (inFlightRequest) return inFlightRequest;

    const requestId = ++requestSequence;
    set({ loading: true, error: null, tenantId });
    const request = Promise.resolve().then(load);
    inFlightRequest = request;

    try {
      const snapshot = await request;
      if (requestId === requestSequence) get().setEntitlements(snapshot);
      return snapshot;
    } catch (error) {
      if (requestId === requestSequence) {
        get().setError(error instanceof Error ? error.message : "Impossibile verificare lo stato del piano.");
      }
      throw error;
    } finally {
      if (inFlightRequest === request) inFlightRequest = null;
    }
  },
  reset: () => {
    requestSequence += 1;
    inFlightRequest = null;
    set({ ...initialState });
  }
}));
