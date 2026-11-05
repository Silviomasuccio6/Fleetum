import { Navigate } from "react-router-dom";
import { useEntitlements } from "../../hooks/use-entitlements";
import { FleetumFullScreenLoader } from "../../components/brand/fleetum-logo-loader";
import { PlanUpgradePage } from "../profile/plan-upgrade-page";

export const BillingRecoveryPage = () => {
  const { licenseStatus, loaded } = useEntitlements();

  if (!loaded) {
    return <FleetumFullScreenLoader label="Verifica abbonamento" />;
  }

  if (licenseStatus === "ACTIVE" || licenseStatus === "TRIAL") {
    return <Navigate to="/upgrade" replace />;
  }

  if (licenseStatus !== "PAST_DUE" && licenseStatus !== "SUSPENDED") {
    return <Navigate to="/activate?billing=required" replace />;
  }

  return (
    <main className="workspace-shell billing-standalone">
      <div className="mx-auto flex w-full max-w-6xl justify-end pb-6">
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-amber-800 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          Regolarizzazione pagamento
        </span>
      </div>
      <div className="billing-content">
        <PlanUpgradePage mode="recovery" />
      </div>
    </main>
  );
};
