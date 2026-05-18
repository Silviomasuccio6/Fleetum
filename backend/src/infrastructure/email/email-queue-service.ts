import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../database/prisma/client.js";
import { emailSender } from "./email-sender.js";

export type QueueEmailInput = {
  tenantId?: string;
  type: string;
  recipient: string;
  subject: string;
  body: string;
  meta?: Record<string, unknown>;
};

export const createRawToken = () => crypto.randomBytes(24).toString("hex");
export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export class EmailQueueService {
  async enqueue(input: QueueEmailInput) {
    return prisma.emailQueue.create({
      data: {
        tenantId: input.tenantId,
        type: input.type,
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        meta: (input.meta ?? undefined) as Prisma.InputJsonValue | undefined
      }
    });
  }

  async processPending(now = new Date(), options: { ids?: string[]; take?: number } = {}) {
    const pending = await prisma.emailQueue.findMany({
      where: {
        status: "PENDING",
        nextAttemptAt: { lte: now },
        ...(options.ids?.length ? { id: { in: options.ids } } : {})
      },
      orderBy: { createdAt: "asc" },
      take: options.take ?? 30
    });

    for (const item of pending) {
      const meta = (item.meta ?? {}) as Record<string, unknown>;
      try {
        const rawAttachments = Array.isArray(meta.attachments) ? meta.attachments : [];
        const fromName = typeof meta.fromName === "string" ? meta.fromName : undefined;
        const replyTo = typeof meta.replyTo === "string" ? meta.replyTo : undefined;
        const attachments = rawAttachments
          .map((x) => x as { filename?: string; contentBase64?: string; contentType?: string })
          .filter((x) => x.filename && x.contentBase64)
          .map((x) => ({
            filename: String(x.filename),
            content: Buffer.from(String(x.contentBase64), "base64"),
            contentType: x.contentType ? String(x.contentType) : undefined
          }));

        const sent = await emailSender.send({ to: item.recipient, subject: item.subject, text: item.body, fromName, replyTo, attachments });

        // Mark as sent immediately after SMTP success to avoid duplicate sends on DB side-effects failures.
        await prisma.emailQueue.update({
          where: { id: item.id },
          data: {
            status: "SENT",
            attempts: { increment: 1 },
            lastError: null,
            meta: {
              ...meta,
              emailProvider: sent.provider,
              providerMessageId: sent.id,
              sentAt: new Date().toISOString()
            } as Prisma.InputJsonValue
          }
        });

        if (meta.contractDeliveryId && meta.contractId && meta.bookingId && meta.tenantId) {
          try {
            await prisma.bookingContractDelivery.update({
              where: { id: String(meta.contractDeliveryId) },
              data: { status: "SENT", sentAt: new Date(), errorMessage: null }
            });
            await prisma.bookingContract.update({
              where: { id: String(meta.contractId) },
              data: { status: "SENT", lastSentAt: new Date(), errorMessage: null }
            });
            await prisma.bookingContractEvent.create({
              data: {
                tenantId: String(meta.tenantId),
                bookingId: String(meta.bookingId),
                contractId: String(meta.contractId),
                type: "EMAIL_SENT",
                message: `Contratto inviato a ${item.recipient}`,
                details: {
                  deliveryId: String(meta.contractDeliveryId),
                  queueEmailId: item.id,
                  emailProvider: sent.provider,
                  providerMessageId: sent.id
                }
              }
            });
          } catch {
            // evitare retry duplicati: email già inviata
          }
        }

        if (meta.stoppageId && meta.tenantId && meta.reminderType) {
          try {
            await prisma.reminder.create({
              data: {
                tenantId: String(meta.tenantId),
                stoppageId: String(meta.stoppageId),
                type: String(meta.reminderType),
                channel: "EMAIL",
                recipient: item.recipient,
                subject: item.subject,
                body: item.body,
                success: true
              }
            });
            await prisma.stoppage.update({
              where: { id: String(meta.stoppageId) },
              data: { lastReminderSentAt: new Date(), totalRemindersSent: { increment: 1 }, status: "SOLICITED" }
            });
          } catch {
            // Do not throw: email already sent, avoid queue retry duplicates.
          }
        }
      } catch (error) {
        const nextAttempts = item.attempts + 1;
        const hasAttemptsLeft = nextAttempts < item.maxAttempts;
        const nextAttemptAt = new Date(now.getTime() + Math.min(2 ** nextAttempts, 60) * 60 * 1000);

        await prisma.emailQueue.update({
          where: { id: item.id },
          data: {
            attempts: { increment: 1 },
            status: hasAttemptsLeft ? "PENDING" : "FAILED",
            nextAttemptAt: hasAttemptsLeft ? nextAttemptAt : item.nextAttemptAt,
            lastError: (error as Error).message
          }
        });

        if (meta.contractDeliveryId && meta.contractId && meta.bookingId && meta.tenantId) {
          try {
            await prisma.bookingContractDelivery.update({
              where: { id: String(meta.contractDeliveryId) },
              data: { status: "FAILED", errorMessage: (error as Error).message }
            });

            if (!hasAttemptsLeft) {
              await prisma.bookingContract.update({
                where: { id: String(meta.contractId) },
                data: { status: "ERROR", errorMessage: (error as Error).message }
              });
              await prisma.bookingContractEvent.create({
                data: {
                  tenantId: String(meta.tenantId),
                  bookingId: String(meta.bookingId),
                  contractId: String(meta.contractId),
                  type: "EMAIL_FAILED",
                  message: `Invio contratto fallito verso ${item.recipient}`,
                  details: {
                    deliveryId: String(meta.contractDeliveryId),
                    queueEmailId: item.id,
                    error: (error as Error).message
                  }
                }
              });
            }
          } catch {
            // no-op
          }
        }
      }
    }

    return { processed: pending.length };
  }
}
