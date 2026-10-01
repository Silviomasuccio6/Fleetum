import {
  NotificationInvitedUserRow,
  NotificationReminderRow,
  NotificationsRepository,
  NotificationStoppageRow,
  NotificationVehicleDeadlineRow
} from "../../domain/repositories/notifications-repository.js";
import { prisma } from "../database/prisma/client.js";
import { ownedStoppageWhere } from "./stoppage-tenant-scope.js";

export class PrismaNotificationsRepository implements NotificationsRepository {
  async listOpenStoppages(tenantId: string, take: number): Promise<NotificationStoppageRow[]> {
    const stoppageScope = await ownedStoppageWhere(tenantId);
    return prisma.stoppage.findMany({
      where: {
        ...stoppageScope,
        status: { in: ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"] }
      },
      include: { vehicle: { select: { plate: true } }, site: { select: { name: true } }, workshop: { select: { name: true } } },
      orderBy: { openedAt: "asc" },
      take
    }) as unknown as NotificationStoppageRow[];
  }

  async listFailedReminders(tenantId: string, take: number): Promise<NotificationReminderRow[]> {
    const historicalStoppageScope = await ownedStoppageWhere(tenantId, prisma, true);
    return prisma.reminder.findMany({
      where: { tenantId, success: false, stoppage: historicalStoppageScope },
      orderBy: { sentAt: "desc" },
      take,
      select: { id: true, recipient: true, errorMessage: true, sentAt: true }
    }) as unknown as NotificationReminderRow[];
  }

  async listInvitedUsers(tenantId: string, take: number): Promise<NotificationInvitedUserRow[]> {
    return prisma.user.findMany({
      where: { tenantId, status: "INVITED", deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take
    }) as unknown as NotificationInvitedUserRow[];
  }

  async listVehicleDeadlineCandidates(tenantId: string, take: number): Promise<NotificationVehicleDeadlineRow[]> {
    return prisma.vehicle.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      orderBy: [{ updatedAt: "desc" }],
      take,
      select: {
        id: true,
        plate: true,
        brand: true,
        model: true,
        updatedAt: true,
        currentKm: true,
        maintenanceIntervalKm: true,
        revisionDueAt: true,
        site: { select: { name: true } },
        maintenances: {
          where: { tenantId, deletedAt: null },
          orderBy: [{ performedAt: "desc" }, { createdAt: "desc" }],
          take: 1,
          select: { performedAt: true, kmAtService: true }
        }
      }
    }) as unknown as NotificationVehicleDeadlineRow[];
  }
}
