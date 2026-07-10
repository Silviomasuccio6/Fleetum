import { Navigate } from "react-router-dom";
import { useEntitlements } from "../../hooks/use-entitlements";
import { FleetumFullScreenLoader } from "../../components/brand/fleetum-logo-loader";
import { PlanUpgradePage } from "../profile/plan-upgrade-page";

export const BillingRecoveryPage = () => {
  const { licenseStatus, loaded, loading } = useEntitlements();

  if (loading || !loaded) {
    return <FleetumFullScreenLoader label="Verifica abbonamento" />;
  }

  if (licenseStatus === "ACTIVE" || licenseStatus === "TRIAL") {
    return <Navigate to="/upgrade" replace />;
  }

  if (licenseStatus !== "PAST_DUE" && licenseStatus !== "SUSPENDED") {
    return <Navigate to="/activate?billing=required" replace />;
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(79,70,229,0.14),transparent_34%),linear-gradient(135deg,#f8fbff_0%,#eef4ff_45%,#f8fafc_100%)] px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-white md:px-8">
      <div className="mx-auto flex w-full max-w-6xl justify-end pb-6">
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-amber-800 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          Regolarizzazione pagamento
        </span>
      </div>
      <div className="mx-auto max-w-6xl rounded-[2rem] border border-white/70 bg-white/80 p-4 shadow-[0_30px_80px_-45px_rgba(15,23,42,0.55)] backdrop-blur dark:border-white/10 dark:bg-slate-950/65 md:p-6">
        <PlanUpgradePage mode="recovery" />
      </div>
    </main>
  );
};
