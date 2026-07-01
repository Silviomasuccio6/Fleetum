import { z } from "zod";

export const rentalPaymentIdParamSchema = z.string().trim().min(1).max(128);

export const rentalPaymentSetupSessionSchema = z.object({
  mandateAccepted: z.literal(true, {
    errorMap: () => ({ message: "Devi accettare il mandato per registrare la carta del cliente." })
  }),
  termsVersion: z.string().trim().min(1).max(80)
});

export const rentalDepositCreateSchema = z.object({
  paymentMethodId: z.string().trim().min(1).max(128),
  amountCents: z.coerce.number().int().min(1).max(100_000_000)
});

export const rentalDepositCaptureSchema = z.object({
  amountToCaptureCents: z.coerce.number().int().min(1).max(100_000_000).optional()
});

export const rentalExtraChargeTypeSchema = z.enum([
  "FINE",
  "DAMAGE",
  "DEDUCTIBLE",
  "FUEL",
  "TOLL",
  "LATE_RETURN",
  "CLEANING",
  "MISSING_ACCESSORY",
  "ADMIN_FEE",
  "OTHER"
]);

export const rentalExtraChargeCreateSchema = z.object({
  paymentMethodId: z.string().trim().min(1).max(128).optional(),
  type: rentalExtraChargeTypeSchema,
  description: z.string().trim().min(3).max(1000),
  amountCents: z.coerce.number().int().min(1).max(100_000_000),
  adminFeeCents: z.coerce.number().int().min(0).max(10_000_000).optional().default(0),
  evidenceFileUrl: z.string().trim().url().max(1000).optional()
});

export const rentalExtraChargeChargeSchema = z.object({
  paymentMethodId: z.string().trim().min(1).max(128).optional()
});
