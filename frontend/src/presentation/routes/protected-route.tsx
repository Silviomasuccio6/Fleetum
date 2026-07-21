import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../../application/stores/auth-store";
import { authUseCases } from "../../application/usecases/auth-usecases";
import { isOperativeLicenseStatus } from "../../domain/policies/billing-access";
import { FleetumFullScreenLoader } from "../components/brand/fleetum-logo-loader";
import { Button } from "../components/ui/button";
import { useEntitlements } from "../hooks/use-entitlements";
import { isBillingSelfServiceRoute } from "./billing-self-service-routes";

const ENTITLEMENTS_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

export const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const location = useLocation();
  const { isAuthenticated, authChecked, setUser, logout } = useAuthStore();
  const { licenseStatus, loaded, error, refresh } = useEntitlements();
  const isBillingSelfService = isBillingSelfServiceRoute(location.pathname);

  useEffect(() => {
    if (authChecked || isAuthenticated) return;
    authUseCases.me().then(setUser).catch(() => logout());
  }, [authChecked, isAuthenticated, logout, setUser]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const shouldForceRefresh = isBillingSelfService && Boolean(location.search);
    void refresh({ force: shouldForceRefresh }).catch(() => undefined);
  }, [isAuthenticated, isBillingSelfService, location.pathname, location.search, refresh]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const intervalId = window.setInterval(() => {
      void refresh({ force: true }).catch(() => undefined);
    }, ENTITLEMENTS_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [isAuthenticated, refresh]);

  if (!authChecked) {
    return <FleetumFullScreenLoader label="Verifica sessione" />;
  }

  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  if (!isAuthenticated) return <Navigate to={`/login?next=${encodeURIComponent(returnTo)}`} replace />;

  if (error && !loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <div className="w-full max-w-md rounded-3xl border bg-card p-6 text-center shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Fleetum</p>
          <h1 className="mt-3 text-2xl font-bold text-foreground">Verifica abbonamento non riuscita</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Non riesco a confermare lo stato del piano. Non apro il checkout e non cambio pagina finche il dato reale non torna disponibile.
          </p>
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</p>
          <Button className="mt-5 w-full" onClick={() => void refresh({ force: true }).catch(() => undefined)}>
            Riprova verifica
          </Button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <FleetumFullScreenLoader label="Verifica sessione" />;
  }

  if (!isBillingSelfService) {
    if (licenseStatus === "PAST_DUE" || licenseStatus === "SUSPENDED") {
      return <Navigate to={`/billing/recovery?returnTo=${encodeURIComponent(returnTo)}`} replace />;
    }

    if (!isOperativeLicenseStatus(licenseStatus)) {
      return <Navigate to={`/activate?billing=required&returnTo=${encodeURIComponent(returnTo)}`} replace />;
    }
  }

  return children;
};
