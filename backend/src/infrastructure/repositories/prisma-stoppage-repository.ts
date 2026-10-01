import { StoppageStatus } from "@prisma/client";
import { StoppageRepository } from "../../domain/repositories/stoppage-repository.js";
import { prisma } from "../database/prisma/client.js";

const sortableFields = new Set(["openedAt", "createdAt", "updatedAt", "status", "priority", "closedAt"]);
const openLifecycleStatuses: StoppageStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"];

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
      tenantId,
      deletedAt: null,
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
        include: { site: true, vehicle: true, workshop: true, photos: true, reminders: true }
      })
    ]);

    return { data, total };
  }

  getById(tenantId: string, id: string) {
    return prisma.stoppage.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { site: true, vehicle: true, workshop: true, photos: true, reminders: { orderBy: { sentAt: "desc" } } }
    });
  }

  create(tenantId: string, input: Record<string, unknown>) {
    return prisma.stoppage.create({ data: { tenantId, ...input } as never, include: { site: true, vehicle: true, workshop: true, photos: true } });
  }

  async update(tenantId: string, id: string, input: Record<string, unknown>) {
    await prisma.stoppage.updateMany({ where: { id, tenantId, deletedAt: null }, data: input as never });
    return prisma.stoppage.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { site: true, vehicle: true, workshop: true, photos: true, reminders: true }
    });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await prisma.stoppage.updateMany({ where: { id, tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
  }

  listForAutomaticReminders(now: Date) {
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

  async markReminderSent(stoppageId: string, sentAt: Date): Promise<void> {
    await prisma.stoppage.update({
      where: { id: stoppageId },
      data: { lastReminderSentAt: sentAt, totalRemindersSent: { increment: 1 }, status: "SOLICITED" }
    });
  }
}
