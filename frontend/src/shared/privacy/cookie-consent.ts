export type CookieConsent = {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  version: string;
  acceptedAt: string;
};

export const COOKIE_CONSENT_STORAGE_KEY = "fleetum_cookie_consent_v1";
export const COOKIE_CONSENT_VERSION = "2026-06-19";
export const COOKIE_CONSENT_CHANGE_EVENT = "fleetum-cookie-consent";
export const COOKIE_PREFERENCES_OPEN_EVENT = "fleetum-open-cookie-preferences";

const isCookieConsent = (value: unknown): value is CookieConsent => {
  if (!value || typeof value !== "object") return false;
  const consent = value as Record<string, unknown>;
  return (
    consent.necessary === true &&
    typeof consent.analytics === "boolean" &&
    typeof consent.marketing === "boolean" &&
    consent.version === COOKIE_CONSENT_VERSION &&
    typeof consent.acceptedAt === "string" &&
    consent.acceptedAt.length > 0
  );
};

export const parseCookieConsent = (raw: string | null): CookieConsent | null => {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isCookieConsent(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const readCookieConsent = (): CookieConsent | null => {
  if (typeof window === "undefined") return null;
  try {
    return parseCookieConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY));
  } catch {
    return null;
  }
};

export const saveCookieConsent = (input: Pick<CookieConsent, "analytics" | "marketing">): CookieConsent => {
  const consent: CookieConsent = {
    necessary: true,
    analytics: input.analytics,
    marketing: input.marketing,
    version: COOKIE_CONSENT_VERSION,
    acceptedAt: new Date().toISOString()
  };

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(consent));
    } catch {
      // The current page remains usable even when browser storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_CHANGE_EVENT, { detail: consent }));
  }

  return consent;
};

export const hasAnalyticsConsent = () => readCookieConsent()?.analytics === true;

export const openCookiePreferences = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(COOKIE_PREFERENCES_OPEN_EVENT));
  }
};
