import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { authUseCases } from "../../application/usecases/auth-usecases";
import { FleetumFullScreenLoader } from "../components/brand/fleetum-logo-loader";

type LicenseStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";

const OPERATIVE_STATUSES: LicenseStatus[] = ["ACTIVE", "TRIAL"];

export const BillingActivatedRoute = ({ children }: { children: JSX.Element }) => {
  const location = useLocation();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    setChecked(false);

    authUseCases
      .licenseStatus()
      .then((license) => {
        if (!active) return;
        setStatus(license.status as LicenseStatus);
      })
      .catch(() => {
        if (!active) return;
        setStatus("PENDING");
      })
      .finally(() => {
        if (active) setChecked(true);
      });

    return () => {
      active = false;
    };
  }, []);

  if (!checked) {
    return <FleetumFullScreenLoader label="Verifica abbonamento" />;
  }

  if (!status || !OPERATIVE_STATUSES.includes(status)) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/activate?billing=required&returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return children;
};
