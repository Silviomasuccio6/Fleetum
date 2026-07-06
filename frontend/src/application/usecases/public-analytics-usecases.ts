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
  | "ONBOARDING_COMPANY_COMPLETED"
  | "STRIPE_CHECKOUT_STARTED"
  | "STRIPE_CHECKOUT_COMPLETED"
  | "STRIPE_CHECKOUT_FAILED"
  | "LOGIN_CLICK"
  | "PRICING_VIEW";

const sessionKey = "fleetum_public_session";
const visitorKey = "fleetum_public_visitor";
const attributionKey = "fleetum_public_attribution";

type Attribution = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
};

type PendingPageView = {
  metadata?: Record<string, unknown>;
};

let pendingPageView: PendingPageView | null = null;
let consentListenerBound = false;
let lastPageViewFingerprint = "";
let lastPageViewAt = 0;

const newTrackingId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const getOrCreatePublicVisitorId = () => {
  if (typeof window === "undefined") return undefined;
  const existing = window.localStorage.getItem(visitorKey);
  if (existing) return existing;
  const next = newTrackingId();
  window.localStorage.setItem(visitorKey, next);
  return next;
};

const sessionId = () => {
  if (typeof window === "undefined") return undefined;
  const existing = window.sessionStorage.getItem(sessionKey);
  if (existing) return existing;
  const next = newTrackingId();
  window.sessionStorage.setItem(sessionKey, next);
  return next;
};

const currentAttribution = (): Attribution => {
  if (typeof window === "undefined") return {};
  const url = new URL(window.location.href);
  const current: Attribution = {
    utmSource: url.searchParams.get("utm_source") || undefined,
    utmMedium: url.searchParams.get("utm_medium") || undefined,
    utmCampaign: url.searchParams.get("utm_campaign") || undefined,
    utmContent: url.searchParams.get("utm_content") || undefined,
    utmTerm: url.searchParams.get("utm_term") || undefined
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

const isDoNotTrackEnabled = () =>
  typeof navigator !== "undefined" && (navigator.doNotTrack === "1" || (window as Window & { doNotTrack?: string }).doNotTrack === "1");

export const getPublicAnalyticsContext = () => {
  const attribution = currentAttribution();
  return {
    visitorId: getOrCreatePublicVisitorId(),
    sessionId: sessionId(),
    referrer: safeReferrer(),
    utmSource: attribution.utmSource,
    utmMedium: attribution.utmMedium,
    utmCampaign: attribution.utmCampaign,
    utmContent: attribution.utmContent,
    utmTerm: attribution.utmTerm
  };
};

const sendPublicEvent = (eventType: PublicAnalyticsEventType, metadata?: Record<string, unknown>) => {
  if (isDoNotTrackEnabled()) return;
  const context = getPublicAnalyticsContext();
  const payload = {
    eventType,
    path: window.location.pathname,
    ...context,
    consentAnalytics: true,
    metadata
  };

  const url = `${getApiBaseUrl()}/public/analytics/event`;
  const body = JSON.stringify(payload);

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const sent = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    if (sent) return;
  }

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
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

  if (eventType === "PAGE_VIEW") {
    const fingerprint = `${window.location.pathname}:${JSON.stringify(metadata ?? {})}`;
    const now = Date.now();
    if (fingerprint === lastPageViewFingerprint && now - lastPageViewAt < 1200) return;
    lastPageViewFingerprint = fingerprint;
    lastPageViewAt = now;
  }

  sendPublicEvent(eventType, metadata);
};
