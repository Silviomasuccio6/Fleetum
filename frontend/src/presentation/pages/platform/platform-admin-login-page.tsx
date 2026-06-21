import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { platformAdminUseCases } from "../../../application/usecases/platform/platform-admin-usecases";
import { FleetumLogoLoader } from "../../components/brand/fleetum-logo-loader";
import "../../../features/auth/premium-login.css";

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

const OtpIcon = () => (
  <svg className="premium-login-field-icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M7.75 5.75h8.5v12.5h-8.5V5.75Z" />
    <path d="M10 8.75h.01M12 8.75h.01M14 8.75h.01M10 11.75h.01M12 11.75h.01M14 11.75h.01M10 14.75h.01M12 14.75h.01M14 14.75h.01" />
  </svg>
);

const platformEmail = "info@fleetum.it";

export const PlatformAdminLoginPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState(platformEmail);
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [otpRequested, setOtpRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const previousTheme = document.documentElement.getAttribute("data-theme");
    document.documentElement.setAttribute("data-theme", "light");

    return () => {
      if (previousTheme) {
        document.documentElement.setAttribute("data-theme", previousTheme);
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    };
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!otpRequested && (!email.trim() || !password.trim())) {
      setError("Inserisci email e password.");
      setShake(true);
      window.setTimeout(() => setShake(false), 420);
      return;
    }

    if (otpRequested && otp.trim().length !== 6) {
      setError("Inserisci il codice OTP di 6 cifre ricevuto via email.");
      setShake(true);
      window.setTimeout(() => setShake(false), 420);
      return;
    }

    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      const normalizedOtp = otp.trim();
      const result = await platformAdminUseCases.login({ email, password, otp: normalizedOtp ? normalizedOtp : undefined });
      if (result?.requiresOtp) {
        setOtpRequested(true);
        setNotice(result.message ?? "Codice OTP inviato alla mail platform.");
        setOtp("");
        return;
      }
      navigate("/console");
    } catch (e) {
      setError((e as Error).message);
      setShake(true);
      window.setTimeout(() => setShake(false), 420);
    } finally {
      setLoading(false);
    }
  };

  const backToCredentials = () => {
    setOtpRequested(false);
    setOtp("");
    setNotice(null);
    setError(null);
  };

  return (
    <div className="premium-login-root premium-login-root--clean">
      <main className="premium-login-auth-shell">
        <div className="premium-login-card-wrap">
          <section className={`premium-login-card ${shake ? "animate-shake" : ""}`}>
            <header className="premium-login-card-head">
              <img className="premium-login-card-logo premium-login-card-logo--image" src="/brand/fleetum-symbol-color.svg" alt="Fleetum" />
              <h2>Login Console Platform</h2>
              <p>{otpRequested ? "Inserisci il codice ricevuto sulla mail founder" : "Accedi all'area riservata amministrativa"}</p>
            </header>

            <form className="premium-login-form" onSubmit={onSubmit}>
              {otpRequested ? (
                <>
                  <div className="premium-login-otp-panel">
                    <span className="premium-login-otp-kicker">Step 2 · Verifica identità</span>
                    <strong>Codice inviato a {platformEmail}</strong>
                    <p>Controlla la casella email e inserisci il codice a 6 cifre. Scade dopo pochi minuti.</p>
                  </div>

                  <label className="premium-login-field-label" htmlFor="platform-otp">
                    Codice OTP email
                  </label>
                  <div className="premium-login-field premium-login-field--otp">
                    <span className="premium-login-field-icon-wrap"><OtpIcon /></span>
                    <input
                      id="platform-otp"
                      name="otp"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="123456"
                      autoComplete="one-time-code"
                      autoFocus
                      required
                    />
                  </div>
                </>
              ) : (
                <>
                  <label className="premium-login-field-label" htmlFor="platform-email">
                    Email admin
                  </label>
                  <div className={`premium-login-field ${email && email.includes("@") ? "is-ok" : ""}`}>
                    <span className="premium-login-field-icon-wrap"><MailIcon /></span>
                    <input
                      id="platform-email"
                      name="email"
                      type="email"
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={platformEmail}
                      required
                    />
                  </div>

                  <label className="premium-login-field-label" htmlFor="platform-password">
                    Password
                  </label>
                  <div className={`premium-login-field ${error ? "is-error" : ""}`}>
                    <span className="premium-login-field-icon-wrap"><LockIcon /></span>
                    <input
                      id="platform-password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••"
                      required
                    />
                  </div>
                </>
              )}

              {notice ? <p className="premium-login-success premium-login-error--block">{notice}</p> : null}
              {error ? <p className="premium-login-error premium-login-error--block">{error}</p> : null}

              <button className="premium-login-submit" type="submit" disabled={loading || (otpRequested && otp.length !== 6)}>
                <span className="premium-login-submit-shimmer" />
                {loading ? (
                  <span className="premium-login-loading">
                    <FleetumLogoLoader size="sm" variant="dark" decorative className="fleetum-loader--button" />
                    {otpRequested ? "Verifica codice..." : "Invio codice..."}
                  </span>
                ) : (
                  otpRequested ? "Verifica OTP e accedi" : "Invia codice OTP"
                )}
              </button>

              {otpRequested ? (
                <button className="premium-login-secondary-action" type="button" onClick={backToCredentials} disabled={loading}>
                  Cambia email o password
                </button>
              ) : (
                <button className="premium-login-secondary-action" type="button" onClick={() => navigate("/password-recovery")} disabled={loading}>
                  Password dimenticata?
                </button>
              )}
            </form>
          </section>
        </div>
      </main>
    </div>
  );
};
