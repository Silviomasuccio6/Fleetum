import { z } from "zod";

export const tenantIdSchema = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
export const invoiceIdSchema = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);

export const platformLoginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(12).max(256),
  otp: z.string().trim().regex(/^\d{6}$/).optional()
});

export const updateLicenseSchema = z.object({
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]),
  seats: z.number().int().min(1).max(10000),
  status: z.enum(["ACTIVE", "SUSPENDED", "EXPIRED", "TRIAL", "PAST_DUE", "CANCELED"]),
  expiresAt: z.string().datetime().nullable().optional(),
  priceMonthly: z.number().positive().max(1_000_000).nullable().optional(),
  billingCycle: z.enum(["monthly", "yearly"]).optional()
});

export const updateTenantStatusSchema = z.object({
  isActive: z.boolean()
});

export const quickLicenseActionSchema = z.object({
  action: z.enum([
    "ACTIVATE_LICENSE",
    "SUSPEND_LICENSE",
    "TRIAL_14_DAYS",
    "RENEW_30_DAYS",
    "RENEW_365_DAYS",
    "DEACTIVATE_TENANT",
    "REACTIVATE_TENANT"
  ])
});

export const updateInvoiceStatusSchema = z.object({
  status: z.enum(["DRAFT", "GENERATED", "SENT", "PAID", "OVERDUE", "VOID", "ERROR"])
});

export const recentEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const revenueReportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  months: z.coerce.number().int().min(2).max(12).default(12)
});
