import { VehicleRepository } from "../../domain/repositories/vehicle-repository.js";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { prisma } from "../database/prisma/client.js";
import { lockOwnedVehicle, lockVehicleSite, lockVehicleTenant, ownedVehicleWhere, scalarWriteFields, vehicleNotFound } from "./vehicle-tenant-scope.js";

const writableFields = ["siteId", "plate", "brand", "model", "year", "currentKm", "maintenanceIntervalKm",
  "registrationDate", "lastRevisionAt", "revisionDueAt", "purchasePrice", "purchaseDate", "residualValue",
  "monthlyFixedCost", "notes", "isActive"] as const;
const reference = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw vehicleNotFound();
  return value;
};
const reserveExistingPlate = async (tx: Prisma.TransactionClient, tenantId: string, plate: unknown, excludingId?: string) => {
  if (typeof plate !== "string" || !plate.trim()) return;
  // Internal existence check: legacy corrupt vehicles still reserve their plate,
  // but their identity or linked site must never be exposed by a public lookup.
  const existing = await tx.vehicle.findFirst({ where: {
    tenantId, deletedAt: null, plate: { equals: plate, mode: "insensitive" },
    ...(excludingId ? { id: { not: excludingId } } : {})
  }, select: { id: true } });
  if (existing) throw new AppError("Esiste gia un veicolo con questa targa", 409, "VEHICLE_PLATE_ALREADY_EXISTS");
};

export class PrismaVehicleRepository implements VehicleRepository {
  async list(tenantId: string, params: { search?: string; skip: number; take: number }) {
    const where = {
      ...ownedVehicleWhere(tenantId),
      ...(params.search
        ? {
            OR: [
              { plate: { contains: params.search, mode: "insensitive" as const } },
              { brand: { contains: params.search, mode: "insensitive" as const } },
              { model: { contains: params.search, mode: "insensitive" as const } },
              { site: { name: { contains: params.search, mode: "insensitive" as const } } },
              { site: { city: { contains: params.search, mode: "insensitive" as const } } }
            ]
          }
        : {})
    };

    const [total, data] = await Promise.all([
      prisma.vehicle.count({ where }),
      prisma.vehicle.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: "desc" },
        include: { site: true, photos: true, booklet: { where: { tenantId } } }
      })
    ]);

    return { data, total };
  }

  findByPlate(tenantId: string, plate: string) {
    return prisma.vehicle.findFirst({
      where: {
        ...ownedVehicleWhere(tenantId),
        plate: { equals: plate, mode: "insensitive" }
      },
      include: { site: true, photos: true, booklet: { where: { tenantId } } }
    });
  }

  findById(tenantId: string, id: string) {
    return prisma.vehicle.findFirst({
      where: { ...ownedVehicleWhere(tenantId), id },
      include: { site: true, photos: true, booklet: { where: { tenantId } } }
    });
  }

  async create(tenantId: string, input: Record<string, unknown>) {
    const data = scalarWriteFields(input, writableFields);
    const siteId = reference(data.siteId);
    return prisma.$transaction(async (tx) => {
      await lockVehicleTenant(tx, tenantId);
      await lockVehicleSite(tx, tenantId, siteId, true);
      await reserveExistingPlate(tx, tenantId, data.plate);
      return tx.vehicle.create({ data: { ...data, tenantId } as never });
    });
  }

  async update(tenantId: string, id: string, input: Record<string, unknown>) {
    const data = scalarWriteFields(input, writableFields);
    return prisma.$transaction(async (tx) => {
      const current = await lockOwnedVehicle(tx, tenantId, id);
      if (data.siteId !== undefined && data.siteId !== current.siteId) {
        await lockVehicleSite(tx, tenantId, reference(data.siteId), true);
      }
      await reserveExistingPlate(tx, tenantId, data.plate, id);
      return tx.vehicle.update({
        where: { id }, data: data as never,
        include: { site: true, photos: true, booklet: { where: { tenantId } } }
      });
    });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await lockOwnedVehicle(tx, tenantId, id);
      await tx.vehicle.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }
}
