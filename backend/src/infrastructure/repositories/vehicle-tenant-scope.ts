import type { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";

// Historical sites may be inactive or soft-deleted. Ownership must always match.
export const ownedVehicleWhere = (tenantId: string, includeDeleted = false): Prisma.VehicleWhereInput => ({
  tenantId, site: { tenantId }, ...(!includeDeleted ? { deletedAt: null } : {})
});

export const vehicleNotFound = () => new AppError("Veicolo o sede non trovati", 404, "NOT_FOUND");

export const lockVehicleTenant = async (tx: Prisma.TransactionClient, tenantId: string) => {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR KEY SHARE
  `;
  if (!rows.length) throw vehicleNotFound();
};

export const lockVehicleSite = async (
  tx: Prisma.TransactionClient, tenantId: string, siteId: string, requireNonDeleted = false
) => {
  const rows = await tx.$queryRaw<Array<{ deletedAt: Date | null }>>`
    SELECT "deletedAt" FROM "Site" WHERE "id" = ${siteId} AND "tenantId" = ${tenantId} FOR SHARE
  `;
  if (!rows.length || (requireNonDeleted && rows[0].deletedAt)) throw vehicleNotFound();
};

// Parent first, then linked site. Row locks fence concurrent site cancellation
// and vehicle reassignment through authorization, mutation and response hydration.
export const lockOwnedVehicle = async (
  tx: Prisma.TransactionClient, tenantId: string, id: string, includeDeleted = false
) => {
  await lockVehicleTenant(tx, tenantId);
  await tx.$queryRaw`
    SELECT "id" FROM "Vehicle" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE
  `;
  const current = await tx.vehicle.findFirst({ where: {
    id, tenantId, ...(!includeDeleted ? { deletedAt: null } : {})
  } });
  if (!current) throw vehicleNotFound();
  await lockVehicleSite(tx, tenantId, current.siteId);
  return current;
};

// Repositories accept records, not Prisma nested writes or scalar operators.
// Reject rather than silently discard identity/ownership/system-field changes.
export const scalarWriteFields = (input: Record<string, unknown>, allowed: readonly string[]) => {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key) || (typeof value === "object" && value !== null && !(value instanceof Date)) ||
        (value !== undefined && value !== null && !["string", "number", "boolean"].includes(typeof value) && !(value instanceof Date))) {
      throw new AppError("Campo non modificabile o valore non valido", 400, "INVALID_WRITE_FIELD");
    }
    if (value !== undefined) data[key] = value;
  }
  return data;
};
