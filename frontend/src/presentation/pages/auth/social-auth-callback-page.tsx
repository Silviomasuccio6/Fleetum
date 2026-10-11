import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../../application/stores/auth-store";
import { authUseCases } from "../../../application/usecases/auth-usecases";
import { trackPublicEvent } from "../../../application/usecases/public-analytics-usecases";
import { isCompanyProfileReadyForBilling, tenantProfileUseCases } from "../../../application/usecases/tenant-profile-usecases";
import type { User } from "../../../domain/entities/models";
import { FleetumBlockLoader } from "../../components/brand/fleetum-logo-loader";
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
              nextPath = "/onboarding/azienda?from=social";
            } else if (!nextPath.startsWith("/activate") && !nextPath.startsWith("/upgrade")) {
              nextPath = "/activate?billing=required";
            }
          }
        } catch {
          nextPath = "/onboarding/azienda?from=social";
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Accesso social</h1>
        {error ? (
          <>
            <p className="mt-3 text-sm text-rose-600">{error}</p>
            <button
              type="button"
              className="mt-5 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => navigate("/login", { replace: true })}
            >
              Torna al login
            </button>
          </>
        ) : (
          <FleetumBlockLoader label="Verifica in corso" className="min-h-[220px]" />
        )}
      </section>
    </main>
  );
};
