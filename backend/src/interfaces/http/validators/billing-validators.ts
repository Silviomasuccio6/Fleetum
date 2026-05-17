import { z } from "zod";

export const checkoutSessionSchema = z.object({
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]),
  billingCycle: z.enum(["monthly", "yearly"]).optional().default("monthly")
});

export const localCompleteSchema = z.object({
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]),
  billingCycle: z.enum(["monthly", "yearly"]).optional().default("monthly")
});
