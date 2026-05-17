import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../../application/stores/auth-store";
import { User } from "../../../domain/entities/models";
import { FleetumBlockLoader } from "../../components/brand/fleetum-logo-loader";
import { getSafeReturnTo } from "../../routes/safe-return-to";

const decodeBase64Url = (input: string) => {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = base64.length % 4 === 0 ? 0 : 4 - (base64.length % 4);
  const padded = base64 + "=".repeat(padLength);
  return atob(padded);
};

export const SocialAuthCallbackPage = () => {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [error, setError] = useState<string | null>(null);

  const hashParams = useMemo(() => {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    return new URLSearchParams(hash);
  }, []);

  useEffect(() => {
    const providerError = hashParams.get("error");
    if (providerError) {
      setError(providerError);
      return;
    }

    const encodedUser = hashParams.get("user");

    if (!encodedUser) {
      setError("Risposta OAuth incompleta. Riprova il login social.");
      return;
    }

    try {
      const user = JSON.parse(decodeBase64Url(encodedUser)) as User;
      const returnTo = getSafeReturnTo(hashParams.get("returnTo"));
      setSession(user, true);
      navigate(returnTo, { replace: true });
    } catch {
      setError("Impossibile finalizzare il login social.");
    }
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
