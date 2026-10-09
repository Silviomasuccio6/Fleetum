import { Prisma, StoppageStatus } from "@prisma/client";
import { StoppageRepository } from "../../domain/repositories/stoppage-repository.js";
import { prisma } from "../database/prisma/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  lockOwnedStoppage, lockStoppageLinks, lockStoppageTenant, ownedStoppageWhere,
  stoppageNotFound, stoppageReferenceId, StoppageLinks
} from "./stoppage-tenant-scope.js";

const sortableFields = new Set(["openedAt", "createdAt", "updatedAt", "status", "priority", "closedAt"]);
const openLifecycleStatuses: StoppageStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"];
const writableFields = new Set([
  "siteId", "vehicleId", "workshopId", "reason", "notes", "status", "priority", "assignedToUserId",
  "estimatedCostPerDay", "openedAt", "closedAt", "closureSummary", "reminderAfterDays",
  "workshopEmailSnapshot", "workshopPhoneSnapshot", "workshopWhatsappSnapshot"
]);
const checkedInput = (input: Record<string, unknown>, creating: boolean) => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!writableFields.has(key) && !(creating && key === "createdByUserId")) {
      throw new AppError("Campi del fermo non consentiti", 400, "VALIDATION_ERROR");
    }
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string" && typeof value !== "number" &&
        !((key === "openedAt" || key === "closedAt") && value instanceof Date && Number.isFinite(value.getTime()))) {
      throw new AppError("Valori del fermo non validi", 400, "VALIDATION_ERROR");
    }
    result[key] = value;
  }
  return result;
};
const linksFrom = (input: Record<string, unknown>): StoppageLinks => ({
  siteId: stoppageReferenceId(input.siteId), vehicleId: stoppageReferenceId(input.vehicleId),
  workshopId: stoppageReferenceId(input.workshopId), createdByUserId: stoppageReferenceId(input.createdByUserId),
  assignedToUserId: input.assignedToUserId == null ? null : stoppageReferenceId(input.assignedToUserId)
});
const stoppageInclude = (tenantId: string) => ({
  site: true, vehicle: true, workshop: true, photos: true,
  reminders: { where: { tenantId }, orderBy: { sentAt: "desc" as const } }
});

export class PrismaStoppageRepository implements StoppageRepository {
  async list(
    tenantId: string,
    params: {
      search?: string;
      status?: string;
      siteId?: string;
      workshopId?: string;
      skip: number;
      take: number;
      sortBy?: string;
      sortDir?: "asc" | "desc";
    }
  ) {
    const statusWhere =
      params.status === "OPEN_ACTIVE"
        ? { status: { in: openLifecycleStatuses } }
        : params.status
          ? { status: params.status as StoppageStatus }
          : {};

    const where = {
      ...await ownedStoppageWhere(tenantId),
      ...statusWhere,
      ...(params.siteId ? { siteId: params.siteId } : {}),
      ...(params.workshopId ? { workshopId: params.workshopId } : {}),
      ...(params.search
        ? {
            OR: [
              { reason: { contains: params.search, mode: "insensitive" as const } },
              { vehicle: { plate: { contains: params.search, mode: "insensitive" as const } } },
              { site: { name: { contains: params.search, mode: "insensitive" as const } } },
              { workshop: { name: { contains: params.search, mode: "insensitive" as const } } }
            ]
          }
        : {})
    };

    const sortBy = params.sortBy && sortableFields.has(params.sortBy) ? params.sortBy : "openedAt";
    const orderBy = { [sortBy]: params.sortDir ?? "desc" } as const;

    const [total, data] = await Promise.all([
      prisma.stoppage.count({ where }),
      prisma.stoppage.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy,
        include: stoppageInclude(tenantId)
      })
    ]);

    return { data, total };
  }

  async getById(tenantId: string, id: string) {
    return prisma.stoppage.findFirst({
      where: { ...await ownedStoppageWhere(tenantId), id },
      include: stoppageInclude(tenantId)
    });
  }

  async create(tenantId: string, input: Record<string, unknown>) {
    const data = checkedInput(input, true);
    const links = linksFrom(data);
    return prisma.$transaction(async (tx) => {
      await lockStoppageTenant(tx, tenantId);
      // Serialize duplicate-open decisions for this vehicle and authorize all
      // references before inserting or reading a relationship in the response.
      await lockStoppageLinks(tx, tenantId, links, undefined, true);
      const duplicate = await tx.stoppage.findFirst({ where: {
        tenantId, vehicleId: links.vehicleId, reason: { equals: String(data.reason ?? "").trim(), mode: "insensitive" },
        status: { in: openLifecycleStatuses }, deletedAt: null
      }, select: { id: true } });
      if (duplicate) throw new AppError("Esiste gia un fermo aperto simile per questo veicolo", 409, "CONFLICT");
      return tx.stoppage.create({
        data: { ...data, ...links, tenantId } as Prisma.StoppageUncheckedCreateInput,
        include: stoppageInclude(tenantId)
      });
    }, { maxWait: 5000, timeout: 10000 });
  }

  async update(tenantId: string, id: string, input: Record<string, unknown>) {
    const data = checkedInput(input, false);
    return prisma.$transaction(async (tx) => {
      const current = await lockOwnedStoppage(tx, tenantId, id);
      const links = linksFrom({ ...current, ...data });
      await lockStoppageLinks(tx, tenantId, links, current);
      const updated = await tx.stoppage.updateMany({ where: { id, tenantId, deletedAt: null }, data: data as Prisma.StoppageUncheckedUpdateManyInput });
      if (updated.count !== 1) throw stoppageNotFound();
      return tx.stoppage.findFirstOrThrow({ where: { id, tenantId, deletedAt: null }, include: stoppageInclude(tenantId) });
    }, { maxWait: 5000, timeout: 10000 });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await lockOwnedStoppage(tx, tenantId, id);
      const removed = await tx.stoppage.updateMany({ where: { id, tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (removed.count !== 1) throw stoppageNotFound();
    }, { maxWait: 5000, timeout: 10000 });
  }

  async listForAutomaticReminders(now: Date) {
    return prisma.stoppage.findMany({
      where: {
        deletedAt: null,
        tenant: { isActive: true, deletedAt: null },
        status: { in: ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"] },
        reminderAfterDays: { not: null },
        openedAt: { lt: now }
      },
      // Relationships are read by the producer after locking their owners.
      select: { id: true, tenantId: true }
    });
  }

  async markReminderSent(tenantId: string, stoppageId: string, sentAt: Date): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const current = await lockOwnedStoppage(tx, tenantId, stoppageId);
      await tx.stoppage.updateMany({
        where: { id: stoppageId, tenantId, deletedAt: null },
        data: {
          lastReminderSentAt: sentAt,
          totalRemindersSent: { increment: 1 },
          ...(["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"].includes(current.status)
            ? { status: "SOLICITED" as const } : {})
        }
      });
    }, { maxWait: 5000, timeout: 10000 });
  }
}
