import { Navigate } from "react-router-dom";
import { FeatureKey } from "../../domain/constants/entitlements";
import { FleetumLogoLoader } from "../components/brand/fleetum-logo-loader";
import { useEntitlements } from "../hooks/use-entitlements";

type FeatureProtectedRouteProps = {
  feature: FeatureKey;
  children: JSX.Element;
};

export const FeatureProtectedRoute = ({ feature, children }: FeatureProtectedRouteProps) => {
  const { loading, can } = useEntitlements();

  if (loading) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <FleetumLogoLoader size="md" variant="light" />
        Verifica feature disponibili
      </div>
    );
  }

  if (!can(feature)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};
