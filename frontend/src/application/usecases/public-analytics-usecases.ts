import { getApiBaseUrl } from "../../infrastructure/api/api-base-url";
import { COOKIE_CONSENT_EVENT, hasAnalyticsConsent, type CookieConsent } from "../../infrastructure/privacy/cookie-consent";

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
const attributionKey = "fleetum_public_attribution";

type Attribution = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
};

type PendingPageView = {
  metadata?: Record<string, unknown>;
};

let pendingPageView: PendingPageView | null = null;
let consentListenerBound = false;

const sessionId = () => {
  if (typeof window === "undefined") return undefined;
  const existing = window.sessionStorage.getItem(sessionKey);
  if (existing) return existing;
  const next = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.sessionStorage.setItem(sessionKey, next);
  return next;
};

const currentAttribution = (): Attribution => {
  if (typeof window === "undefined") return {};
  const url = new URL(window.location.href);
  const current: Attribution = {
    utmSource: url.searchParams.get("utm_source") || undefined,
    utmMedium: url.searchParams.get("utm_medium") || undefined,
    utmCampaign: url.searchParams.get("utm_campaign") || undefined
  };

  const hasCurrentAttribution = Object.values(current).some(Boolean);
  if (hasCurrentAttribution) {
    window.sessionStorage.setItem(attributionKey, JSON.stringify(current));
    return current;
  }

  try {
    const stored = window.sessionStorage.getItem(attributionKey);
    return stored ? (JSON.parse(stored) as Attribution) : {};
  } catch {
    return {};
  }
};

const safeReferrer = () => {
  if (typeof document === "undefined" || !document.referrer) return undefined;
  try {
    return new URL(document.referrer).origin;
  } catch {
    return undefined;
  }
};

const sendPublicEvent = (eventType: PublicAnalyticsEventType, metadata?: Record<string, unknown>) => {
  const attribution = currentAttribution();
  const payload = {
    eventType,
    path: window.location.pathname,
    referrer: safeReferrer(),
    utmSource: attribution.utmSource,
    utmMedium: attribution.utmMedium,
    utmCampaign: attribution.utmCampaign,
    sessionId: sessionId(),
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

const bindConsentListener = () => {
  if (typeof window === "undefined" || consentListenerBound) return;
  consentListenerBound = true;

  window.addEventListener(COOKIE_CONSENT_EVENT, (event) => {
    const consent = (event as CustomEvent<CookieConsent>).detail;
    if (!consent?.analytics || !pendingPageView) return;
    const queued = pendingPageView;
    pendingPageView = null;
    sendPublicEvent("PAGE_VIEW", queued.metadata);
  });
};

export const trackPublicEvent = (eventType: PublicAnalyticsEventType, metadata?: Record<string, unknown>) => {
  if (typeof window === "undefined") return;
  if (!hasAnalyticsConsent()) {
    if (eventType === "PAGE_VIEW") {
      pendingPageView = { metadata };
      bindConsentListener();
    }
    return;
  }

  sendPublicEvent(eventType, metadata);
};
