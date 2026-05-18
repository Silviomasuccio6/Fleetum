import { z } from "zod";

const cleanText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .transform((value) => value.replace(/[<>\r\n]/g, " ").replace(/\s+/g, " ").trim());

const optionalCleanText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value.replace(/[<>\r\n]/g, " ").replace(/\s+/g, " ").trim() : undefined));

export const publicDemoRequestSchema = z.object({
  companyName: cleanText(120),
  fullName: cleanText(100),
  email: z.string().trim().email().max(160).transform((value) => value.toLowerCase()),
  phone: optionalCleanText(40),
  fleetSize: z.enum(["1-10", "11-30", "31-80", "80+"]).optional(),
  message: z.string().trim().max(1200).optional().transform((value) => value?.replace(/[<>]/g, "").trim()),
  source: z.string().trim().max(80).optional().default("fleetum.it"),
  websiteUrl: z.string().trim().max(0).optional()
});

export type PublicDemoRequestInput = z.infer<typeof publicDemoRequestSchema>;
