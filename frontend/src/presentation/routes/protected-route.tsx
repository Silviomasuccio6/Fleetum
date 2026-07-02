import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../../application/stores/auth-store";
import { authUseCases } from "../../application/usecases/auth-usecases";
import { HttpClientError } from "../../infrastructure/api/http-client";
import { FleetumFullScreenLoader } from "../components/brand/fleetum-logo-loader";
import { Button } from "../components/ui/button";

export const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const location = useLocation();
  const { isAuthenticated, authChecked, setUser, logout } = useAuthStore();
  const [billingGate, setBillingGate] = useState<"checking" | "allowed" | "required" | "error">("checking");
  const [billingGateError, setBillingGateError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (authChecked || isAuthenticated) return;
    authUseCases.me().then(setUser).catch(() => logout());
  }, [authChecked, isAuthenticated, logout, setUser]);

  useEffect(() => {
    if (!isAuthenticated) {
      setBillingGate("checking");
      return;
    }

    let cancelled = false;
    setBillingGateError(null);
    setBillingGate("checking");
    authUseCases
      .licenseStatus()
      .then((license) => {
        if (cancelled) return;
        setBillingGate(license.status === "ACTIVE" || license.status === "TRIAL" ? "allowed" : "required");
      })
      .catch((error: unknown) => {
        if (cancelled) return;

        if (error instanceof HttpClientError && (error.status === 401 || error.code === "UNAUTHORIZED")) {
          logout();
          return;
        }

        setBillingGateError(error instanceof Error ? error.message : "Impossibile verificare l'abbonamento.");
        setBillingGate("error");
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, location.pathname, logout, retryTick]);

  if (!authChecked || (isAuthenticated && billingGate === "checking")) {
    return <FleetumFullScreenLoader label="Verifica sessione" />;
  }

  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  if (!isAuthenticated) return <Navigate to={`/login?next=${encodeURIComponent(returnTo)}`} replace />;

  const isBillingSelfServiceRoute =
    location.pathname.startsWith("/activate") ||
    location.pathname.startsWith("/upgrade") ||
    location.pathname.startsWith("/onboarding/azienda");

  if (billingGate === "error" && !isBillingSelfServiceRoute) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <div className="w-full max-w-md rounded-3xl border bg-card p-6 text-center shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Fleetum</p>
          <h1 className="mt-3 text-2xl font-bold text-foreground">Verifica abbonamento non riuscita</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Non riesco a confermare lo stato del piano in questo momento. Non ti mando al checkout per evitare un falso blocco:
            riprova tra pochi secondi.
          </p>
          {billingGateError ? (
            <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {billingGateError}
            </p>
          ) : null}
          <Button className="mt-5 w-full" onClick={() => setRetryTick((value) => value + 1)}>
            Riprova verifica
          </Button>
        </div>
      </div>
    );
  }

  if (billingGate === "required" && !isBillingSelfServiceRoute) {
    return <Navigate to="/activate?billing=required" replace />;
  }

  return children;
};
