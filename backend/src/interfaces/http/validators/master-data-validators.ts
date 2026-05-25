import { z } from "zod";

export const siteSchema = z.object({
  name: z.string().min(2),
  address: z.string().min(2),
  city: z.string().min(2),
  contactName: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  notes: z.string().optional(),
  isActive: z.boolean().optional()
});

export const workshopSchema = z.object({
  name: z.string().min(2),
  contactName: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  notes: z.string().optional(),
  isActive: z.boolean().optional()
});

export const vehicleSchema = z.object({
  siteId: z.string().min(1),
  plate: z.string().min(2),
  brand: z.string().min(2),
  model: z.string().min(1),
  year: z.number().int().min(1950).max(2100).optional(),
  currentKm: z.number().int().min(0).optional().nullable(),
  maintenanceIntervalKm: z.number().int().min(100).optional().nullable(),
  registrationDate: z.coerce.date().optional().nullable(),
  lastRevisionAt: z.coerce.date().optional().nullable(),
  revisionDueAt: z.coerce.date().optional().nullable(),
  purchasePrice: z.number().min(0).optional().nullable(),
  purchaseDate: z.coerce.date().optional().nullable(),
  residualValue: z.number().min(0).optional().nullable(),
  monthlyFixedCost: z.number().min(0).optional().nullable(),
  notes: z.string().optional(),
  isActive: z.boolean().optional()
});

export const vehicleMaintenanceSchema = z.object({
  vehicleId: z.string().min(1),
  performedAt: z.coerce.date(),
  maintenanceType: z.string().min(2),
  description: z.string().optional(),
  workshopName: z.string().optional(),
  kmAtService: z.number().int().min(0).optional().nullable(),
  cost: z.number().min(0).optional().nullable()
});
