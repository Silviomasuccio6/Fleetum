import { useCallback, useEffect } from "react";
import { useAuthStore } from "../../application/stores/auth-store";
import { useEntitlementsStore } from "../../application/stores/entitlements-store";
import { authUseCases } from "../../application/usecases/auth-usecases";
import {
  FeatureKey,
  PLAN_MONTHLY_PRICING_EUR,
  ensureKnownPlan,
  getFeatureListForPlan,
  getRequiredPlanForFeature,
  hasFeature
} from "../../domain/constants/entitlements";

export const useEntitlements = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { plan, licenseStatus, provider, priceMonthly, features, loading, loaded, error, setLoading, setEntitlements, setError, reset } = useEntitlementsStore();

  useEffect(() => {
    if (!isAuthenticated) {
      reset();
      return;
    }

    if (loaded || loading) return;

    let active = true;
    setLoading(true);

    authUseCases
      .entitlements()
      .then((data) => {
        if (!active) return;
        const normalizedPlan = ensureKnownPlan(data.plan ?? data.license?.plan);
        setEntitlements({
          plan: normalizedPlan,
          priceMonthly: data.priceMonthly,
          features: (data.features?.length ? data.features : getFeatureListForPlan(normalizedPlan)) ?? [],
          licenseStatus: data.license?.status ?? null,
          provider: data.license?.provider ?? null
        });
      })
      .catch(async (err) => {
        if (!active) return;
        try {
          const license = await authUseCases.licenseStatus();
          if (!active) return;
          const normalizedPlan = ensureKnownPlan(license.plan);
          setEntitlements({
            plan: normalizedPlan,
            priceMonthly: PLAN_MONTHLY_PRICING_EUR[normalizedPlan],
            features: getFeatureListForPlan(normalizedPlan),
            licenseStatus: license.status,
            provider: license.provider
          });
          return;
        } catch {
          if (!active) return;
          setError((err as Error).message);
        }
      });

    return () => {
      active = false;
    };
  }, [isAuthenticated, loaded, loading, reset, setEntitlements, setError, setLoading]);

  const can = useCallback((feature: FeatureKey) => hasFeature(plan, feature), [plan]);
  const requiredPlan = useCallback((feature: FeatureKey) => getRequiredPlanForFeature(feature), []);

  return {
    plan,
    licenseStatus,
    provider,
    priceMonthly,
    features,
    can,
    requiredPlan,
    loading,
    loaded,
    error
  };
};
