import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./cookie-consent-banner.css";

type Consent = {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  version: string;
  acceptedAt: string;
};

const STORAGE_KEY = "fleetum_cookie_consent_v1";
const VERSION = "2026-05-17";

const saveConsent = (analytics: boolean, marketing: boolean) => {
  const consent: Consent = {
    necessary: true,
    analytics,
    marketing,
    version: VERSION,
    acceptedAt: new Date().toISOString()
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
  window.dispatchEvent(new CustomEvent("fleetum-cookie-consent", { detail: consent }));
};

export const CookieConsentBanner = () => {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) setVisible(true);
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
        <h2>Usiamo solo cio che serve, e ti lasciamo il controllo.</h2>
        <p>
          I cookie tecnici mantengono sicura la navigazione. Analytics e marketing restano spenti finche non li autorizzi.
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
