export type CookieConsent = {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  version: string;
  acceptedAt: string;
};

export const COOKIE_CONSENT_STORAGE_KEY = "fleetum_cookie_consent_v1";
export const COOKIE_CONSENT_EVENT = "fleetum-cookie-consent";

export const readCookieConsent = (): CookieConsent | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const consent = JSON.parse(raw) as Partial<CookieConsent>;
    if (consent.necessary !== true || typeof consent.analytics !== "boolean" || typeof consent.marketing !== "boolean") return null;
    return consent as CookieConsent;
  } catch {
    return null;
  }
};

export const hasAnalyticsConsent = () => readCookieConsent()?.analytics === true;
