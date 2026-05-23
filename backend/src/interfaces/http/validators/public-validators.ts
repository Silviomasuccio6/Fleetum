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
    "LOGIN_CLICK",
    "PRICING_VIEW"
  ]),
  path: z.string().trim().min(1).max(240).transform((value) => value.replace(/[<>\r\n]/g, "")),
  referrer: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  utmSource: z.preprocess(emptyToUndefined, z.string().trim().max(120).optional()),
  utmMedium: z.preprocess(emptyToUndefined, z.string().trim().max(120).optional()),
  utmCampaign: z.preprocess(emptyToUndefined, z.string().trim().max(160).optional()),
  sessionId: z.preprocess(emptyToUndefined, z.string().trim().max(160).optional()),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type PublicAnalyticsEventInput = z.infer<typeof publicAnalyticsEventSchema>;
