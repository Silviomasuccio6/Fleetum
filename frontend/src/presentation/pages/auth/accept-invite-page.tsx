import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { authUseCases } from "../../../application/usecases/auth-usecases";
import { AccessShell, AccessNotice, AccessPassword } from "../../components/layout/access-shell";
import { Button } from "../../components/ui/button";
import { clearConsumedAccessToken, getAccessLoginPath, passwordRequirements, validateAccessPassword } from "./access-flow";

export const AcceptInvitePage = () => {
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
      const firstName = String(form.get("firstName") || "").trim(), lastName = String(form.get("lastName") || "").trim();
      if (firstName.length < 2) nextErrors.firstName = "Inserisci un nome di almeno 2 caratteri.";
      if (lastName.length < 2) nextErrors.lastName = "Inserisci un cognome di almeno 2 caratteri.";
    setFieldErrors(nextErrors); setError(null);
    if (Object.keys(nextErrors).length) { setError("Controlla i campi evidenziati prima di continuare."); return; }
    lock.current = true; setBusy(true);
    try {
      await authUseCases.acceptInvite({ token, password, firstName, lastName });
      if (!alive.current || currentToken.current !== token) return;
      completed.current = true; formElement.reset();
      try { clearConsumedAccessToken(location.search); } catch { /* A consumed token cannot be replayed even if history is unavailable. */ }
      setMessage("Invito accettato. Il tuo account è pronto per l’accesso.");
    } catch (e) {
      if (!alive.current || currentToken.current !== token) return;
      if ((e as {code?:string}).code === "INVALID_INVITE") { completed.current = true; setLinkUnavailable(true); setError(null); }
      else setError((e as Error).message);
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <AccessShell title="Accetta l’invito" description="Conferma i tuoi dati per accedere all’azienda che ti ha invitato.">
    {message ? <><AccessNotice tone="success" focus>{message}</AccessNotice><Link className="access-link" to={getAccessLoginPath(location.search)}>Torna al login</Link></> : linkUnavailable ? <><AccessNotice focus>Questo invito non è valido o è scaduto. Chiedi un nuovo invito all’amministratore della tua azienda.</AccessNotice><div className="access-actions"><Link className="access-link" to={getAccessLoginPath(location.search)}>Torna al login</Link></div></> : <form className="access-form" onSubmit={onSubmit} noValidate aria-busy={busy}>
      {error ? <AccessNotice focus>{error}</AccessNotice> : null}
      <fieldset className="access-fields" disabled={busy}><div className="access-field"><label htmlFor="invite-firstName">Nome</label><input id="invite-firstName" name="firstName" autoComplete="given-name" required minLength={2} aria-invalid={Boolean(fieldErrors.firstName)} aria-describedby={fieldErrors.firstName ? "invite-firstName-error" : undefined}/>{fieldErrors.firstName ? <p className="access-field-error" id="invite-firstName-error">{fieldErrors.firstName}</p> : null}</div><div className="access-field"><label htmlFor="invite-lastName">Cognome</label><input id="invite-lastName" name="lastName" autoComplete="family-name" required minLength={2} aria-invalid={Boolean(fieldErrors.lastName)} aria-describedby={fieldErrors.lastName ? "invite-lastName-error" : undefined}/>{fieldErrors.lastName ? <p className="access-field-error" id="invite-lastName-error">{fieldErrors.lastName}</p> : null}</div>
        <AccessPassword id="invite-password" error={fieldErrors.password} description={passwordRequirements}/>
        <AccessPassword id="invite-confirmPassword" name="confirmPassword" label="Conferma password" error={fieldErrors.confirmPassword}/>
        <Button type="submit">{busy ? "Salvataggio in corso…" : "Attiva account"}</Button>
      </fieldset>
      <Link className="access-link" to={getAccessLoginPath(location.search)}>Torna al login</Link>
    </form>}
  </AccessShell>;
};
