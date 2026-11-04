import { z } from "zod";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

export const slaSettingsSchema = z.object({
  LOW: z.coerce.number().int().min(1).max(365),
  MEDIUM: z.coerce.number().int().min(1).max(365),
  HIGH: z.coerce.number().int().min(1).max(365),
  CRITICAL: z.coerce.number().int().min(1).max(365)
});

export const playbooksSettingsSchema = z.object({
  WAITING_PARTS: z.object({
    enabled: z.coerce.boolean().default(false),
    reminderEveryDays: z.coerce.number().int().min(1).max(60)
  }),
  SOLICITED: z.object({
    enabled: z.coerce.boolean().default(false),
    reminderEveryDays: z.coerce.number().int().min(1).max(60)
  })
});

export const reportsSettingsSchema = z.object({
  enabled: z.coerce.boolean().default(false),
  recipients: z.array(z.string().email()).max(50),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  hour: z.coerce.number().int().min(0).max(23),
  minute: z.coerce.number().int().min(0).max(59),
  reportStyle: z.enum(["EXECUTIVE", "BASIC"])
});

export const integrationsSettingsSchema = z.object({
  erpWebhookUrl: z.preprocess(emptyToUndefined, z.string().url().max(2000).optional()).transform((value) => value ?? ""),
  telematicsWebhookUrl: z.preprocess(emptyToUndefined, z.string().url().max(2000).optional()).transform((value) => value ?? ""),
  ticketingWebhookUrl: z.preprocess(emptyToUndefined, z.string().url().max(2000).optional()).transform((value) => value ?? "")
});
