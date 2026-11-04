import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../../application/stores/auth-store";
import { authUseCases } from "../../../application/usecases/auth-usecases";
import { trackPublicEvent } from "../../../application/usecases/public-analytics-usecases";
import { isCompanyProfileReadyForBilling, tenantProfileUseCases } from "../../../application/usecases/tenant-profile-usecases";
import type { User } from "../../../domain/entities/models";
import { AccessShell, AccessNotice } from "../../components/layout/access-shell";
import { getCompanyOnboardingPath, getSocialAccessDestination, getAccessLoginPath } from "./access-flow";
import { Button } from "../../components/ui/button";
import { FleetumLogoLoader } from "../../components/brand/fleetum-logo-loader";
import { getSafeReturnTo } from "../../routes/safe-return-to";

export const SocialAuthCallbackPage = () => {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [error, setError] = useState<string | null>(null);

  const hashParams = useMemo(() => {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    return new URLSearchParams(hash);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Routing hints are captured above; identity in the URL is never trusted.
    // Keep the router state and query while removing the callback's personal data.
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);

    const providerError = hashParams.get("error");
    if (providerError) {
      setError(providerError);
      return () => {
        cancelled = true;
      };
    }

    const finalizeSocialLogin = async () => {
      try {
        // OAuth has already established HttpOnly cookies on the server. Only its
        // authenticated profile can establish the client identity and permissions.
        const user = await authUseCases.me() as User;
        if (cancelled) return;
        const returnTo = getSafeReturnTo(hashParams.get("returnTo"));
        const socialSignupCreated = hashParams.get("socialSignup") === "1";
        setSession(user, true);
        if (socialSignupCreated) {
          // This URL hint is a consent-gated funnel metric, never proof of signup
          // or authorization. Analytics failure must not interrupt authentication.
          try {
            trackPublicEvent("SIGNUP_COMPLETED", { source: "google", next: "company_onboarding" });
          } catch {
            // Browser storage or analytics availability cannot block login.
          }
        }

        let nextPath = returnTo;
        try {
          const license = await authUseCases.licenseStatus();
          if (cancelled) return;
          const hasOperativeLicense = license.status === "ACTIVE" || license.status === "TRIAL";

          if (!hasOperativeLicense) {
            const profile = await tenantProfileUseCases.getProfile().catch(() => null);
            if (cancelled) return;
            if (!isCompanyProfileReadyForBilling(profile)) {
              nextPath = getCompanyOnboardingPath(getSocialAccessDestination(returnTo));
            } else if (!nextPath.startsWith("/activate") && !nextPath.startsWith("/upgrade")) {
              const destination = getSocialAccessDestination(returnTo);
              nextPath = "/activate?billing=required" + (destination === "/dashboard" ? "" : `&returnTo=${encodeURIComponent(destination)}`);
            }
          }
        } catch {
          nextPath = getCompanyOnboardingPath(getSocialAccessDestination(returnTo));
        }

        if (!cancelled) navigate(nextPath, { replace: true });
      } catch {
        if (!cancelled) setError("Impossibile finalizzare il login social.");
      }
    };

    void finalizeSocialLogin();

    return () => {
      cancelled = true;
    };
  }, [hashParams, navigate, setSession]);

  return <AccessShell title="Accesso social" description="Verifichiamo la sessione e lo stato dell’azienda prima di aprire il gestionale.">
    {error ? <><AccessNotice focus>{error}</AccessNotice><Button variant="outline" onClick={() => navigate(getAccessLoginPath("?next=" + encodeURIComponent(getSocialAccessDestination(hashParams.get("returnTo")))), { replace: true })}>Torna al login</Button></> : <div role="status"><div className="access-social-loading"><FleetumLogoLoader variant="light" decorative className="access-loader-light"/><FleetumLogoLoader variant="dark" decorative className="access-loader-dark"/><p className="access-footnote">Verifica accesso in corso</p></div><p className="access-footnote">Non chiudere questa pagina durante la verifica.</p></div>}
  </AccessShell>;
};
