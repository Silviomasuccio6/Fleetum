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
const EMAIL_QUEUE_LEASE_MS = 15 * 60 * 1000;
const EMAIL_QUEUE_RETRY_MAX_DELAY_MINUTES = 60;

const leaseIsAvailable = (now: Date): Prisma.EmailQueueWhereInput => ({
  OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }]
});

const providerIdempotencyKey = (queueId: string) => `fleetum-email-queue:${queueId}`;

const retryDelayMs = (attempt: number) =>
  Math.min(2 ** attempt, EMAIL_QUEUE_RETRY_MAX_DELAY_MINUTES) * 60 * 1000;

const metaString = (meta: Record<string, unknown>, key: string) =>
  typeof meta[key] === "string" && meta[key] ? String(meta[key]) : null;

const tenantBoundTarget = <Keys extends readonly string[]>(
  queueTenantId: string | null,
  meta: Record<string, unknown>,
  label: string,
  keys: Keys
) => {
  if (!keys.some((key) => metaString(meta, key))) return null;

  const metaTenantId = metaString(meta, "tenantId");
  const values = Object.fromEntries(keys.map((key) => [key, metaString(meta, key)])) as Record<Keys[number], string | null>;
  if (!queueTenantId || metaTenantId !== queueTenantId || keys.some((key) => !metaString(meta, key))) {
    throw new Error(`Metadati coda ${label} non validi`);
  }

  return { tenantId: queueTenantId, values: values as Record<Keys[number], string> };
};

const requireSingleUpdate = (result: { count: number }, label: string) => {
  if (result.count !== 1) throw new Error(`Finalizzazione coda non riuscita: ${label}`);
};

export class EmailQueueService {
  async enqueue(input: QueueEmailInput, db: Prisma.TransactionClient | typeof prisma = prisma) {
    return db.emailQueue.create({
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
    const invocationWallClock = Date.now();
    const currentTime = () => new Date(now.getTime() + Math.max(0, Date.now() - invocationWallClock));
    const candidates = await prisma.emailQueue.findMany({
      where: {
        status: "PENDING",
        nextAttemptAt: { lte: now },
        ...leaseIsAvailable(now),
        ...(options.ids?.length ? { id: { in: options.ids } } : {})
      },
      orderBy: { createdAt: "asc" },
      take: options.take ?? 30
    });

    let processed = 0;
    for (const candidate of candidates) {
      const claimedAt = currentTime();
      const token = crypto.randomUUID();
      const claim = await prisma.emailQueue.updateMany({
        where: {
          id: candidate.id,
          status: "PENDING",
          nextAttemptAt: { lte: claimedAt },
          ...leaseIsAvailable(claimedAt)
        },
        data: {
          processingToken: token,
          processingStartedAt: claimedAt,
          leaseExpiresAt: new Date(claimedAt.getTime() + EMAIL_QUEUE_LEASE_MS)
        }
      });
      if (claim.count !== 1) continue;

      // Refresh after the compare-and-set claim. A previous lease owner may have released and
      // incremented attempts after candidate discovery but before this claim.
      const item = await prisma.emailQueue.findFirstOrThrow({
        where: { id: candidate.id, status: "PENDING", processingToken: token }
      });
      processed += 1;
      const meta = (item.meta ?? {}) as Record<string, unknown>;
      let contractTarget: {
        tenantId: string;
        values: Record<"contractDeliveryId" | "contractId" | "bookingId", string>;
      } | null = null;
      let reminderTarget: {
        tenantId: string;
        values: Record<"stoppageId" | "reminderType", string>;
      } | null = null;
      let invoiceTarget: {
        tenantId: string;
        values: Record<"invoiceDeliveryId" | "invoiceId", string>;
      } | null = null;
      let sent: Awaited<ReturnType<typeof emailSender.send>> | null = null;
      let providerAcceptedAt: string | null = null;

      try {
        contractTarget = tenantBoundTarget(
          item.tenantId,
          meta,
          "contratto",
          ["contractDeliveryId", "contractId", "bookingId"] as const
        );
        reminderTarget = tenantBoundTarget(
          item.tenantId,
          meta,
          "sollecito",
          ["stoppageId", "reminderType"] as const
        );
        invoiceTarget = tenantBoundTarget(
          item.tenantId,
          meta,
          "fattura",
          ["invoiceDeliveryId", "invoiceId"] as const
        );

        const rawAttachments = Array.isArray(meta.attachments) ? meta.attachments : [];
        const fromName = typeof meta.fromName === "string" ? meta.fromName : undefined;
        const replyTo = typeof meta.replyTo === "string" ? meta.replyTo : undefined;
        const html = typeof meta.html === "string" ? meta.html : undefined;
        const attachments = rawAttachments
          .map((x) => x as { filename?: string; contentBase64?: string; contentType?: string })
          .filter((x) => x.filename && x.contentBase64)
          .map((x) => ({
            filename: String(x.filename),
            content: Buffer.from(String(x.contentBase64), "base64"),
            contentType: x.contentType ? String(x.contentType) : undefined
          }));

        const storedProvider = metaString(meta, "emailProvider");
        const storedProviderMessageId = metaString(meta, "providerMessageId");
        providerAcceptedAt = metaString(meta, "providerAcceptedAt") ?? currentTime().toISOString();
        sent = storedProvider === "resend" && storedProviderMessageId
          ? { provider: "resend" as const, id: storedProviderMessageId }
          : await emailSender.send({
              to: item.recipient,
              subject: item.subject,
              text: item.body,
              html,
              fromName,
              replyTo,
              attachments,
              idempotencyKey: providerIdempotencyKey(item.id)
            });
        const accepted = sent;

        // The provider call cannot share our database transaction. Its stable idempotency key
        // makes a retry safe, while the queue transition and every local side effect commit
        // together. A lost commit acknowledgement therefore cannot leave a terminal queue row
        // with stale domain state.
        const finalizedAt = currentTime();
        const finalized = await prisma.$transaction(async (tx) => {
          const markedSent = await tx.emailQueue.updateMany({
            where: { id: item.id, status: "PENDING", processingToken: token },
            data: {
              status: "SENT",
              attempts: { increment: 1 },
              lastError: null,
              processingToken: null,
              processingStartedAt: null,
              leaseExpiresAt: null,
              meta: {
                ...meta,
                emailProvider: accepted.provider,
                providerMessageId: accepted.id,
                providerAcceptedAt,
                sentAt: providerAcceptedAt
              } as Prisma.InputJsonValue
            }
          });
          if (markedSent.count !== 1) return false;

          if (contractTarget) {
            requireSingleUpdate(await tx.bookingContractDelivery.updateMany({
              where: {
                id: contractTarget.values.contractDeliveryId,
                tenantId: contractTarget.tenantId,
                bookingId: contractTarget.values.bookingId,
                contractId: contractTarget.values.contractId
              },
              data: { status: "SENT", sentAt: finalizedAt, errorMessage: null }
            }), "consegna contratto");
            requireSingleUpdate(await tx.bookingContract.updateMany({
              where: {
                id: contractTarget.values.contractId,
                tenantId: contractTarget.tenantId,
                bookingId: contractTarget.values.bookingId
              },
              data: {
                emailTo: item.recipient,
                emailSubject: item.subject,
                emailBody: item.body,
                status: "SENT",
                lastSentAt: finalizedAt,
                errorMessage: null,
                updatedByUserId: metaString(meta, "actorUserId") ?? undefined
              }
            }), "contratto");
            await tx.bookingContractEvent.create({
              data: {
                tenantId: contractTarget.tenantId,
                bookingId: contractTarget.values.bookingId,
                contractId: contractTarget.values.contractId,
                actorUserId: metaString(meta, "actorUserId") ?? undefined,
                type: "EMAIL_SENT",
                message: `Contratto inviato a ${item.recipient}`,
                details: {
                  deliveryId: contractTarget.values.contractDeliveryId,
                  queueEmailId: item.id,
                  emailProvider: accepted.provider,
                  providerMessageId: accepted.id
                }
              }
            });
          }

          if (reminderTarget) {
            requireSingleUpdate(await tx.stoppage.updateMany({
              where: { id: reminderTarget.values.stoppageId, tenantId: reminderTarget.tenantId },
              data: {
                lastReminderSentAt: finalizedAt,
                totalRemindersSent: { increment: 1 },
                status: "SOLICITED"
              }
            }), "fermo per sollecito");
            await tx.reminder.create({
              data: {
                tenantId: reminderTarget.tenantId,
                stoppageId: reminderTarget.values.stoppageId,
                type: reminderTarget.values.reminderType,
                channel: "EMAIL",
                recipient: item.recipient,
                subject: item.subject,
                body: item.body,
                success: true,
                sentAt: finalizedAt
              }
            });
          }

          if (invoiceTarget) {
            requireSingleUpdate(await tx.invoice.updateMany({
              where: { id: invoiceTarget.values.invoiceId, tenantId: invoiceTarget.tenantId },
              data: { status: "SENT", sentAt: finalizedAt }
            }), "fattura");
            requireSingleUpdate(await tx.invoiceDelivery.updateMany({
              where: {
                id: invoiceTarget.values.invoiceDeliveryId,
                invoiceId: invoiceTarget.values.invoiceId
              },
              data: {
                status: "SENT",
                provider: accepted.provider,
                providerMessageId: accepted.id,
                sentAt: finalizedAt,
                errorMessage: null
              }
            }), "consegna fattura");
          }

          return true;
        });
        if (!finalized) continue;
      } catch (error) {
        const nextAttempts = item.attempts + 1;
        const failureAt = currentTime();
        const nextAttemptAt = new Date(failureAt.getTime() + retryDelayMs(nextAttempts));
        const errorMessage = error instanceof Error ? error.message : "Errore invio email";

        if (sent) {
          // The provider accepted the message. Persist its receipt on the retryable row so later
          // workers only retry local finalization and never depend on the provider dedupe window.
          await prisma.emailQueue.updateMany({
            where: { id: item.id, status: "PENDING", processingToken: token },
            data: {
              attempts: { increment: 1 },
              status: "PENDING",
              nextAttemptAt,
              lastError: `Finalizzazione locale email non riuscita: ${errorMessage}`,
              processingToken: null,
              processingStartedAt: null,
              leaseExpiresAt: null,
              meta: {
                ...meta,
                emailProvider: sent.provider,
                providerMessageId: sent.id,
                providerAcceptedAt
              } as Prisma.InputJsonValue
            }
          });
          continue;
        }

        const hasAttemptsLeft = nextAttempts < item.maxAttempts;

        try {
          await prisma.$transaction(async (tx) => {
            const released = await tx.emailQueue.updateMany({
              where: { id: item.id, status: "PENDING", processingToken: token },
              data: {
                attempts: { increment: 1 },
                status: hasAttemptsLeft ? "PENDING" : "FAILED",
                nextAttemptAt: hasAttemptsLeft ? nextAttemptAt : item.nextAttemptAt,
                lastError: errorMessage,
                processingToken: null,
                processingStartedAt: null,
                leaseExpiresAt: null
              }
            });
            if (released.count !== 1) return;

            if (contractTarget) {
              requireSingleUpdate(await tx.bookingContractDelivery.updateMany({
                where: {
                  id: contractTarget.values.contractDeliveryId,
                  tenantId: contractTarget.tenantId,
                  bookingId: contractTarget.values.bookingId,
                  contractId: contractTarget.values.contractId
                },
                data: {
                  status: hasAttemptsLeft ? "PENDING" : "FAILED",
                  errorMessage
                }
              }), "consegna contratto fallita");

              if (!hasAttemptsLeft) {
                requireSingleUpdate(await tx.bookingContract.updateMany({
                  where: {
                    id: contractTarget.values.contractId,
                    tenantId: contractTarget.tenantId,
                    bookingId: contractTarget.values.bookingId
                  },
                  data: { status: "ERROR", errorMessage }
                }), "contratto fallito");
                await tx.bookingContractEvent.create({
                  data: {
                    tenantId: contractTarget.tenantId,
                    bookingId: contractTarget.values.bookingId,
                    contractId: contractTarget.values.contractId,
                    actorUserId: metaString(meta, "actorUserId") ?? undefined,
                    type: "EMAIL_FAILED",
                    message: `Invio contratto fallito verso ${item.recipient}`,
                    details: {
                      deliveryId: contractTarget.values.contractDeliveryId,
                      queueEmailId: item.id,
                      error: errorMessage
                    }
                  }
                });
              }
            }

            if (invoiceTarget) {
              requireSingleUpdate(await tx.invoiceDelivery.updateMany({
                where: {
                  id: invoiceTarget.values.invoiceDeliveryId,
                  invoiceId: invoiceTarget.values.invoiceId
                },
                data: {
                  status: hasAttemptsLeft ? "PENDING" : "FAILED",
                  errorMessage
                }
              }), "consegna fattura fallita");
              if (!hasAttemptsLeft) {
                requireSingleUpdate(await tx.invoice.updateMany({
                  where: { id: invoiceTarget.values.invoiceId, tenantId: invoiceTarget.tenantId },
                  data: { status: "ERROR" }
                }), "fattura fallita");
              }
            }
          });
        } catch (finalizationError) {
          // Preserve a retryable row if local finalization could not be committed. This is also
          // safe after a lost commit acknowledgement because the ownership predicate no longer
          // matches a queue row that was already committed as SENT.
          const finalizationMessage = finalizationError instanceof Error
            ? finalizationError.message
            : "Finalizzazione email non riuscita";
          await prisma.emailQueue.updateMany({
            where: { id: item.id, status: "PENDING", processingToken: token },
            data: {
              attempts: { increment: 1 },
              status: "PENDING",
              nextAttemptAt,
              lastError: `${errorMessage}; ${finalizationMessage}`,
              processingToken: null,
              processingStartedAt: null,
              leaseExpiresAt: null
            }
          });
        }
      }
    }

    return { processed };
  }
}
