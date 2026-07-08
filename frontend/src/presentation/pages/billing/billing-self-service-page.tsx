import { Link } from "react-router-dom";
import { useEntitlements } from "../../hooks/use-entitlements";
import { PlanUpgradePage } from "../profile/plan-upgrade-page";

export const BillingSelfServicePage = () => {
  const { licenseStatus } = useEntitlements();
  const canOpenDashboard = licenseStatus === "ACTIVE" || licenseStatus === "TRIAL";

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(79,70,229,0.14),transparent_34%),linear-gradient(135deg,#f8fbff_0%,#eef4ff_45%,#f8fafc_100%)] px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-white md:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 pb-6">
        <Link to="/" className="inline-flex items-center gap-3 rounded-full border border-white/70 bg-white/80 px-4 py-2 text-sm font-bold shadow-[0_20px_45px_-32px_rgba(15,23,42,0.45)] backdrop-blur dark:border-white/10 dark:bg-slate-950/70">
          <img className="h-8 w-8" src="/brand/fleetum-symbol-color.svg" alt="Fleetum" />
          Fleetum
        </Link>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-full border border-indigo-200 bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-indigo-700 shadow-sm md:inline-flex dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100">
            Billing sicuro Stripe
          </span>
          {canOpenDashboard ? (
            <Link
              to="/dashboard"
              className="inline-flex h-10 items-center justify-center rounded-full border border-input bg-white/80 px-4 py-2 text-sm font-semibold text-foreground shadow-[0_10px_24px_-20px_rgba(15,23,42,0.45)] transition hover:bg-white dark:bg-slate-950/55"
            >
              Torna alla dashboard
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mx-auto max-w-6xl rounded-[2rem] border border-white/70 bg-white/80 p-4 shadow-[0_30px_80px_-45px_rgba(15,23,42,0.55)] backdrop-blur dark:border-white/10 dark:bg-slate-950/65 md:p-6">
        <PlanUpgradePage mode="upgrade" />
      </div>
    </main>
  );
};
