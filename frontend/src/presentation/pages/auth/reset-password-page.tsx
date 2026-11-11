import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { authUseCases } from "../../../application/usecases/auth-usecases";
import { AccessShell, AccessNotice, AccessPassword } from "../../components/layout/access-shell";
import { Button } from "../../components/ui/button";
import { clearConsumedAccessToken, getAccessLoginPath, passwordRequirements, validateAccessPassword } from "./access-flow";

export const ResetPasswordPage = () => {
  const [params] = useSearchParams(), location = useLocation();
  const token = useMemo(() => params.get("token") || "", [params]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkUnavailable, setLinkUnavailable] = useState(token.length < 10);
  const [fieldErrors, setFieldErrors] = useState<Record<string,string>>({});
  const lock = useRef(false), completed = useRef(false), alive = useRef(true), currentToken = useRef(token);
  currentToken.current = token;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { completed.current = false; setMessage(null); setError(null); setFieldErrors({}); setLinkUnavailable(token.length < 10); }, [token]);
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (lock.current || completed.current || token.length < 10 || linkUnavailable) return;
    const formElement = event.currentTarget, form = new FormData(formElement);
    const password = String(form.get("password") || ""), confirmation = String(form.get("confirmPassword") || "");
    const nextErrors = validateAccessPassword(password, confirmation);
    setFieldErrors(nextErrors); setError(null);
    if (Object.keys(nextErrors).length) { setError("Controlla i campi evidenziati prima di continuare."); return; }
    lock.current = true; setBusy(true);
    try {
      await authUseCases.resetPassword({ token, newPassword: password });
      if (!alive.current || currentToken.current !== token) return;
      completed.current = true; formElement.reset();
      try { clearConsumedAccessToken(location.search); } catch { /* A consumed token cannot be replayed even if history is unavailable. */ }
      setMessage("Password aggiornata. Puoi accedere con la nuova password.");
    } catch (e) {
      if (!alive.current || currentToken.current !== token) return;
      if ((e as {code?:string}).code === "INVALID_TOKEN") { completed.current = true; setLinkUnavailable(true); setError(null); }
      else setError((e as Error).message);
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <AccessShell title="Imposta la nuova password" description="Scegli una password diversa da quella usata in precedenza.">
    {message ? <><AccessNotice tone="success" focus>{message}</AccessNotice><Link className="access-link" to={getAccessLoginPath(location.search)}>Torna al login</Link></> : linkUnavailable ? <><AccessNotice focus>Questo collegamento di recupero non è valido o è scaduto. Richiedine uno nuovo.</AccessNotice><div className="access-actions"><Link className="access-link" to={getAccessLoginPath(location.search).replace("/login", "/forgot-password")}>Richiedi un nuovo collegamento</Link><Link className="access-link" to={getAccessLoginPath(location.search)}>Torna al login</Link></div></> : <form className="access-form" onSubmit={onSubmit} noValidate aria-busy={busy}>
      {error ? <AccessNotice focus>{error}</AccessNotice> : null}
      <fieldset className="access-fields" disabled={busy}>
        <AccessPassword id="reset-password" error={fieldErrors.password} description={passwordRequirements}/>
        <AccessPassword id="reset-confirmPassword" name="confirmPassword" label="Conferma password" error={fieldErrors.confirmPassword}/>
        <Button type="submit">{busy ? "Salvataggio in corso…" : "Aggiorna password"}</Button>
      </fieldset>
      <Link className="access-link" to={getAccessLoginPath(location.search)}>Torna al login</Link>
    </form>}
  </AccessShell>;
};
