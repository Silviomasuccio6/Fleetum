import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { isCompanyProfileReadyForBilling, tenantProfileUseCases } from "../../../application/usecases/tenant-profile-usecases";
import { FleetumFullScreenLoader } from "../../components/brand/fleetum-logo-loader";
import { useEntitlements } from "../../hooks/use-entitlements";
import { getAccessDestination } from "../auth/access-flow";
import { Button } from "../../components/ui/button";
import { CommerceNotice } from "../../components/ui/commerce-workspace";
import { PlanUpgradePage } from "../profile/plan-upgrade-page";

export const BillingActivationPage = () => {
  const location = useLocation();
  const [profileGate, setProfileGate] = useState<"checking" | "ready" | "required" | "error">("checking");
  const { licenseStatus, loaded } = useEntitlements();
  const [retry, setRetry] = useState(0);
  const hasActiveSubscription = licenseStatus === "ACTIVE" || licenseStatus === "TRIAL";
  const checkoutCompleted = new URLSearchParams(location.search).get("checkout") === "success";

  useEffect(() => {
    let cancelled = false;
    setProfileGate("checking");
    tenantProfileUseCases
      .getProfile()
      .then((profile) => {
        if (!cancelled) setProfileGate(isCompanyProfileReadyForBilling(profile) ? "ready" : "required");
      })
      .catch(() => {
        if (!cancelled) setProfileGate("error");
      });

    return () => {
      cancelled = true;
    };
  }, [retry]);

  if (!loaded) {
    return <FleetumFullScreenLoader label="Verifica abbonamento" />;
  }

  // The activation URL can be kept in an old tab or bookmark. Never show
  // activation checkout again to a tenant that already has a valid license.
  if (hasActiveSubscription) {
    return <Navigate to={checkoutCompleted ? getAccessDestination(location.search) : "/upgrade"} replace />;
  }

  if (licenseStatus === "PAST_DUE" || licenseStatus === "SUSPENDED") {
    return <Navigate to="/billing/recovery" replace />;
  }

  if (profileGate === "checking") {
    return <FleetumFullScreenLoader label="Verifica dati aziendali" />;
  }

  if (profileGate === "error") {
    return <main className="workspace-shell billing-standalone"><section className="administration-workspace"><h1 className="text-2xl font-semibold">Verifica dati aziendali</h1><CommerceNotice>I dati aziendali non sono disponibili. Nessuna attivazione è stata avviata. <Button variant="outline" onClick={() => setRetry(key => key + 1)}>Riprova</Button></CommerceNotice></section></main>;
  }

  if (profileGate === "required") {
    return <Navigate to="/onboarding/azienda?billing=profile-required" replace />;
  }

  return (
    <main className="workspace-shell billing-standalone">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between pb-6">
        <Link to="/" className="billing-back-link">
          <img className="h-8 w-8 dark:hidden" src="/brand/fleetum-symbol-color.svg" alt="" />
          <img className="hidden h-8 w-8 dark:block" src="/brand/fleetum-symbol-for-dark-bg.svg" alt="" />
          Fleetum
        </Link>
        <span className="hidden rounded-full border border-indigo-200 bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-indigo-700 shadow-sm md:inline-flex dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100">
          Attivazione account
        </span>
      </div>

      <div className="billing-content">
        <PlanUpgradePage mode="activation" />
      </div>
    </main>
  );
};
