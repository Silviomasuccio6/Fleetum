import type { Prisma, Stoppage } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { prisma } from "../database/prisma/client.js";

type Reader = Prisma.TransactionClient | typeof prisma;
export type StoppageLinks = Pick<Stoppage,
  "siteId" | "vehicleId" | "workshopId" | "createdByUserId" | "assignedToUserId">;

export const stoppageNotFound = () => new AppError("Fermo o riferimento non trovato", 404, "NOT_FOUND");
export const stoppageReferenceId = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw stoppageNotFound();
  return value;
};

// Historical resources may be inactive or soft-deleted, but their owner must
// still match. assignedToUserId has no FK: include deleted users for history.
// User.tenantId is immutable through the application APIs; no cross-request cache.
const scopeWithUsers = (tenantId: string, userIds: string[], includeDeleted: boolean): Prisma.StoppageWhereInput => ({
    tenantId,
    ...(!includeDeleted ? { deletedAt: null } : {}),
    site: { tenantId }, vehicle: { tenantId }, workshop: { tenantId }, createdBy: { tenantId },
    AND: [{ OR: [{ assignedToUserId: null }, { assignedToUserId: { in: userIds } }] }]
});
const tenantUserIds = async (tenantId: string, db: Reader) =>
  (await db.user.findMany({ where: { tenantId }, select: { id: true } })).map((user) => user.id);

export const ownedStoppageWhere = async (
  tenantId: string, db: Reader = prisma, includeDeleted = false
): Promise<Prisma.StoppageWhereInput> => scopeWithUsers(tenantId, await tenantUserIds(tenantId, db), includeDeleted);

// Event actors also have no FK. Retain system events and deleted owned actors,
// but exclude legacy references to missing or foreign users before take/order.
export const ownedStoppageEventsWhere = async (
  tenantId: string, db: Reader = prisma
): Promise<Prisma.StoppageEventWhereInput> => {
  const userIds = await tenantUserIds(tenantId, db);
  return {
    tenantId, stoppage: scopeWithUsers(tenantId, userIds, true),
    OR: [{ userId: null }, { userId: { in: userIds } }]
  };
};

export const lockStoppageTenant = async (tx: Prisma.TransactionClient, tenantId: string) => {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR KEY SHARE
  `;
  if (!rows.length) throw stoppageNotFound();
};

export const lockStoppageUser = async (
  tx: Prisma.TransactionClient, tenantId: string, userId: string, requireNonDeleted: boolean
) => {
  const rows = await tx.$queryRaw<Array<{ deletedAt: Date | null }>>`
    SELECT "deletedAt" FROM "User" WHERE "id" = ${userId} AND "tenantId" = ${tenantId} FOR SHARE
  `;
  if (!rows.length || (requireNonDeleted && rows[0].deletedAt)) throw stoppageNotFound();
};

export const lockStoppageUsers = async (
  tx: Prisma.TransactionClient, tenantId: string, next: StoppageLinks, current?: StoppageLinks
) => {
  const users = new Map<string, boolean>();
  users.set(next.createdByUserId, next.createdByUserId !== current?.createdByUserId);
  if (next.assignedToUserId !== null) {
    users.set(next.assignedToUserId, Boolean(users.get(next.assignedToUserId)) || next.assignedToUserId !== current?.assignedToUserId);
  }
  for (const [id, requireNonDeleted] of [...users].sort(([a], [b]) => a.localeCompare(b))) {
    await lockStoppageUser(tx, tenantId, id, requireNonDeleted);
  }
};

// Reminder users are historical references: status/soft deletion do not change
// eligibility and tenantId is immutable in application APIs. The parent lock
// stabilizes these IDs. A plain lookup avoids Tenant UPDATE -> User SHARE
// inversion with auth's User UPDATE -> Tenant FK for legacy subscriptions.
export const stoppageHistoricalUsersOwned = async (
  tx: Prisma.TransactionClient, tenantId: string, links: StoppageLinks
) => {
  const ids = [...new Set([links.createdByUserId, ...(links.assignedToUserId === null ? [] : [links.assignedToUserId])])];
  const users = await tx.user.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } });
  return users.length === ids.length;
};

export const lockStoppageLinks = async (
  tx: Prisma.TransactionClient, tenantId: string, next: StoppageLinks,
  current?: StoppageLinks, exclusiveVehicle = false
) => {
  const sites = await tx.$queryRaw<Array<{ deletedAt: Date | null }>>`
    SELECT "deletedAt" FROM "Site" WHERE "id" = ${next.siteId} AND "tenantId" = ${tenantId} FOR SHARE
  `;
  if (!sites.length || (next.siteId !== current?.siteId && sites[0].deletedAt)) throw stoppageNotFound();
  const vehicles = exclusiveVehicle
    ? await tx.$queryRaw<Array<{ deletedAt: Date | null }>>`
        SELECT "deletedAt" FROM "Vehicle" WHERE "id" = ${next.vehicleId} AND "tenantId" = ${tenantId} FOR UPDATE
      `
    : await tx.$queryRaw<Array<{ deletedAt: Date | null }>>`
        SELECT "deletedAt" FROM "Vehicle" WHERE "id" = ${next.vehicleId} AND "tenantId" = ${tenantId} FOR SHARE
      `;
  if (!vehicles.length || (next.vehicleId !== current?.vehicleId && vehicles[0].deletedAt)) throw stoppageNotFound();
  const workshops = await tx.$queryRaw<Array<{ deletedAt: Date | null }>>`
    SELECT "deletedAt" FROM "Workshop" WHERE "id" = ${next.workshopId} AND "tenantId" = ${tenantId} FOR SHARE
  `;
  if (!workshops.length || (next.workshopId !== current?.workshopId && workshops[0].deletedAt)) throw stoppageNotFound();
  await lockStoppageUsers(tx, tenantId, next, current);
};

// Every mutation validates the current parent first: no accidental repair of a
// corrupt legacy row by patching just one of its foreign references.
export const lockOwnedStoppage = async (
  tx: Prisma.TransactionClient, tenantId: string, id: string, includeDeleted = false
) => {
  await lockStoppageTenant(tx, tenantId);
  await tx.$queryRaw`
    SELECT "id" FROM "Stoppage" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE
  `;
  const current = await tx.stoppage.findFirst({ where: {
    id, tenantId, ...(!includeDeleted ? { deletedAt: null } : {})
  } });
  if (!current) throw stoppageNotFound();
  await lockStoppageLinks(tx, tenantId, current, current);
  return current;
};
