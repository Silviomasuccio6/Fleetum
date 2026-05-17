import { ReminderRepository } from "../../../domain/repositories/reminder-repository.js";
import { StoppageRepository } from "../../../domain/repositories/stoppage-repository.js";
import { getSlaThresholdForPriority } from "../../services/sla-policy.js";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { emailSender } from "../../../infrastructure/email/email-sender.js";
import { EmailQueueService } from "../../../infrastructure/email/email-queue-service.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { daysBetween } from "../../../shared/utils/date.js";

export class SendReminderUseCase {
  constructor(
    private readonly stoppageRepository: StoppageRepository,
    private readonly reminderRepository: ReminderRepository,
    private readonly emailQueueService: EmailQueueService
  ) {}

  private buildMessage(stoppage: any) {
    const days = daysBetween(new Date(stoppage.openedAt));
    const subject = `[Sollecito] Fermo ${stoppage.vehicle.plate} - ${stoppage.site.name}`;
    const body = `Buongiorno,\n\nsi richiede aggiornamento sul fermo:\n- Targa: ${stoppage.vehicle.plate}\n- Veicolo: ${stoppage.vehicle.brand} ${stoppage.vehicle.model}\n- Sede: ${stoppage.site.name}\n- Motivo: ${stoppage.reason}\n- Giorni di fermo: ${days}\n\nGrazie.`;
    return { subject, body };
  }

  async manualEmail(tenantId: string, stoppageId: string) {
    const stoppage = await this.stoppageRepository.getById(tenantId, stoppageId);
    if (!stoppage) throw new AppError("Fermo non trovato", 404, "NOT_FOUND");

    const recipient = (stoppage as any).workshopEmailSnapshot || (stoppage as any).workshop.email;
    if (!recipient) throw new AppError("Email officina mancante", 400, "VALIDATION_ERROR");

    const { subject, body } = this.buildMessage(stoppage);

    try {
      await emailSender.send({ to: recipient, subject, text: body });
    } catch (error) {
      await this.emailQueueService.enqueue({
        tenantId,
        type: "REMINDER_EMAIL",
        recipient,
        subject,
        body,
        meta: { tenantId, stoppageId, reminderType: "MANUAL_RETRY" }
      });
      await this.reminderRepository.create({
        tenantId,
        stoppageId,
        type: "MANUAL",
        channel: "EMAIL",
        recipient,
        subject,
        body,
        success: false,
        errorMessage: `Queued for retry: ${(error as Error).message}`
      });
      return { success: false, queued: true };
    }

    try {
      await this.reminderRepository.create({ tenantId, stoppageId, type: "MANUAL", channel: "EMAIL", recipient, subject, body });
      await this.stoppageRepository.markReminderSent(stoppageId, new Date());
      return { success: true, queued: false };
    } catch {
      return { success: true, queued: false, warning: "Email inviata ma log reminder non aggiornato" };
    }
  }

  async automaticRun(now = new Date()) {
    const stoppages = (await this.stoppageRepository.listForAutomaticReminders(now)) as any[];
    const tenantPlaybooks = new Map<string, any>();

    for (const stoppage of stoppages) {
      if (!tenantPlaybooks.has(stoppage.tenantId)) {
        const row = await prisma.auditLog.findFirst({
          where: { tenantId: stoppage.tenantId, resource: "playbooks", action: "SETTINGS_PLAYBOOKS" },
          orderBy: { createdAt: "desc" }
        });
        tenantPlaybooks.set(stoppage.tenantId, (row?.details as any) ?? {});
      }
      const playbooks = tenantPlaybooks.get(stoppage.tenantId) as any;
      const pb = playbooks?.[stoppage.status];
      const playbookDays = pb?.enabled ? Number(pb.reminderEveryDays ?? 0) : 0;
      const threshold = stoppage.reminderAfterDays ?? 0;
      const effectiveThreshold = playbookDays > 0 ? Math.min(threshold || playbookDays, playbookDays) : threshold;
      const days = daysBetween(new Date(stoppage.openedAt), now);
      const lastSentDays = stoppage.lastReminderSentAt
        ? daysBetween(new Date(stoppage.lastReminderSentAt), now)
        : Number.MAX_SAFE_INTEGER;
      if (days < effectiveThreshold || lastSentDays < effectiveThreshold) continue;

      const recipient = stoppage.workshopEmailSnapshot || stoppage.workshop.email;
      if (!recipient) continue;
      const { subject, body } = this.buildMessage(stoppage);
      const slaThreshold = getSlaThresholdForPriority(stoppage.priority);
      const isSlaBreached = days >= slaThreshold;
      const finalSubject = isSlaBreached ? `[ESCALATION] ${subject}` : subject;
      const finalBody = isSlaBreached
        ? `${body}\n\nNota SLA: fermo oltre soglia (${slaThreshold} giorni) con priorita ${stoppage.priority ?? "MEDIUM"}.`
        : body;

      try {
        await emailSender.send({ to: recipient, subject: finalSubject, text: finalBody });
      } catch (error) {
        await this.emailQueueService.enqueue({
          tenantId: stoppage.tenantId,
          type: "REMINDER_EMAIL",
          recipient,
          subject: finalSubject,
          body: finalBody,
          meta: { tenantId: stoppage.tenantId, stoppageId: stoppage.id, reminderType: "AUTOMATIC_RETRY" }
        });
        await this.reminderRepository.create({
          tenantId: stoppage.tenantId,
          stoppageId: stoppage.id,
          type: isSlaBreached ? "ESCALATION" : "AUTOMATIC",
          channel: "EMAIL",
          recipient,
          subject: finalSubject,
          body: finalBody,
          success: false,
          errorMessage: (error as Error).message
        });
        continue;
      }

      try {
        await this.reminderRepository.create({
          tenantId: stoppage.tenantId,
          stoppageId: stoppage.id,
          type: isSlaBreached ? "ESCALATION" : "AUTOMATIC",
          channel: "EMAIL",
          recipient,
          subject: finalSubject,
          body: finalBody
        });
        await this.stoppageRepository.markReminderSent(stoppage.id, now);
      } catch {
        // Email already sent: avoid enqueueing retry that would duplicate message.
      }
    }

    return { processed: stoppages.length };
  }
}
