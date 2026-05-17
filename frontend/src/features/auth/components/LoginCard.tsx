import { FormEvent, MouseEvent as ReactMouseEvent, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../../../application/stores/auth-store";
import { authUseCases } from "../../../application/usecases/auth-usecases";
import { getApiBaseUrl } from "../../../infrastructure/api/api-base-url";
import { FleetumLogoLoader } from "../../../presentation/components/brand/fleetum-logo-loader";
import { getSafeReturnTo } from "../../../presentation/routes/safe-return-to";

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const GoogleLogo = () => (
  <svg className="premium-login-social-icon" viewBox="0 0 24 24" aria-hidden>
    <path
      fill="#EA4335"
      d="M12 10.2v3.9h5.5c-.5 2.3-2.4 3.9-5.5 3.9a6 6 0 0 1 0-12c1.7 0 3.2.6 4.3 1.6l2.9-2.8A10 10 0 0 0 12 2a10 10 0 0 0 0 20c5.7 0 9.5-4 9.5-9.7 0-.7-.1-1.4-.2-2.1H12z"
    />
    <path
      fill="#4285F4"
      d="M21.5 12.3c0-.7-.1-1.4-.2-2.1H12v3.9h5.5c-.2 1-.8 1.9-1.6 2.5l2.6 2c1.6-1.5 3-3.8 3-6.3z"
    />
    <path
      fill="#FBBC05"
      d="M6.9 14.2A6 6 0 0 1 6.9 9.8L3.8 7.4a10 10 0 0 0 0 9.2l3.1-2.4z"
    />
    <path
      fill="#34A853"
      d="M12 22a10 10 0 0 0 6.8-2.5l-2.6-2c-.8.6-1.9 1-4.2 1a6 6 0 0 1-5.7-4.3l-3.1 2.4A10 10 0 0 0 12 22z"
    />
  </svg>
);


const MailIcon = () => (
  <svg className="premium-login-field-icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M4.75 6.75h14.5v10.5H4.75V6.75Z" />
    <path d="m5.25 7.25 6.75 5.2 6.75-5.2" />
  </svg>
);

const LockIcon = () => (
  <svg className="premium-login-field-icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M7.75 10.25V8.4a4.25 4.25 0 0 1 8.5 0v1.85" />
    <path d="M6.25 10.25h11.5v8H6.25v-8Z" />
    <path d="M12 13.35v1.8" />
  </svg>
);

const EyeIcon = ({ hidden }: { hidden: boolean }) => (
  <svg className="premium-login-eye-icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M3.75 12s2.75-5.25 8.25-5.25S20.25 12 20.25 12s-2.75 5.25-8.25 5.25S3.75 12 3.75 12Z" />
    <path d="M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" />
    {hidden ? <path d="M4.75 19.25 19.25 4.75" /> : null}
  </svg>
);

const AppleLogo = () => (
  <svg className="premium-login-social-icon" viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M16.37 12.6c.03 3.12 2.74 4.16 2.77 4.18-.02.08-.43 1.5-1.42 2.97-.86 1.26-1.75 2.5-3.16 2.53-1.38.03-1.82-.82-3.4-.82-1.58 0-2.07.8-3.37.85-1.36.05-2.4-1.36-3.27-2.61-1.77-2.56-3.12-7.23-1.31-10.37.9-1.56 2.52-2.55 4.28-2.58 1.33-.03 2.58.9 3.4.9.82 0 2.37-1.11 3.98-.95.67.03 2.54.27 3.75 2.03-.1.06-2.24 1.31-2.25 3.87Zm-2.1-8.76c.72-.87 1.2-2.08 1.06-3.28-1.04.04-2.3.69-3.05 1.56-.67.77-1.26 2.01-1.1 3.2 1.16.09 2.36-.59 3.08-1.48Z"
    />
  </svg>
);

export const LoginCard = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setSession = useAuthStore((state) => state.setSession);
  const apiBaseUrl = getApiBaseUrl();
  const googleAuthUrl = (import.meta.env.VITE_GOOGLE_AUTH_URL as string | undefined) ?? `${apiBaseUrl}/auth/google`;
  const appleAuthUrl = (import.meta.env.VITE_APPLE_AUTH_URL as string | undefined) ?? `${apiBaseUrl}/auth/apple`;

  const cardRef = useRef<HTMLDivElement>(null);

  const returnTo = getSafeReturnTo(searchParams.get("next"));
  const welcome = searchParams.get("welcome");
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [pwVisible, setPwVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [shake, setShake] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const emailError = useMemo(() => {
    if (email.length === 0) return "";
    return isValidEmail(email) ? "" : "Inserisci un'email valida";
  }, [email]);

  const passwordError = useMemo(() => {
    if (password.length === 0) return "";
    return password.length >= 8 ? "" : "Minimo 8 caratteri";
  }, [password]);

  const triggerShake = () => {
    setShake(true);
    window.setTimeout(() => setShake(false), 450);
  };

  const handleTilt = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    cardRef.current.style.transform = `perspective(900px) rotateY(${x * 5}deg) rotateX(${-y * 4}deg)`;
    cardRef.current.style.transition = "transform 120ms ease";
  };

  const resetTilt = () => {
    if (!cardRef.current) return;
    cardRef.current.style.transform = "perspective(900px) rotateY(0deg) rotateX(0deg)";
    cardRef.current.style.transition = "transform 500ms cubic-bezier(0.23,1,0.32,1)";
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (!isValidEmail(email) || password.length < 8) {
      triggerShake();
      return;
    }

    setLoading(true);
    try {
      const result = await authUseCases.login({ email, password });
      setSession(result.user, remember);
      setSuccess(true);
      window.setTimeout(() => navigate(returnTo, { replace: true }), 450);
    } catch (error) {
      setFormError((error as Error).message || "Credenziali non valide");
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  const openSocialAuth = (provider: "google" | "apple") => {
    const providerUrl = provider === "google" ? googleAuthUrl : appleAuthUrl;
    const target = new URL(providerUrl, window.location.origin);
    target.searchParams.set("returnTo", returnTo);
    window.location.href = target.toString();
  };

  return (
    <section className="premium-login-card-wrap">
      <div
        ref={cardRef}
        className={`premium-login-card ${shake ? "animate-shake" : ""}`}
        onMouseMove={handleTilt}
        onMouseLeave={resetTilt}
      >
        <div className="premium-login-card-head">
          <img className="premium-login-card-logo premium-login-card-logo--image" src="/brand/fleetum-symbol-color.svg" alt="Fleetum" />
          <h2>Bentornato</h2>
          <p>Accedi al tuo workspace</p>
        </div>


        <form onSubmit={onSubmit} className="premium-login-form" noValidate>
          <div className="premium-login-social-grid">
            <button
              type="button"
              data-cursor="hover"
              className="premium-login-social-btn"
              onClick={() => openSocialAuth("google")}
            >
              <GoogleLogo />
              <span>Google</span>
            </button>
            <button
              type="button"
              data-cursor="hover"
              className="premium-login-social-btn"
              onClick={() => openSocialAuth("apple")}
            >
              <AppleLogo />
              <span>Apple Account</span>
            </button>
          </div>

          <div className="premium-login-divider">o continua con email</div>

          {welcome === "trial" ? (
            <p className="premium-login-error premium-login-error--block" style={{ color: "#065f46", background: "rgba(209,250,229,0.8)", borderColor: "rgba(16,185,129,0.45)" }}>
              Prova gratuita di 14 giorni pronta. Accedi per entrare nel gestionale.
            </p>
          ) : null}

          {welcome === "billing" ? (
            <p className="premium-login-error premium-login-error--block" style={{ color: "#3730a3", background: "rgba(224,231,255,0.82)", borderColor: "rgba(99,102,241,0.35)" }}>
              Accedi e ti porto alla scelta piano con checkout Stripe.
            </p>
          ) : null}

          <label className="premium-login-field-label" htmlFor="premium-login-email">
            Indirizzo email
          </label>
          <div className={`premium-login-field ${emailError ? "is-error" : ""} ${email && !emailError ? "is-ok" : ""}`}>
            <span className="premium-login-field-icon-wrap"><MailIcon /></span>
            <input
              id="premium-login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nome@azienda.com"
              autoComplete="email"
            />
          </div>
          {emailError && <p className="premium-login-error">{emailError}</p>}

          <label className="premium-login-field-label" htmlFor="premium-login-password">
            Password
          </label>
          <div className={`premium-login-field ${passwordError ? "is-error" : ""} ${password && !passwordError ? "is-ok" : ""}`}>
            <span className="premium-login-field-icon-wrap"><LockIcon /></span>
            <input
              id="premium-login-password"
              type={pwVisible ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
            />
            <button
              type="button"
              data-cursor="hover"
              className="premium-login-eye"
              onClick={() => setPwVisible((current) => !current)}
            >
              <EyeIcon hidden={pwVisible} />
            </button>
          </div>
          {passwordError && <p className="premium-login-error">{passwordError}</p>}

          <div className="premium-login-row">
            <label className="premium-login-check" htmlFor="premium-login-remember">
              <input
                id="premium-login-remember"
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span>Ricordami</span>
            </label>
            <button
              type="button"
              className="premium-login-link"
              data-cursor="hover"
              onClick={() => navigate("/forgot-password")}
            >
              Password dimenticata?
            </button>
          </div>

          {formError && <p className="premium-login-error premium-login-error--block">{formError}</p>}

          <button
            type="submit"
            data-cursor="hover"
            className={`premium-login-submit ${success ? "is-success" : ""}`}
            disabled={loading}
          >
            <span className="premium-login-submit-shimmer" aria-hidden />
            {loading ? (
              <span className="premium-login-loading">
                <FleetumLogoLoader size="sm" variant="dark" decorative className="fleetum-loader--button" />
                Accesso in corso...
              </span>
            ) : success ? (
              "✓ Accesso effettuato"
            ) : (
              "Accedi"
            )}
          </button>


          <p className="premium-login-signup-text">
            Non hai un account?
            <button
              type="button"
              data-cursor="hover"
              className="premium-login-link"
              onClick={() => navigate("/signup")}
            >
              Inizia gratis →
            </button>
          </p>
          <p className="premium-login-signup-text !mt-2 text-[11px] leading-5">
            Accedendo confermi di aver letto l'{" "}
            <Link className="premium-login-link" to="/privacy">
              informativa privacy
            </Link>
            .
          </p>
        </form>
      </div>
    </section>
  );
};
