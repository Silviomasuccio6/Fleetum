import { ReminderRepository } from "../../../domain/repositories/reminder-repository.js";
import { StoppageRepository } from "../../../domain/repositories/stoppage-repository.js";
import { getSlaThresholdForPriority } from "../../services/sla-policy.js";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { EmailQueueService } from "../../../infrastructure/email/email-queue-service.js";
import {
  automaticReminderIsDue, automaticReminderTypes, lockReminderContext, ReminderStoppage
} from "../../../infrastructure/email/reminder-email-dispatch.js";
import { logger } from "../../../infrastructure/logging/logger.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { daysBetween } from "../../../shared/utils/date.js";

export class SendReminderUseCase {
  constructor(
    private readonly stoppageRepository: StoppageRepository,
    // Keep the constructor contract; queue finalization now records the
    // reminder and stoppage update in the same transaction.
    private readonly reminderRepository: ReminderRepository,
    private readonly emailQueueService: EmailQueueService
  ) {}

  private buildMessage(stoppage: ReminderStoppage, now: Date) {
    const days = daysBetween(stoppage.openedAt, now);
    const subject = `[Sollecito] Fermo ${stoppage.vehicle.plate} - ${stoppage.site.name}`;
    const body = `Buongiorno,\n\nsi richiede aggiornamento sul fermo:\n- Targa: ${stoppage.vehicle.plate}\n- Veicolo: ${stoppage.vehicle.brand} ${stoppage.vehicle.model}\n- Sede: ${stoppage.site.name}\n- Motivo: ${stoppage.reason}\n- Giorni di fermo: ${days}\n\nGrazie.`;
    return { subject, body };
  }

  async manualEmail(tenantId: string, stoppageId: string) {
    const now = new Date();
    const item = await prisma.$transaction(async (tx) => {
      const { reason, stoppage } = await lockReminderContext(tx, tenantId, stoppageId);
      if (reason || !stoppage) {
        if (reason === "STOPPAGE_MISSING" || reason === "STOPPAGE_DELETED" || reason === "STOPPAGE_RELATION_INVALID") {
          throw new AppError("Fermo non trovato", 404, "NOT_FOUND");
        }
        throw new AppError("Invio sollecito non consentito", 403, "REMINDER_NOT_ALLOWED");
      }
      const recipient = stoppage.workshopEmailSnapshot || stoppage.workshop.email;
      if (!recipient) throw new AppError("Email officina mancante", 400, "VALIDATION_ERROR");
      const { subject, body } = this.buildMessage(stoppage, now);
      return this.emailQueueService.enqueue({
        tenantId, type: "REMINDER_EMAIL", recipient, subject, body,
        meta: { tenantId, stoppageId, reminderType: "MANUAL" }
      }, tx);
    }, { maxWait: 5000, timeout: 10000 });
    // Immediate dispatch preserves the HTTP success/queued contract while all
    // sends share the worker's lease, receipt and authorization path.
    try {
      await this.emailQueueService.processPending(new Date(), { ids: [item.id], take: 1 });
      const row = await prisma.emailQueue.findUniqueOrThrow({ where: { id: item.id } });
      if (row.status === "SENT") return { success: true, queued: false };
      if (row.status === "FAILED" && row.lastError?.startsWith("REMINDER_DISPATCH_BLOCKED:")) {
        throw new AppError("Invio sollecito non consentito", 403, "REMINDER_NOT_ALLOWED");
      }
      return { success: false, queued: row.status === "PENDING" };
    } catch (error) {
      if (error instanceof AppError) throw error;
      return { success: false, queued: true };
    }
  }

  async automaticRun(now = new Date()) {
    const candidates = await this.stoppageRepository.listForAutomaticReminders(now) as Array<{ id: string; tenantId: string }>;
    let queued = 0;
    for (const candidate of candidates) {
      try {
        const item = await prisma.$transaction(async (tx) => {
          const { reason, stoppage } = await lockReminderContext(tx, candidate.tenantId, candidate.id);
          if (reason || !stoppage || !(await automaticReminderIsDue(tx, stoppage, now))) return null;
          // Include leased rows and future backoff. Every automatic producer
          // owns this stoppage lock until lookup+enqueue; finalization uses it too.
          const pending = await tx.emailQueue.findFirst({
            where: {
              tenantId: candidate.tenantId, type: "REMINDER_EMAIL", status: "PENDING",
              AND: [
                { meta: { path: ["stoppageId"], equals: candidate.id } },
                { OR: automaticReminderTypes.map((value) => ({ meta: { path: ["reminderType"], equals: value } })) }
              ]
            }, select: { id: true }
          });
          if (pending) return null;
          const recipient = stoppage.workshopEmailSnapshot || stoppage.workshop.email;
          if (!recipient) return null;
          const { subject, body } = this.buildMessage(stoppage, now);
          const sla = getSlaThresholdForPriority(stoppage.priority);
          const escalated = daysBetween(stoppage.openedAt, now) >= sla;
          return this.emailQueueService.enqueue({
            tenantId: candidate.tenantId, type: "REMINDER_EMAIL", recipient,
            subject: escalated ? "[ESCALATION] " + subject : subject,
            body: escalated ? body + `\n\nNota SLA: fermo oltre soglia (${sla} giorni) con priorita ${stoppage.priority}.` : body,
            meta: { tenantId: candidate.tenantId, stoppageId: candidate.id,
              reminderType: escalated ? "ESCALATION" : "AUTOMATIC" }
          }, tx);
        }, { maxWait: 5000, timeout: 10000 });
        if (!item) continue;
        queued += 1;
        await this.emailQueueService.processPending(new Date(Math.max(now.getTime(), Date.now())), { ids: [item.id], take: 1 });
      } catch {
        // Isolate failed preparation/dispatch without logging payloads or
        // provider errors. An already persisted command remains recoverable.
        logger.warn({ stoppageId: candidate.id }, "Automatic reminder preparation or dispatch failed");
      }
    }
    return { processed: candidates.length, queued };
  }
}
