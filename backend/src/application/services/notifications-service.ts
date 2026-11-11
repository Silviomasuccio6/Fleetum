import { NotificationsRepository } from "../../domain/repositories/notifications-repository.js";
import { stoppageStatusLabel } from "../../shared/utils/stoppage-status-label.js";

export class NotificationsService {
  constructor(private readonly repository: NotificationsRepository) {}

  private startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  }

  async inbox(tenantId: string) {
    const now = new Date();
    const [openStoppages, failedReminders, invitedUsers, vehicleDeadlineCandidates] = await Promise.all([
      this.repository.listOpenStoppages(tenantId, 30),
      this.repository.listFailedReminders(tenantId, 20),
      this.repository.listInvitedUsers(tenantId, 20),
      this.repository.listVehicleDeadlineCandidates(tenantId, 200)
    ]);

    const stoppageItems = openStoppages
      .map((item) => {
        const days = Math.floor((now.getTime() - item.openedAt.getTime()) / 86400000);
        if (days < 4) return null;
        return {
          id: `stoppage-${item.id}`,
          type: "STOPPAGE_OVERDUE",
          severity: days > 15 ? "HIGH" : days > 8 ? "MEDIUM" : "LOW",
          title: `${item.vehicle.plate} fermo da ${days} giorni`,
          description: `${item.site.name} · ${item.workshop.name} · ${stoppageStatusLabel(item.status)}`,
          createdAt: item.openedAt
        };
      })
      .filter(Boolean);

    const reminderItems = failedReminders.map((item) => ({
      id: `reminder-${item.id}`,
      type: "REMINDER_FAILED",
      severity: "MEDIUM",
      title: "Reminder non inviato",
      description: `${item.recipient} · Invio non riuscito. Controlla il sollecito prima di riprovare.`,
      createdAt: item.sentAt
    }));

    const inviteItems = invitedUsers.map((user) => ({
      id: `invite-${user.id}`,
      type: "USER_INVITED_PENDING",
      severity: "LOW",
      title: "Utente invitato non ancora attivo",
      description: `${user.firstName} ${user.lastName} · ${user.email}`,
      createdAt: user.createdAt
    }));

    const today = this.startOfDay(now);
    const kmWarning = 1000;
    const revisionWarningDays = 30;

    const deadlineItems = vehicleDeadlineCandidates
      .map((vehicle) => {
        const baselineKm = typeof vehicle.maintenances[0]?.kmAtService === "number" ? vehicle.maintenances[0]!.kmAtService : null;
        const currentKm = typeof vehicle.currentKm === "number" ? vehicle.currentKm : null;
        const intervalKm = typeof vehicle.maintenanceIntervalKm === "number" ? vehicle.maintenanceIntervalKm : null;

        let remainingKm: number | null = null;
        if (currentKm !== null && intervalKm !== null) {
          const driven = baselineKm !== null && currentKm >= baselineKm ? currentKm - baselineKm : ((currentKm % intervalKm) + intervalKm) % intervalKm;
          remainingKm = intervalKm - driven;
        }
        const dueByKm = remainingKm !== null ? remainingKm <= 0 : false;
        const dueSoonByKm = remainingKm !== null ? remainingKm > 0 && remainingKm <= kmWarning : false;

        const revisionStart = vehicle.revisionDueAt ? this.startOfDay(vehicle.revisionDueAt) : null;
        const daysToRevision = revisionStart ? Math.ceil((revisionStart.getTime() - today.getTime()) / 86400000) : null;
        const dueByRevision = daysToRevision !== null ? daysToRevision <= 0 : false;
        const dueSoonByRevision = daysToRevision !== null ? daysToRevision > 0 && daysToRevision <= revisionWarningDays : false;

        if (!dueByKm && !dueSoonByKm && !dueByRevision && !dueSoonByRevision) return null;

        let title = `${vehicle.plate} in scadenza`;
        let description = `${vehicle.site.name}`;
        let severity: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM";

        if (dueByKm && dueByRevision) {
          title = `${vehicle.plate} · scadenza KM + revisione`;
          description = `${vehicle.site.name} · manutenzione e revisione da fare subito`;
          severity = "HIGH";
        } else if (dueByKm) {
          title = `${vehicle.plate} · manutenzione km scaduta`;
          description = `${vehicle.site.name} · ${Math.abs(remainingKm ?? 0)} km oltre soglia`;
          severity = "HIGH";
        } else if (dueByRevision) {
          title = `${vehicle.plate} · revisione scaduta`;
          description = `${vehicle.site.name} · scaduta da ${Math.abs(daysToRevision ?? 0)} giorni`;
          severity = "HIGH";
        } else if (dueSoonByKm) {
          title = `${vehicle.plate} · manutenzione km in scadenza`;
          description = `${vehicle.site.name} · ${remainingKm} km residui`;
          severity = "MEDIUM";
        } else if (dueSoonByRevision) {
          title = `${vehicle.plate} · revisione in scadenza`;
          description = `${vehicle.site.name} · ${daysToRevision} giorni residui`;
          severity = "MEDIUM";
        }

        return {
          id: `vehicle-deadline-${vehicle.id}`,
          type: "VEHICLE_DEADLINE",
          severity,
          title,
          description,
          createdAt: vehicle.updatedAt ?? now
        };
      })
      .filter(Boolean);

    return [...stoppageItems, ...reminderItems, ...inviteItems, ...deadlineItems]
      .sort((a: any, b: any) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)))
      .slice(0, 50);
  }
}
