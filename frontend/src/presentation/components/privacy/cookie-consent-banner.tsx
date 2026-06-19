import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { trackPublicEvent } from "../../../application/usecases/public-analytics-usecases";
import {
  COOKIE_PREFERENCES_OPEN_EVENT,
  readCookieConsent,
  saveCookieConsent
} from "../../../shared/privacy/cookie-consent";
import "./cookie-consent-banner.css";

export const CookieConsentBanner = () => {
  const [visible, setVisible] = useState(() => !readCookieConsent());
  const [expanded, setExpanded] = useState(false);
  const [analytics, setAnalytics] = useState(() => readCookieConsent()?.analytics ?? false);
  const [marketing, setMarketing] = useState(() => readCookieConsent()?.marketing ?? false);

  useEffect(() => {
    const openPreferences = () => {
      const consent = readCookieConsent();
      setAnalytics(consent?.analytics ?? false);
      setMarketing(consent?.marketing ?? false);
      setExpanded(true);
      setVisible(true);
    };

    window.addEventListener(COOKIE_PREFERENCES_OPEN_EVENT, openPreferences);
    return () => window.removeEventListener(COOKIE_PREFERENCES_OPEN_EVENT, openPreferences);
  }, []);

  if (!visible) return null;

  const accept = (nextAnalytics: boolean, nextMarketing: boolean) => {
    const consent = saveCookieConsent({ analytics: nextAnalytics, marketing: nextMarketing });
    if (consent.analytics) {
      trackPublicEvent("PAGE_VIEW", { source: "cookie_consent_granted" });
    }
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
        <button type="button" className="is-necessary" onClick={() => accept(false, false)}>Solo necessari</button>
        <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "Chiudi preferenze" : "Gestisci"}</button>
        <button type="button" className="is-primary" onClick={() => accept(expanded ? analytics : true, expanded ? marketing : true)}>Accetta tutto</button>
      </div>
    </section>
  );
};
