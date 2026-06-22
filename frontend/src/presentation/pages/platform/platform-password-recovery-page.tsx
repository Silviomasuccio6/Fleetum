import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { platformAdminUseCases } from "../../../application/usecases/platform/platform-admin-usecases";
import { FleetumLogoLoader } from "../../components/brand/fleetum-logo-loader";
import "../../../features/auth/premium-login.css";

type RecoveryStep = "request" | "confirm";

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
    <path d="M10 8.75h.01M12 8.75h.01M14 8.75h.01M10 11.75h.01M12 11.75h.01M14 11.75h.01" />
  </svg>
);

export const PlatformPasswordRecoveryPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<RecoveryStep>("request");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const previousTheme = document.documentElement.getAttribute("data-theme");
    document.documentElement.setAttribute("data-theme", "light");
    return () => {
      if (previousTheme) document.documentElement.setAttribute("data-theme", previousTheme);
      else document.documentElement.removeAttribute("data-theme");
    };
  }, []);

  const requestCode = async () => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const result = await platformAdminUseCases.requestPasswordReset(email.trim());
      setNotice(result.message);
      setOtp("");
      setStep("confirm");
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) {
      setError("Inserisci l'email amministratore.");
      return;
    }
    await requestCode();
  };

  const onConfirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (otp.length !== 6) {
      setError("Inserisci il codice OTP di 6 cifre.");
      return;
    }
    if (newPassword.length < 16) {
      setError("La nuova password deve contenere almeno 16 caratteri.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Le password non coincidono.");
      return;
    }

    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const result = await platformAdminUseCases.confirmPasswordReset({ email: email.trim(), otp, newPassword });
      if (!result.token) {
        throw new Error("Password aggiornata, ma la sessione Platform non e disponibile. Accedi con le nuove credenziali.");
      }
      setNotice(result.message);
      setNewPassword("");
      setConfirmPassword("");
      navigate("/console", { replace: true });
    } catch (confirmError) {
      setError((confirmError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const heading = "Recupera password Platform";
  const description = step === "request"
    ? "Inserisci l'email amministratore per ricevere il codice OTP."
    : "Inserisci il codice ricevuto e scegli una nuova password sicura.";

  return (
    <div className="premium-login-root premium-login-root--clean">
      <main className="premium-login-auth-shell">
        <div className="premium-login-card-wrap">
          <section className="premium-login-card">
            <header className="premium-login-card-head">
              <img className="premium-login-card-logo premium-login-card-logo--image" src="/brand/fleetum-symbol-color.svg" alt="Fleetum" />
              <h2>{heading}</h2>
              <p>{description}</p>
            </header>

            {step === "request" ? (
              <form className="premium-login-form" onSubmit={onRequest}>
                <label className="premium-login-field-label" htmlFor="platform-recovery-email">Email amministratore</label>
                <div className={`premium-login-field ${email.includes("@") ? "is-ok" : ""}`}>
                  <span className="premium-login-field-icon-wrap"><MailIcon /></span>
                  <input id="platform-recovery-email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@azienda.it" required autoFocus />
                </div>
                {error ? <p className="premium-login-error premium-login-error--block" role="alert">{error}</p> : null}
                <button className="premium-login-submit" type="submit" disabled={loading}>
                  <span className="premium-login-submit-shimmer" />
                  {loading ? <span className="premium-login-loading"><FleetumLogoLoader size="sm" variant="dark" decorative className="fleetum-loader--button" />Invio codice...</span> : "Invia codice OTP"}
                </button>
                <button className="premium-login-secondary-action" type="button" onClick={() => navigate("/login")} disabled={loading}>Torna al login</button>
              </form>
            ) : null}

            {step === "confirm" ? (
              <form className="premium-login-form" onSubmit={onConfirm}>
                <div className="premium-login-otp-panel">
                  <span className="premium-login-otp-kicker">Verifica identita</span>
                  <strong>Codice inviato a {email}</strong>
                  <p>Il codice e monouso e scade dopo 8 minuti.</p>
                </div>
                <label className="premium-login-field-label" htmlFor="platform-recovery-otp">Codice OTP</label>
                <div className="premium-login-field premium-login-field--otp">
                  <span className="premium-login-field-icon-wrap"><OtpIcon /></span>
                  <input id="platform-recovery-otp" name="otp" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" autoComplete="one-time-code" required autoFocus />
                </div>
                <label className="premium-login-field-label" htmlFor="platform-recovery-password">Nuova password</label>
                <div className="premium-login-field">
                  <span className="premium-login-field-icon-wrap"><LockIcon /></span>
                  <input id="platform-recovery-password" name="newPassword" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Almeno 16 caratteri" minLength={16} required />
                </div>
                <label className="premium-login-field-label" htmlFor="platform-recovery-password-confirm">Conferma nuova password</label>
                <div className="premium-login-field">
                  <span className="premium-login-field-icon-wrap"><LockIcon /></span>
                  <input id="platform-recovery-password-confirm" name="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Ripeti la nuova password" minLength={16} required />
                </div>
                {notice ? <p className="premium-login-success premium-login-error--block" role="status">{notice}</p> : null}
                {error ? <p className="premium-login-error premium-login-error--block" role="alert">{error}</p> : null}
                <button className="premium-login-submit" type="submit" disabled={loading || otp.length !== 6}>
                  <span className="premium-login-submit-shimmer" />
                  {loading ? <span className="premium-login-loading"><FleetumLogoLoader size="sm" variant="dark" decorative className="fleetum-loader--button" />Aggiornamento...</span> : "Aggiorna password"}
                </button>
                <button className="premium-login-secondary-action" type="button" onClick={requestCode} disabled={loading}>Invia un nuovo codice</button>
                <button className="premium-login-secondary-action" type="button" onClick={() => setStep("request")} disabled={loading}>Cambia email</button>
              </form>
            ) : null}

          </section>
        </div>
      </main>
    </div>
  );
};
