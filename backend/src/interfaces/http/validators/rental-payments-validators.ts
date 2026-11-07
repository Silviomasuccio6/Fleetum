import { z } from "zod";

export const rentalPaymentIdParamSchema = z.string().trim().min(1).max(128);

export const rentalPaymentSetupSessionSchema = z.object({
  mandateAccepted: z.literal(true, {
    error: "Devi accettare il mandato per registrare la carta del cliente."
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

const optionalFilter=z.string().trim().max(160).optional();
const calendarDay=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;},'Data non valida');
export const rentalCollectionQuerySchema=z.object({
 page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20),
 search:optionalFilter,bookingId:optionalFilter,customerId:optionalFilter,siteId:optionalFilter,from:calendarDay.optional(),to:calendarDay.optional(),
 state:z.enum(['UNKNOWN','DUE','PARTIAL','PAID','FREE','CREDIT']).optional(),method:z.enum(['CASH','BANK_TRANSFER','EXTERNAL_POS']).optional()
}).strict().refine(q=>!q.from||!q.to||q.from<=q.to,'La data finale deve seguire quella iniziale');
const collectionDetails={occurredAt:z.string().datetime({offset:true}),reference:z.string().trim().min(1).max(160),reason:z.string().trim().min(3).max(1000)};
export const rentalCollectionReceiptSchema=z.object({...collectionDetails,amountCents:z.number().int().min(1).max(100000000),method:z.enum(['CASH','BANK_TRANSFER','EXTERNAL_POS'])}).strict();
export const rentalCollectionRefundSchema=z.object({...collectionDetails,amountCents:z.number().int().min(1).max(100000000)}).strict();
export const rentalCollectionReversalSchema=z.object(collectionDetails).strict();
export const rentalCollectionRequestKeySchema=z.string().uuid();
