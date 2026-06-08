import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../../application/stores/auth-store";
import { authUseCases } from "../../application/usecases/auth-usecases";
import { FleetumFullScreenLoader } from "../components/brand/fleetum-logo-loader";

export const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const location = useLocation();
  const { isAuthenticated, authChecked, setUser, logout } = useAuthStore();
  const [billingGate, setBillingGate] = useState<"checking" | "allowed" | "required">("checking");

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
    setBillingGate("checking");
    authUseCases
      .licenseStatus()
      .then((license) => {
        if (cancelled) return;
        setBillingGate(license.status === "ACTIVE" || license.status === "TRIAL" ? "allowed" : "required");
      })
      .catch(() => {
        if (!cancelled) setBillingGate("required");
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, location.pathname, location.search]);

  if (!authChecked || (isAuthenticated && billingGate === "checking")) {
    return <FleetumFullScreenLoader label="Verifica sessione" />;
  }

  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  if (!isAuthenticated) return <Navigate to={`/login?next=${encodeURIComponent(returnTo)}`} replace />;

  if (billingGate === "required" && !location.pathname.startsWith("/upgrade")) {
    return <Navigate to="/upgrade?billing=required" replace />;
  }

  return children;
};
