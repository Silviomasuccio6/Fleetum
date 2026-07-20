import { useCallback, useEffect } from "react";
import { useAuthStore } from "../../application/stores/auth-store";
import { useEntitlementsStore } from "../../application/stores/entitlements-store";
import type { EntitlementsSnapshot } from "../../application/stores/entitlements-store";
import { authUseCases } from "../../application/usecases/auth-usecases";
import {
  FeatureKey,
  PLAN_MONTHLY_PRICING_EUR,
  ensureKnownPlan,
  getFeatureListForPlan,
  getRequiredPlanForFeature
} from "../../domain/constants/entitlements";

type RefreshOptions = {
  force?: boolean;
};

const knownFeatures = new Set<FeatureKey>(getFeatureListForPlan("ENTERPRISE"));

const normalizePrice = (value: number, plan: EntitlementsSnapshot["plan"]) =>
  Number.isFinite(value) && value > 0 ? value : PLAN_MONTHLY_PRICING_EUR[plan];

const loadEntitlementsSnapshot = async (tenantId: string): Promise<EntitlementsSnapshot> => {
  try {
    const data = await authUseCases.entitlements();
    const plan = ensureKnownPlan(data.plan ?? data.license?.plan);

    return {
      tenantId,
      plan,
      licenseStatus: data.license.status,
      provider: data.license.provider,
      billingCycle: data.license.billingCycle,
      expiresAt: data.license.expiresAt ?? null,
      daysRemaining: data.license.daysRemaining ?? null,
      expiringSoon: data.license.expiringSoon,
      priceMonthly: normalizePrice(data.priceMonthly, plan),
      features: data.features.filter((feature): feature is FeatureKey => knownFeatures.has(feature as FeatureKey))
    };
  } catch (primaryError) {
    try {
      const license = await authUseCases.licenseStatus();
      const plan = ensureKnownPlan(license.plan);

      return {
        tenantId,
        plan,
        licenseStatus: license.status,
        provider: license.provider,
        billingCycle: license.billingCycle,
        expiresAt: license.expiresAt ?? null,
        daysRemaining: license.daysRemaining ?? null,
        expiringSoon: license.expiringSoon,
        priceMonthly: PLAN_MONTHLY_PRICING_EUR[plan],
        features: getFeatureListForPlan(plan)
      };
    } catch {
      throw primaryError;
    }
  }
};

export const useEntitlements = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const tenantId = useAuthStore((state) => state.user?.tenantId ?? "");
  const {
    plan,
    licenseStatus,
    provider,
    billingCycle,
    expiresAt,
    daysRemaining,
    expiringSoon,
    priceMonthly,
    features,
    loading,
    loaded,
    error,
    lastUpdatedAt,
    refreshEntitlements,
    reset
  } = useEntitlementsStore();

  const refresh = useCallback(
    (options: RefreshOptions = {}) => {
      if (!isAuthenticated || !tenantId) {
        return Promise.reject(new Error("Sessione non autenticata."));
      }
      return refreshEntitlements({
        tenantId,
        force: options.force,
        load: () => loadEntitlementsSnapshot(tenantId)
      });
    },
    [isAuthenticated, refreshEntitlements, tenantId]
  );

  useEffect(() => {
    if (!isAuthenticated || !tenantId) {
      reset();
      return;
    }

    void refresh().catch(() => undefined);
  }, [isAuthenticated, refresh, reset, tenantId]);

  const can = useCallback((feature: FeatureKey) => loaded && features.includes(feature), [features, loaded]);
  const requiredPlan = useCallback((feature: FeatureKey) => getRequiredPlanForFeature(feature), []);

  return {
    plan,
    licenseStatus,
    provider,
    billingCycle,
    expiresAt,
    daysRemaining,
    expiringSoon,
    priceMonthly,
    features,
    can,
    requiredPlan,
    loading,
    loaded,
    error,
    lastUpdatedAt,
    refresh
  };
};
