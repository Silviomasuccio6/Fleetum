import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { authUseCases } from "../../../application/usecases/auth-usecases";
import { AccessShell, AccessNotice } from "../../components/layout/access-shell";
import { Button } from "../../components/ui/button";
import { getAccessLoginPath } from "./access-flow";

export const ForgotPasswordPage = () => {
  const location = useLocation();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false), completed = useRef(false), alive = useRef(true), returnToForm = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (!message && returnToForm.current) { returnToForm.current = false; document.getElementById("recovery-email")?.focus(); } }, [message]);
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (lock.current || completed.current) return;
    const form = new FormData(event.currentTarget), email = String(form.get("email") || "").trim();
    setFieldError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFieldError("Inserisci un indirizzo email valido."); setError("Inserisci un indirizzo email valido."); return; }
    lock.current = true; setBusy(true); setError(null); setMessage(null);
    try {
      await authUseCases.forgotPassword(email);
      if (!alive.current) return;
      completed.current = true;
      setMessage("Se l’indirizzo è associato a un account, riceverai un collegamento per reimpostare la password. Controlla anche la posta indesiderata.");
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <AccessShell title="Recupera la password" description="Indica l’email che usi per accedere a Fleetum.">
    {message ? <><AccessNotice tone="success" focus>{message}</AccessNotice><div className="access-actions"><Link className="access-link" to={getAccessLoginPath(location.search)}>Torna al login</Link><Button variant="outline" onClick={() => { returnToForm.current = true; completed.current = false; setMessage(null); }}>Usa un’altra email</Button></div></> : <form className="access-form" onSubmit={onSubmit} noValidate aria-busy={busy}>
      {error ? <AccessNotice focus>{error}</AccessNotice> : null}
      <fieldset className="access-fields" disabled={busy}><div className="access-field"><label htmlFor="recovery-email">Email di accesso</label><input id="recovery-email" name="email" type="email" autoComplete="email" inputMode="email" required aria-invalid={Boolean(fieldError)} aria-describedby={"recovery-email-hint" + (fieldError ? " recovery-email-error" : "")} onChange={() => { setFieldError(null); setError(null); }}/>{fieldError ? <p className="access-field-error" id="recovery-email-error">{fieldError}</p> : null}<p id="recovery-email-hint" className="access-hint">Usa lo stesso indirizzo della registrazione o dell’invito.</p></div><Button type="submit">{busy ? "Invio in corso…" : "Invia collegamento"}</Button></fieldset>
      <Link className="access-link" to={getAccessLoginPath(location.search)}>Torna al login</Link>
    </form>}
  </AccessShell>;
};
