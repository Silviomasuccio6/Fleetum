import { ArrowLeft } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { useEntitlements } from "../../hooks/use-entitlements";
import { FleetumFullScreenLoader } from "../../components/brand/fleetum-logo-loader";
import { PlanUpgradePage } from "../profile/plan-upgrade-page";

export const BillingSelfServicePage = () => {
  const { licenseStatus, loaded } = useEntitlements();
  const hasActiveSubscription = licenseStatus === "ACTIVE" || licenseStatus === "TRIAL";

  if (!loaded) {
    return <FleetumFullScreenLoader label="Verifica abbonamento" />;
  }

  if (licenseStatus === "PAST_DUE" || licenseStatus === "SUSPENDED") {
    return <Navigate to="/billing/recovery" replace />;
  }

  if (!hasActiveSubscription) {
    return <Navigate to="/activate?billing=required" replace />;
  }

  return (
    <main className="workspace-shell billing-standalone">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 pb-6">
        <Link
          to="/dashboard"
          aria-label="Torna alla dashboard del gestionale"
          className="billing-back-link"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Torna al gestionale
        </Link>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-full border border-indigo-200 bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-indigo-700 shadow-sm md:inline-flex dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100">
            Abbonamento aziendale
          </span>
        </div>
      </div>

      <div className="billing-content">
        <PlanUpgradePage mode="upgrade" />
      </div>
    </main>
  );
};
