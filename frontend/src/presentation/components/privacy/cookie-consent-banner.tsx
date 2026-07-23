import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  COOKIE_CONSENT_EVENT,
  COOKIE_CONSENT_STORAGE_KEY,
  type CookieConsent,
  readCookieConsent
} from "../../../infrastructure/privacy/cookie-consent";

const VERSION = "2026-05-17";

const saveConsent = (analytics: boolean, marketing: boolean) => {
  const consent: CookieConsent = {
    necessary: true,
    analytics,
    marketing,
    version: VERSION,
    acceptedAt: new Date().toISOString()
  };
  window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(consent));
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT, { detail: consent }));
};

export const CookieConsentBanner = () => {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    try {
      if (!readCookieConsent()) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const accept = (nextAnalytics: boolean, nextMarketing: boolean) => {
    saveConsent(nextAnalytics, nextMarketing);
    setVisible(false);
  };

  return (
    <section className="fleetum-cookie-banner" role="dialog" aria-live="polite" aria-label="Preferenze cookie Fleetum">
      <div>
        <span>Cookie e privacy</span>
        <h2>Usiamo solo ciò che serve, e ti lasciamo il controllo.</h2>
        <p>
          I cookie tecnici mantengono sicura la navigazione. Analytics e marketing restano spenti finché non li autorizzi.
          Leggi la <Link to="/cookie">Cookie Policy</Link>.
        </p>
        {expanded ? (
          <div className="fleetum-cookie-options">
            <label><input type="checkbox" checked disabled /> Necessari <small>sempre attivi</small></label>
            <label><input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} /> Analytics <small>misurazione traffico</small></label>
            <label><input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} /> Marketing <small>campagne e conversioni</small></label>
          </div>
        ) : null}
      </div>
      <div className="fleetum-cookie-actions">
        <button type="button" onClick={() => accept(false, false)}>Solo necessari</button>
        <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "Chiudi preferenze" : "Gestisci"}</button>
        <button type="button" className="is-primary" onClick={() => accept(expanded ? analytics : true, expanded ? marketing : true)}>Accetta</button>
      </div>
    </section>
  );
};
