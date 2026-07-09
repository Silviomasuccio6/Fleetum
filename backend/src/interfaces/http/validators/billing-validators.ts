import { z } from "zod";

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const trackingIdSchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(8).max(160).regex(/^[a-zA-Z0-9._:-]+$/).optional()
);

const optionalTrackingText = (max: number) =>
  z.preprocess(
    emptyToUndefined,
    z.string().trim().max(max).transform((value) => value.replace(/[<>\r\n]/g, " ").replace(/\s+/g, " ").trim()).optional()
  );

const checkoutAnalyticsSchema = z.object({
  visitorId: trackingIdSchema,
  sessionId: trackingIdSchema,
  referrer: optionalTrackingText(500),
  utmSource: optionalTrackingText(120),
  utmMedium: optionalTrackingText(120),
  utmCampaign: optionalTrackingText(160),
  utmContent: optionalTrackingText(160),
  utmTerm: optionalTrackingText(160)
}).partial();

export const checkoutSessionSchema = z.object({
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]),
  billingCycle: z.enum(["monthly", "yearly"]).optional().default("monthly"),
  analytics: checkoutAnalyticsSchema.optional()
});

export const customerPortalSessionSchema = z.object({
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]).optional(),
  billingCycle: z.enum(["monthly", "yearly"]).optional()
}).refine(
  (value) => (!value.plan && !value.billingCycle) || (Boolean(value.plan) && Boolean(value.billingCycle)),
  {
    message: "Plan and billingCycle must be provided together",
    path: ["plan"]
  }
);

export const localCompleteSchema = z.object({
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]),
  billingCycle: z.enum(["monthly", "yearly"]).optional().default("monthly")
});
