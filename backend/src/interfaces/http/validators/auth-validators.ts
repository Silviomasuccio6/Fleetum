import { z } from "zod";
import { signupCompanySchema } from "./tenant-profile-validators.js";

export const signupSchema = z.object({
  tenantName: z.string().min(2),
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().max(40).optional(),
  adminRole: z.string().max(80).optional(),
  privacyAccepted: z.boolean().optional().default(false),
  company: signupCompanySchema.optional(),
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
