import { getApiBaseUrl } from "../../infrastructure/api/api-base-url";
import { readCookieConsent } from "../../shared/privacy/cookie-consent";

export type PublicAnalyticsEventType =
  | "PAGE_VIEW"
  | "CTA_CLICK"
  | "DEMO_FORM_VIEW"
  | "DEMO_FORM_SUBMIT"
  | "SIGNUP_VIEW"
  | "SIGNUP_STARTED"
  | "SIGNUP_COMPLETED"
  | "LOGIN_CLICK"
  | "PRICING_VIEW";

const sessionKey = "fleetum_public_session";

const sessionId = () => {
  if (typeof window === "undefined") return undefined;
  const existing = window.sessionStorage.getItem(sessionKey);
  if (existing) return existing;
  const next = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.sessionStorage.setItem(sessionKey, next);
  return next;
};

export const trackPublicEvent = (eventType: PublicAnalyticsEventType, metadata?: Record<string, unknown>) => {
  if (typeof window === "undefined") return;
  const consent = readCookieConsent();
  if (!consent?.analytics) return;

  const url = new URL(window.location.href);
  const payload = {
    eventType,
    path: window.location.pathname,
    referrer: document.referrer || undefined,
    utmSource: url.searchParams.get("utm_source") || undefined,
    utmMedium: url.searchParams.get("utm_medium") || undefined,
    utmCampaign: url.searchParams.get("utm_campaign") || undefined,
    sessionId: sessionId(),
    consentVersion: consent.version,
    metadata
  };

  fetch(`${getApiBaseUrl()}/public/analytics/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(() => {
    // Analytics non deve mai bloccare navigazione o form pubblici.
  });
};
