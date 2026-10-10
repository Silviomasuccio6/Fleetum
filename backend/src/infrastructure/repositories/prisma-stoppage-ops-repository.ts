import { StoppageOpsRepository, StoppageEventRow } from "../../domain/repositories/stoppage-ops-repository.js";
import { prisma } from "../database/prisma/client.js";
import { lockOwnedStoppage, lockStoppageUser, ownedStoppageEventsWhere, ownedStoppageWhere, stoppageReferenceId } from "./stoppage-tenant-scope.js";

export class PrismaStoppageOpsRepository implements StoppageOpsRepository {
  async createEvent(input: {
    tenantId: string;
    stoppageId: string;
    userId?: string;
    type: string;
    message: string;
    payload?: unknown;
  }): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await lockOwnedStoppage(tx, input.tenantId, input.stoppageId, input.type === "DELETED");
      if (input.userId !== undefined) {
        await lockStoppageUser(tx, input.tenantId, stoppageReferenceId(input.userId), true);
      }
      await tx.stoppageEvent.create({
        data: {
          tenantId: input.tenantId,
          stoppageId: input.stoppageId,
          userId: input.userId,
          type: input.type,
          message: input.message,
          payload: (input.payload ?? null) as any
        }
      });
    }, { maxWait: 5000, timeout: 10000 });
  }

  async listEvents(tenantId: string, stoppageId: string, take: number): Promise<StoppageEventRow[]> {
    return prisma.stoppageEvent.findMany({
      where: { ...await ownedStoppageEventsWhere(tenantId), stoppageId },
      orderBy: { createdAt: "desc" },
      take
    }) as unknown as StoppageEventRow[];
  }

  async listEventsByType(tenantId: string, stoppageId: string, type: string): Promise<StoppageEventRow[]> {
    return prisma.stoppageEvent.findMany({
      where: { ...await ownedStoppageEventsWhere(tenantId), stoppageId, type },
      orderBy: { createdAt: "desc" }
    }) as unknown as StoppageEventRow[];
  }

  async findLatestEventByType(tenantId: string, stoppageId: string, type: string): Promise<StoppageEventRow | null> {
    return (await prisma.stoppageEvent.findFirst({
      where: { ...await ownedStoppageEventsWhere(tenantId), stoppageId, type },
      orderBy: { createdAt: "desc" }
    })) as unknown as StoppageEventRow | null;
  }

  async listActiveUsers(tenantId: string): Promise<Array<{ id: string; firstName: string; lastName: string; email: string }>> {
    return prisma.user.findMany({
      where: { tenantId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, email: true }
    });
  }

  async listOpenStoppagesForAssignment(
    tenantId: string
  ): Promise<Array<{ id: string; assignedToUserId: string | null; priority: string }>> {
    return prisma.stoppage.findMany({
      where: {
        ...await ownedStoppageWhere(tenantId),
        status: { in: ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"] }
      },
      select: { id: true, assignedToUserId: true, priority: true }
    }) as unknown as Array<{ id: string; assignedToUserId: string | null; priority: string }>;
  }

  async listCalendarRows(
    tenantId: string,
    dateFrom: Date,
    dateTo: Date
  ): Promise<
    Array<{
      id: string;
      openedAt: Date;
      closedAt: Date | null;
      status: string;
      priority: string;
      vehicle: { plate: string };
      site: { name: string };
      workshop: { name: string };
    }>
  > {
    return prisma.stoppage.findMany({
      where: {
        ...await ownedStoppageWhere(tenantId),
        openedAt: { lte: dateTo },
        OR: [{ closedAt: null }, { closedAt: { gte: dateFrom } }]
      },
      include: {
        vehicle: { select: { plate: true } },
        site: { select: { name: true } },
        workshop: { select: { name: true } }
      }
    }) as unknown as Array<{
      id: string;
      openedAt: Date;
      closedAt: Date | null;
      status: string;
      priority: string;
      vehicle: { plate: string };
      site: { name: string };
      workshop: { name: string };
    }>;
  }

  async listCostRows(
    tenantId: string,
    dateFrom: Date,
    dateTo: Date
  ): Promise<
    Array<{
      openedAt: Date;
      closedAt: Date | null;
      estimatedCostPerDay: number | null;
      site: { name: string };
      workshop: { name: string };
    }>
  > {
    return prisma.stoppage.findMany({
      where: { ...await ownedStoppageWhere(tenantId), openedAt: { gte: dateFrom, lte: dateTo } },
      include: {
        site: { select: { name: true } },
        workshop: { select: { name: true } }
      }
    }) as unknown as Array<{
      openedAt: Date;
      closedAt: Date | null;
      estimatedCostPerDay: number | null;
      site: { name: string };
      workshop: { name: string };
    }>;
  }
}
