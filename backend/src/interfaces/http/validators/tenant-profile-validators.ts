import { z } from "zod";
import { validateCompanyRegistrationDraft } from "../../../shared/validation/company-registration.js";

const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const optionalText = (max = 255) => z.preprocess(emptyToUndefined, z.string().max(max).optional());
const optionalEmail = z.preprocess(emptyToUndefined, z.string().email().max(255).optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().max(500).optional());
const optionalHex = z.preprocess(emptyToUndefined, z.string().regex(/^#[0-9a-fA-F]{6}$/).optional());

const withCompanyFiscalRules = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((value, ctx) => {
    const errors = validateCompanyRegistrationDraft({
      country: value.country,
      tenantName: value.legalName,
      vatNumber: value.vatNumber,
      taxCode: value.taxCode,
      pec: value.pec,
      sdiCode: value.sdiCode,
      legalAddress: value.legalAddress,
      city: value.city,
      province: value.province,
      postalCode: value.postalCode,
      companyEmail: value.email,
      companyPhone: value.phone
    });
    errors.forEach((error) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [error.field], message: error.message });
    });
  });

export const tenantCompanyProfileSchema = withCompanyFiscalRules(z.object({
  legalName: z.string().trim().min(2).max(180),
  tradeName: optionalText(180),
  legalForm: optionalText(80),
  vatNumber: optionalText(32),
  taxCode: optionalText(32),
  pec: optionalEmail,
  sdiCode: optionalText(16),
  rea: optionalText(64),
  legalAddress: optionalText(255),
  city: optionalText(120),
  province: optionalText(8),
  postalCode: optionalText(16),
  country: z.preprocess(emptyToUndefined, z.string().max(2).optional()).default("IT"),
  phone: optionalText(40),
  email: optionalEmail,
  website: optionalUrl,
  adminFirstName: optionalText(80),
  adminLastName: optionalText(80),
  adminEmail: optionalEmail,
  adminPhone: optionalText(40),
  adminRole: optionalText(80),
  primaryColor: optionalHex,
  accentColor: optionalHex,
  fontFamily: optionalText(80),
  contractFooterText: optionalText(1200),
  defaultContractTerms: optionalText(12000),
  termsVersion: optionalText(40),
  dpaVersion: optionalText(40)
}));

export const signupCompanySchema = tenantCompanyProfileSchema;

export type TenantCompanyProfileInput = z.infer<typeof tenantCompanyProfileSchema>;
export type SignupCompanyInput = z.infer<typeof signupCompanySchema>;
