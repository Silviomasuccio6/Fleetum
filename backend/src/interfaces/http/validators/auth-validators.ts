import { z } from "zod";
import { signupCompanySchema } from "./tenant-profile-validators.js";

const trimString = (value: unknown) => (typeof value === "string" ? value.trim() : value);
const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};
const requiredText = (min = 2, max = 255) => z.preprocess(trimString, z.string().min(min).max(max));
const requiredEmail = z.preprocess(trimString, z.string().email().max(320));
const optionalText = (max = 255) => z.preprocess(emptyToUndefined, z.string().max(max).optional());

export const signupSchema = z.object({
  tenantName: requiredText(2, 180),
  firstName: requiredText(2, 80),
  lastName: requiredText(2, 80),
  email: requiredEmail,
  phone: optionalText(40),
  adminRole: optionalText(80),
  privacyAccepted: z.boolean().optional().default(false),
  company: signupCompanySchema,
  password: z
    .string()
    .min(8)
    .regex(/[A-Z]/, "La password deve contenere almeno una maiuscola")
    .regex(/[0-9]/, "La password deve contenere almeno un numero")
    .regex(/[^A-Za-z0-9]/, "La password deve contenere almeno un carattere speciale")
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const forgotPasswordSchema = z.object({ email: z.string().email() });

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  newPassword: z
    .string()
    .min(8)
    .regex(/[A-Z]/, "La password deve contenere almeno una maiuscola")
    .regex(/[0-9]/, "La password deve contenere almeno un numero")
    .regex(/[^A-Za-z0-9]/, "La password deve contenere almeno un carattere speciale")
});

export const acceptInviteSchema = z.object({
  token: z.string().min(10),
  password: z
    .string()
    .min(8)
    .regex(/[A-Z]/, "La password deve contenere almeno una maiuscola")
    .regex(/[0-9]/, "La password deve contenere almeno un numero")
    .regex(/[^A-Za-z0-9]/, "La password deve contenere almeno un carattere speciale"),
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(2).optional()
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2)
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8)
    .regex(/[A-Z]/, "La password deve contenere almeno una maiuscola")
    .regex(/[0-9]/, "La password deve contenere almeno un numero")
    .regex(/[^A-Za-z0-9]/, "La password deve contenere almeno un carattere speciale"),
  logoutAllDevices: z.boolean().optional().default(false)
});
