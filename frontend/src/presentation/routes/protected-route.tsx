import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../../application/stores/auth-store";
import { authUseCases } from "../../application/usecases/auth-usecases";
import { FleetumFullScreenLoader } from "../components/brand/fleetum-logo-loader";

export const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const location = useLocation();
  const { isAuthenticated, authChecked, setUser, logout } = useAuthStore();

  useEffect(() => {
    if (authChecked || isAuthenticated) return;
    authUseCases.me().then(setUser).catch(() => logout());
  }, [authChecked, isAuthenticated, logout, setUser]);

  if (!authChecked) {
    return <FleetumFullScreenLoader label="Verifica sessione" />;
  }

  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  return isAuthenticated ? children : <Navigate to={`/login?next=${encodeURIComponent(returnTo)}`} replace />;
};
