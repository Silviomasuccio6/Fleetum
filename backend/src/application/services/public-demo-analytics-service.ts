import { Prisma } from "@prisma/client";
import type { PublicDemoRequestInput } from "../../interfaces/http/validators/public-validators.js";
import { privacyHash } from "../../shared/utils/privacy-hash.js";

const detectDevice = (userAgent = "") => {
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return "tablet";
  if (/mobile|iphone|android/.test(ua)) return "mobile";
  if (!ua) return "unknown";
  return "desktop";
};

const detectBrowser = (userAgent = "") => {
  const ua = userAgent.toLowerCase();
  if (ua.includes("edg/")) return "Edge";
  if (ua.includes("chrome/") && !ua.includes("chromium")) return "Chrome";
  if (ua.includes("safari/") && !ua.includes("chrome/")) return "Safari";
  if (ua.includes("firefox/")) return "Firefox";
  return "Other";
};

export const buildConsentedDemoAnalyticsEvent = (input: {
  input: PublicDemoRequestInput;
  leadId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Prisma.WebsiteEventUncheckedCreateInput | null => {
  if (!input.input.consentAnalytics) return null;

  const userAgent = input.userAgent ?? "";
  return {
    eventType: "DEMO_FORM_SUBMIT",
    path: "/demo",
    referrer: input.input.referrer,
    utmSource: input.input.utmSource,
    utmMedium: input.input.utmMedium,
    utmCampaign: input.input.utmCampaign,
    utmContent: input.input.utmContent,
    utmTerm: input.input.utmTerm,
    consentAnalytics: true,
    visitorId: input.input.visitorId ? privacyHash(input.input.visitorId) : undefined,
    sessionId: input.input.sessionId ? privacyHash(input.input.sessionId) : undefined,
    ipHash: privacyHash(input.ip),
    userAgentHash: privacyHash(userAgent),
    deviceType: detectDevice(userAgent),
    browser: detectBrowser(userAgent),
    metadata: {
      source: input.input.source,
      leadId: input.leadId,
      consentVersion: "cookie-preferences-v1"
    } as Prisma.InputJsonObject
  };
};
