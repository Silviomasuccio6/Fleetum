import { z } from "zod";

const cleanText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .transform((value) => value.replace(/[<>\r\n]/g, " ").replace(/\s+/g, " ").trim());

const optionalCleanText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value.replace(/[<>\r\n]/g, " ").replace(/\s+/g, " ").trim() : undefined));

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const trackingIdSchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(8).max(160).regex(/^[a-zA-Z0-9._:-]+$/).optional()
);

const optionalTrackingText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).transform((value) => value.replace(/[<>\r\n]/g, " ").replace(/\s+/g, " ").trim()).optional());

const analyticsMetadataSchema = z
  .record(z.union([z.string().trim().max(240), z.number().finite(), z.boolean(), z.null()]))
  .optional()
  .refine((value) => !value || Object.keys(value).length <= 20, "Troppi campi metadata analytics")
  .refine((value) => !value || JSON.stringify(value).length <= 2000, "Metadata analytics troppo grande");

export const publicDemoRequestSchema = z.object({
  companyName: cleanText(120),
  fullName: cleanText(100),
  email: z.string().trim().email().max(160).transform((value) => value.toLowerCase()),
  phone: optionalCleanText(40),
  fleetSize: z.preprocess(emptyToUndefined, z.enum(["1-10", "11-30", "31-80", "80+"]).optional()),
  message: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(1200).optional().transform((value) => value?.replace(/[<>]/g, "").trim())
  ),
  source: z.string().trim().max(80).optional().default("fleetum.it"),
  referrer: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  utmSource: z.preprocess(emptyToUndefined, z.string().trim().max(120).optional()),
  utmMedium: z.preprocess(emptyToUndefined, z.string().trim().max(120).optional()),
  utmCampaign: z.preprocess(emptyToUndefined, z.string().trim().max(160).optional()),
  utmContent: z.preprocess(emptyToUndefined, z.string().trim().max(160).optional()),
  utmTerm: z.preprocess(emptyToUndefined, z.string().trim().max(160).optional()),
  visitorId: trackingIdSchema,
  sessionId: trackingIdSchema,
  websiteUrl: z.string().trim().max(0).optional()
});

export type PublicDemoRequestInput = z.infer<typeof publicDemoRequestSchema>;

export const publicAnalyticsEventSchema = z.object({
  eventType: z.enum([
    "PAGE_VIEW",
    "CTA_CLICK",
    "DEMO_FORM_VIEW",
    "DEMO_FORM_SUBMIT",
    "SIGNUP_VIEW",
    "SIGNUP_STARTED",
    "SIGNUP_COMPLETED",
    "ONBOARDING_COMPANY_COMPLETED",
    "STRIPE_CHECKOUT_STARTED",
    "STRIPE_CHECKOUT_COMPLETED",
    "STRIPE_CHECKOUT_FAILED",
    "TRIAL_ACTIVATED",
    "LOGIN_CLICK",
    "PRICING_VIEW"
  ]),
  path: z.string().trim().min(1).max(240).transform((value) => value.replace(/[<>\r\n]/g, "")),
  referrer: optionalTrackingText(500),
  utmSource: optionalTrackingText(120),
  utmMedium: optionalTrackingText(120),
  utmCampaign: optionalTrackingText(160),
  utmContent: optionalTrackingText(160),
  utmTerm: optionalTrackingText(160),
  visitorId: trackingIdSchema,
  sessionId: trackingIdSchema,
  consentAnalytics: z.boolean().default(false),
  metadata: analyticsMetadataSchema
});

export type PublicAnalyticsEventInput = z.infer<typeof publicAnalyticsEventSchema>;
