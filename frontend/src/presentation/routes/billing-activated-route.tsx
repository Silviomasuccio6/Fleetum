import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { authUseCases } from "../../application/usecases/auth-usecases";
import { HttpClientError } from "../../infrastructure/api/http-client";
import { FleetumFullScreenLoader } from "../components/brand/fleetum-logo-loader";
import { Button } from "../components/ui/button";

type LicenseStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";

const OPERATIVE_STATUSES: LicenseStatus[] = ["ACTIVE", "TRIAL"];

export const BillingActivatedRoute = ({ children }: { children: JSX.Element }) => {
  const location = useLocation();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let active = true;
    setChecked(false);
    setError(null);

    authUseCases
      .licenseStatus()
      .then((license) => {
        if (!active) return;
        setStatus(license.status as LicenseStatus);
      })
      .catch((caught: unknown) => {
        if (!active) return;

        if (caught instanceof HttpClientError && (caught.status === 401 || caught.code === "UNAUTHORIZED")) {
          setStatus(null);
          setError("Sessione scaduta. Accedi di nuovo per continuare.");
          return;
        }

        setStatus(null);
        setError(caught instanceof Error ? caught.message : "Impossibile verificare lo stato del piano.");
      })
      .finally(() => {
        if (active) setChecked(true);
      });

    return () => {
      active = false;
    };
  }, [retryTick]);

  if (!checked) {
    return <FleetumFullScreenLoader label="Verifica abbonamento" />;
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <div className="w-full max-w-md rounded-3xl border bg-card p-6 text-center shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Fleetum</p>
          <h1 className="mt-3 text-2xl font-bold text-foreground">Abbonamento non verificabile</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Non apro il gestionale e non ti mando ai piani fino a quando non riesco a leggere lo stato reale della licenza.
          </p>
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</p>
          <Button className="mt-5 w-full" onClick={() => setRetryTick((value) => value + 1)}>
            Riprova verifica
          </Button>
        </div>
      </div>
    );
  }

  if (!status || !OPERATIVE_STATUSES.includes(status)) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    if (status === "PAST_DUE" || status === "SUSPENDED") {
      return <Navigate to={`/billing/recovery?returnTo=${encodeURIComponent(returnTo)}`} replace />;
    }
    return <Navigate to={`/activate?billing=required&returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return children;
};
