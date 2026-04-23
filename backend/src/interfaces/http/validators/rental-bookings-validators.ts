import { z } from "zod";

const optionalString = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());

export const rentalBookingStatusSchema = z.enum([
  "DRAFT",
  "QUOTED",
  "HOLD",
  "CONFIRMED",
  "CONTRACT_SIGNED",
  "READY_FOR_HANDOVER",
  "IN_RENT",
  "CLOSED",
  "CANCELED",
  "NO_SHOW"
]);

export const rentalContractStatusSchema = z.enum(["NOT_READY", "READY", "SIGNED"]);

export const rentalCargosStatusSchema = z.enum(["NOT_REQUIRED", "PENDING", "SENT", "ERROR"]);
export const bookingContractStatusSchema = z.enum(["DRAFT", "READY", "SENT", "SIGNED", "ERROR"]);
export const bookingContractDeliveryChannelSchema = z.enum(["EMAIL", "WHATSAPP"]);
export const rentalPricingScopeSchema = z.enum(["GLOBAL", "SITE", "VEHICLE_CATEGORY", "VEHICLE"]);
export const rentalBaseRateUnitSchema = z.enum(["DAILY", "WEEKLY", "MONTHLY"]);
export const rentalKmPackageTypeSchema = z.enum(["LIMITED", "UNLIMITED"]);
export const rentalKmScopeSchema = z.enum(["PER_DAY", "PER_RENTAL"]);
export const rentalExtraKmPolicyTypeSchema = z.enum(["FLAT", "TIERED"]);
export const rentalHourOverflowRuleSchema = z.enum(["NONE", "HALF_DAY", "FULL_DAY"]);
export const rentalCustomerTypeSchema = z.enum(["PERSONA_FISICA", "PERSONA_GIURIDICA"]);

const rentalBookingBaseSchema = z.object({
  vehicleId: z.string().trim().min(1),
  customerId: z.string().trim().min(1, "Cliente obbligatorio"),
  contractRequired: z.boolean().optional(),
  customerName: optionalString,
  customerEmail: optionalString,
  customerPhone: optionalString,
  customerDocument: optionalString,
  pickupAt: z.coerce.date(),
  returnAt: z.coerce.date(),
  pickupLocation: optionalString,
  returnLocation: optionalString,
  pickupKm: z.coerce.number().int().min(0).optional().nullable(),
  returnKm: z.coerce.number().int().min(0).optional().nullable(),
  expectedTotal: z.number().min(0).optional().nullable(),
  finalTotal: z.number().min(0).optional().nullable(),
  reason: optionalString,
  internalNotes: optionalString,
  contractStatus: rentalContractStatusSchema.optional(),
  cargosStatus: rentalCargosStatusSchema.optional()
});

export const rentalBookingCreateSchema = rentalBookingBaseSchema
  .extend({
    generateContract: z.boolean().optional().default(true)
  })
  .refine((input) => input.returnAt.getTime() > input.pickupAt.getTime(), {
    message: "La data/ora di rientro deve essere successiva al ritiro",
    path: ["returnAt"]
  })
  .refine((input) => {
    if (input.pickupKm == null || input.returnKm == null) return true;
    return input.returnKm >= input.pickupKm;
  }, {
    message: "I km rientro devono essere maggiori o uguali ai km uscita",
    path: ["returnKm"]
  });

export const rentalBookingUpdateSchema = rentalBookingBaseSchema.partial().refine((input) => {
  if (!input.pickupAt || !input.returnAt) return true;
  return input.returnAt.getTime() > input.pickupAt.getTime();
}, {
    message: "La data/ora di rientro deve essere successiva al ritiro",
    path: ["returnAt"]
  }).refine((input) => {
    if (input.pickupKm == null || input.returnKm == null) return true;
    return input.returnKm >= input.pickupKm;
  }, {
    message: "I km rientro devono essere maggiori o uguali ai km uscita",
    path: ["returnKm"]
  });

export const rentalBookingTransitionSchema = z.object({
  toStatus: rentalBookingStatusSchema,
  reason: optionalString
});

export const rentalBookingContractSchema = z.object({
  status: rentalContractStatusSchema,
  signedAt: z.coerce.date().optional(),
  note: optionalString
});

export const rentalBookingCargosSchema = z.object({
  status: rentalCargosStatusSchema,
  transmissionId: optionalString,
  message: optionalString
});

export const rentalBookingNoteSchema = z.object({
  message: z.string().trim().min(2).max(1500),
  type: z.enum(["NOTE", "SYSTEM", "CARGOS"]).optional()
});

export const rentalBookingListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(20),
  search: optionalString,
  status: rentalBookingStatusSchema.optional(),
  contractStatus: rentalContractStatusSchema.optional(),
  cargosStatus: rentalCargosStatusSchema.optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  vehicleId: optionalString
});

export const rentalBookingDayAvailabilityQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato data non valido (YYYY-MM-DD)")
    .optional(),
  siteId: optionalString
});

export const rentalBookingMonthAvailabilityQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Formato mese non valido (YYYY-MM)")
    .optional(),
  siteId: optionalString,
  search: optionalString
});

export const rentalBookingSuggestVehiclesQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  siteId: optionalString
});

export const rentalBookingSuggestCustomersQuerySchema = z.object({
  q: z.string().trim().min(1).max(120)
});

export const rentalPricingListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(20),
  search: optionalString,
  isActive: z.coerce.boolean().optional(),
  siteId: optionalString,
  scope: rentalPricingScopeSchema.optional()
});

const pricingListBaseSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: optionalString,
  isActive: z.boolean().optional().default(true),
  validFrom: z.coerce.date().optional(),
  validTo: z.coerce.date().optional(),
  scope: rentalPricingScopeSchema.optional().default("GLOBAL"),
  siteId: optionalString,
  vehicleId: optionalString,
  vehicleCategory: optionalString,
  baseRateUnit: rentalBaseRateUnitSchema.optional().default("DAILY"),
  baseRateAmount: z.coerce.number().min(0),
  vatRate: z.coerce.number().min(0).max(100).optional().default(22),
  discountPercent: z.coerce.number().min(0).max(100).optional().default(0),
  hourOverflowRule: rentalHourOverflowRuleSchema.optional().default("FULL_DAY"),
  priority: z.coerce.number().int().min(0).max(10000).optional().default(100)
});

export const rentalPricingCreateListSchema = pricingListBaseSchema.refine((input) => {
  if (!input.validFrom || !input.validTo) return true;
  return input.validTo.getTime() >= input.validFrom.getTime();
}, {
  message: "La validita finale deve essere successiva alla data iniziale",
  path: ["validTo"]
});

export const rentalPricingUpdateListSchema = pricingListBaseSchema.partial().refine((input) => {
  if (!input.validFrom || !input.validTo) return true;
  return input.validTo.getTime() >= input.validFrom.getTime();
}, {
  message: "La validita finale deve essere successiva alla data iniziale",
  path: ["validTo"]
});

const packageBaseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: optionalString,
  type: rentalKmPackageTypeSchema.optional().default("LIMITED"),
  kmIncluded: z.coerce.number().int().min(0).optional().nullable(),
  kmScope: rentalKmScopeSchema.optional().default("PER_DAY"),
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional().default(0)
});

export const rentalPricingCreatePackageSchema = packageBaseSchema.refine((input) => {
  if (input.type === "UNLIMITED") return true;
  return (input.kmIncluded ?? 0) > 0;
}, {
  message: "Per i pacchetti LIMITED devi indicare km inclusi > 0",
  path: ["kmIncluded"]
});

export const rentalPricingUpdatePackageSchema = packageBaseSchema.partial();

const extraTierSchema = z.object({
  fromKm: z.coerce.number().int().min(1),
  toKm: z.coerce.number().int().min(1).optional().nullable(),
  ratePerKm: z.coerce.number().min(0),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional().default(0)
});

const extraPolicyBaseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  packageId: optionalString,
  type: rentalExtraKmPolicyTypeSchema.optional().default("FLAT"),
  flatRatePerKm: z.coerce.number().min(0).optional().nullable(),
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional().default(0),
  tiers: z.array(extraTierSchema).optional().default([])
});

export const rentalPricingCreateExtraPolicySchema = extraPolicyBaseSchema.refine((input) => {
  if (input.type === "FLAT") return (input.flatRatePerKm ?? 0) >= 0;
  return (input.tiers ?? []).length > 0;
}, {
  message: "Per il tipo TIERED devi indicare almeno uno scaglione",
  path: ["tiers"]
});

export const rentalPricingUpdateExtraPolicySchema = extraPolicyBaseSchema.partial();

export const rentalPricingQuoteSchema = z
  .object({
    priceListId: z.string().trim().min(1),
    pricePackageId: optionalString,
    extraKmPolicyId: optionalString,
    pickupAt: z.coerce.date(),
    returnAt: z.coerce.date(),
    estimatedKm: z.coerce.number().min(0).optional().nullable(),
    actualKm: z.coerce.number().min(0).optional().nullable()
  })
  .refine((input) => input.returnAt.getTime() > input.pickupAt.getTime(), {
    message: "La data/ora di rientro deve essere successiva al ritiro",
    path: ["returnAt"]
  });

export const rentalBookingPricingUpdateSchema = z.object({
  priceListId: z.string().trim().min(1),
  pricePackageId: optionalString,
  extraKmPolicyId: optionalString,
  estimatedKm: z.coerce.number().min(0).optional().nullable(),
  actualKm: z.coerce.number().min(0).optional().nullable(),
  notes: optionalString
});

const italianVatRegex = /^\d{11}$/;
const sdiCodeRegex = /^[A-Za-z0-9]{7}$/;

const customerBaseSchema = z.object({
  customerType: rentalCustomerTypeSchema.optional().default("PERSONA_FISICA"),
  firstName: optionalString,
  lastName: optionalString,
  drivingLicenseNumber: optionalString,
  drivingLicenseIssuedAt: z.coerce.date().optional(),
  drivingLicenseExpiresAt: z.coerce.date().optional(),
  drivingLicenseAuthority: optionalString,
  drivingLicenseCategory: optionalString,
  email: optionalString.refine((value) => !value || z.string().email().safeParse(value).success, {
    message: "Email cliente non valida"
  }),
  phone: optionalString,
  dateOfBirth: z.coerce.date().optional(),
  placeOfBirth: optionalString,
  nationality: optionalString,
  residenceAddress: optionalString,
  taxCode: optionalString,
  documentType: optionalString,
  documentNumber: optionalString,
  documentIssuedAt: z.coerce.date().optional(),
  documentExpiresAt: z.coerce.date().optional(),
  documentAuthority: optionalString,
  companyName: optionalString,
  companyLegalForm: optionalString,
  companyVatNumber: optionalString,
  companyTaxCode: optionalString,
  companyLegalAddress: optionalString,
  companyPec: optionalString.refine((value) => !value || z.string().email().safeParse(value).success, {
    message: "PEC non valida"
  }),
  companySdi: optionalString.refine((value) => !value || sdiCodeRegex.test(value), {
    message: "Codice SDI non valido (7 caratteri alfanumerici)"
  }),
  companyRea: optionalString,
  legalRepFirstName: optionalString,
  legalRepLastName: optionalString,
  legalRepTaxCode: optionalString,
  legalRepRole: optionalString,
  legalRepEmail: optionalString.refine((value) => !value || z.string().email().safeParse(value).success, {
    message: "Email legale rappresentante non valida"
  }),
  legalRepPhone: optionalString,
  notes: optionalString
});

export const rentalCustomerCreateSchema = customerBaseSchema.superRefine((input, ctx) => {
  if (input.customerType === "PERSONA_GIURIDICA") {
    if (!input.companyName || input.companyName.trim().length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["companyName"],
        message: "Ragione sociale obbligatoria"
      });
    }
    if (!input.companyVatNumber || !italianVatRegex.test(input.companyVatNumber.replace(/\s+/g, ""))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["companyVatNumber"],
        message: "Partita IVA non valida (11 cifre)"
      });
    }
    if (!input.email && !input.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "Per società è obbligatorio almeno un contatto (email o telefono)"
      });
    }
    return;
  }

  if (!input.firstName || input.firstName.trim().length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["firstName"],
      message: "Nome obbligatorio"
    });
  }
  if (!input.lastName || input.lastName.trim().length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lastName"],
      message: "Cognome obbligatorio"
    });
  }
  if (!input.drivingLicenseNumber || input.drivingLicenseNumber.trim().length < 5) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["drivingLicenseNumber"],
      message: "Numero patente obbligatorio"
    });
  }
});

export const rentalCustomerUpdateSchema = customerBaseSchema.partial().superRefine((input, ctx) => {
  const customerType = input.customerType;
  if (!customerType) return;

  if (customerType === "PERSONA_GIURIDICA") {
    if (input.companyVatNumber && !italianVatRegex.test(input.companyVatNumber.replace(/\s+/g, ""))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["companyVatNumber"],
        message: "Partita IVA non valida (11 cifre)"
      });
    }
    return;
  }

  if (input.firstName !== undefined && input.firstName.trim().length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["firstName"],
      message: "Nome obbligatorio"
    });
  }
  if (input.lastName !== undefined && input.lastName.trim().length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lastName"],
      message: "Cognome obbligatorio"
    });
  }
  if (input.drivingLicenseNumber !== undefined && input.drivingLicenseNumber.trim().length < 5) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["drivingLicenseNumber"],
      message: "Numero patente obbligatorio"
    });
  }
});

export const rentalCustomerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(20),
  search: optionalString,
  customerType: rentalCustomerTypeSchema.optional()
});

export const customerContractsPeriodSchema = z.enum(["all", "7d", "30d", "90d", "custom"]);

export const rentalCustomerContractsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(20),
  period: customerContractsPeriodSchema.optional().default("all"),
  status: bookingContractStatusSchema.optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional()
});

export const rentalCustomerBookingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(20),
  period: customerContractsPeriodSchema.optional().default("all"),
  status: rentalBookingStatusSchema.optional(),
  contractStatus: rentalContractStatusSchema.optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional()
});

export const rentalContractsMonitoringQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(20),
  period: customerContractsPeriodSchema.optional().default("all"),
  status: bookingContractStatusSchema.optional(),
  bookingStatus: rentalBookingStatusSchema.optional(),
  siteId: optionalString,
  search: optionalString,
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional()
});

export const bookingContractUpdateSchema = z.object({
  title: z.string().trim().min(2).max(250).optional(),
  content: z.string().trim().min(10).max(50000).optional(),
  emailTo: optionalString.refine((value) => !value || z.string().email().safeParse(value).success, {
    message: "Email destinatario non valida"
  }),
  emailSubject: z.string().trim().min(2).max(250).optional(),
  emailBody: z.string().trim().min(2).max(20000).optional(),
  status: bookingContractStatusSchema.optional()
});

export const bookingContractEmailSchema = z.object({
  to: optionalString.refine((value) => !value || z.string().email().safeParse(value).success, {
    message: "Email destinatario non valida"
  }),
  subject: z.string().trim().min(2).max(250).optional(),
  body: z.string().trim().min(2).max(20000).optional()
});

export const bookingContractWhatsappSchema = z.object({
  phone: optionalString.refine((value) => {
    if (!value) return true;
    const normalized = value.replace(/\s+/g, "").replace(/\(0\)/g, "");
    return /^\+?[0-9]{8,20}$/.test(normalized);
  }, {
    message: "Numero WhatsApp non valido"
  }),
  message: z.string().trim().min(4).max(2000).optional(),
  shareExpiresHours: z.coerce.number().int().min(1).max(168).optional().default(48)
});

export const bookingContractMarkSignedSchema = z.object({
  signedAt: z.coerce.date().optional(),
  signatureDataUrl: z
    .string()
    .trim()
    .max(2_500_000, "Firma troppo grande")
    .refine((value) => /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value), {
      message: "Formato firma non valido"
    })
    .optional()
});

export const contractTemplateUpdateSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  content: z.string().trim().min(10).max(50000).optional(),
  emailSubject: z.string().trim().min(2).max(250).optional(),
  emailBody: z.string().trim().min(2).max(20000).optional(),
  companyName: z.string().trim().min(2).max(180).optional(),
  companyAddress: z.string().trim().min(2).max(300).optional(),
  companyVat: z.string().trim().min(2).max(120).optional(),
  companyEmail: z
    .string()
    .trim()
    .min(5)
    .max(180)
    .refine((value) => z.string().email().safeParse(value).success, {
      message: "Email aziendale non valida"
    })
    .optional(),
  companyPhone: z.string().trim().min(3).max(80).optional(),
  brandPrimary: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Colore primary non valido").optional(),
  brandAccent: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Colore accent non valido").optional(),
  brandFont: z.string().trim().min(3).max(40).optional()
});

export const contractTemplatePreviewSchema = z.object({
  bookingId: z.string().trim().min(1),
  content: z.string().trim().min(2).max(50000).optional(),
  emailSubject: z.string().trim().min(2).max(250).optional(),
  emailBody: z.string().trim().min(2).max(20000).optional()
});
