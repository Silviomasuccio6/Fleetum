import crypto from "node:crypto";
import type { EmailQueue, Prisma, RentalExtraCharge } from "@prisma/client";
import { LicensePolicyService } from "../../application/services/license-policy-service.js";
import { snapshotFromRow } from "../../application/services/tenant-subscription-service.js";
import { AppError } from "../../shared/errors/app-error.js";
import { prisma } from "../database/prisma/client.js";
import { logger } from "../logging/logger.js";
import { createAuditLog } from "../repositories/prisma-audit-log-repository.js";
import type { EmailQueueService } from "./email-queue-service.js";
import type { emailSender } from "./email-sender.js";

const noticeType = "RENTAL_EXTRA_CHARGE_NOTICE";
const resource = "rental-extra-charge";
const queuedAction = "RENTAL_EXTRA_CHARGE_NOTICE_QUEUED";
const acceptedAction = "RENTAL_EXTRA_CHARGE_NOTIFIED";
type Receipt = Awaited<ReturnType<typeof emailSender.send>>;
type QueueItem = Pick<EmailQueue, "id" | "tenantId" | "createdAt" | "meta" | "recipient" | "subject" | "body" | "deduplicationKey">;
type NoticeContext = {
  tenantId: string; extraChargeId: string; bookingId: string; rentalCustomerId: string;
  vehicleId: string | null; bookingVehicleId: string; siteId: string; type: string;
  currency: string; amountCents: number; adminFeeCents: number; totalAmountCents: number; description: string;
};
const metaOf = (item: Pick<QueueItem, "meta">) => (item.meta ?? {}) as Record<string, unknown>;
const stringOf = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const keyFor = (tenantId: string, extraId: string) => `extra-notice:v1:${tenantId}:${extraId}`;
const fingerprint = (context: NoticeContext, payload: Pick<QueueItem, "recipient" | "subject" | "body">) =>
  // PostgreSQL JSONB reorders object keys. Hash a fixed field sequence so the
  // persisted context has the same fingerprint as its in-memory producer.
  crypto.createHash("sha256").update(JSON.stringify([
    context.tenantId, context.extraChargeId, context.bookingId, context.rentalCustomerId,
    context.vehicleId, context.bookingVehicleId, context.siteId, context.type, context.currency,
    context.amountCents, context.adminFeeCents, context.totalAmountCents, context.description,
    payload.recipient, payload.subject, payload.body
  ])).digest("hex");
function deny(reason: string): never { throw new AppError("Notifica extra non consentita", 409, "EXTRA_NOTICE_" + reason); }

// Tenant/license -> Extra -> Vehicle -> Site -> Booking -> Customer -> Queue.
// The Vehicle-before-Booking order matches booking mutations. Historical User
// ownership is read without row locks, matching auth's User -> Tenant FK order.
const lockContext = async (tx: Prisma.TransactionClient, tenantId: string, extraId: string) => {
  const hadSubscription = Boolean(await tx.tenantSubscription.findUnique({ where: { tenantId }, select: { tenantId: true } }));
  const tenants = hadSubscription
    ? await tx.$queryRaw<Array<{ isActive: boolean; deletedAt: Date | null }>>`
        SELECT "isActive", "deletedAt" FROM "Tenant" WHERE "id" = ${tenantId} FOR SHARE
      `
    : await tx.$queryRaw<Array<{ isActive: boolean; deletedAt: Date | null }>>`
        SELECT "isActive", "deletedAt" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE
      `;
  const tenant = tenants[0];
  if (!tenant || tenant.deletedAt || !tenant.isActive) deny("TENANT_UNAVAILABLE");
  const subscriptions = await tx.$queryRaw<Array<{ tenantId: string }>>`
    SELECT "tenantId" FROM "TenantSubscription" WHERE "tenantId" = ${tenantId} FOR UPDATE
  `;
  if (hadSubscription && !subscriptions.length) deny("LICENSE_CHANGED");
  const policy = new LicensePolicyService({
    getLatestByAction: (owner, target, action) => tx.auditLog.findFirst({
      where: { tenantId: owner, resource: target, action }, orderBy: { createdAt: "desc" }
    })
  }, async (owner) => {
    const row = await tx.tenantSubscription.findUnique({ where: { tenantId: owner } });
    return row ? snapshotFromRow(row) : null;
  });
  const license = await policy.getTenantLicense(tenantId);
  if (license.status !== "ACTIVE" && license.status !== "TRIAL") deny("LICENSE_" + license.status);
  await tx.$queryRaw`
    SELECT "id" FROM "RentalExtraCharge" WHERE "id" = ${extraId} AND "tenantId" = ${tenantId} FOR UPDATE
  `;
  const extra = await tx.rentalExtraCharge.findFirst({ where: { id: extraId, tenantId, deletedAt: null } });
  if (!extra) throw new AppError("Extra non trovato", 404, "EXTRA_NOTICE_NOT_FOUND");
  const foundBooking = await tx.rentalBooking.findFirst({ where: { id: extra.bookingId, tenantId, deletedAt: null } });
  if (!foundBooking) deny("BOOKING_UNAVAILABLE");
  const booking = foundBooking!;
  const vehicles = await tx.$queryRaw<Array<{ id: string; siteId: string }>>`
    SELECT "id", "siteId" FROM "Vehicle" WHERE "id" = ${booking.vehicleId} AND "tenantId" = ${tenantId} FOR SHARE
  `;
  if (!vehicles[0]) deny("VEHICLE_UNAVAILABLE");
  const vehicle = vehicles[0]!;
  const sites = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Site" WHERE "id" = ${vehicle.siteId} AND "tenantId" = ${tenantId} FOR SHARE
  `;
  if (!sites.length) deny("SITE_UNAVAILABLE");
  await tx.$queryRaw`
    SELECT "id" FROM "RentalBooking" WHERE "id" = ${booking.id} AND "tenantId" = ${tenantId} FOR SHARE
  `;
  const currentBooking = await tx.rentalBooking.findFirst({ where: { id: booking.id, tenantId, deletedAt: null } });
  if (!currentBooking || currentBooking.vehicleId !== vehicle.id || currentBooking.status === "CANCELED") deny("BOOKING_CHANGED");
  if (currentBooking!.customerId !== extra.rentalCustomerId || (extra.vehicleId && extra.vehicleId !== vehicle.id)) deny("RELATION_MISMATCH");
  await tx.$queryRaw`
    SELECT "id" FROM "RentalCustomer" WHERE "id" = ${extra.rentalCustomerId} AND "tenantId" = ${tenantId} FOR SHARE
  `;
  const customer = await tx.rentalCustomer.findFirst({ where: { id: extra.rentalCustomerId, tenantId, deletedAt: null } });
  if (!customer) deny("CUSTOMER_UNAVAILABLE");
  for (const id of [extra.createdByUserId, extra.approvedByUserId, currentBooking!.createdByUserId].filter(Boolean)) {
    if (!await tx.user.findFirst({ where: { id: id!, tenantId }, select: { id: true } })) deny("ACTOR_OWNERSHIP");
  }
  const recipient = customer!.email ?? currentBooking!.customerEmail;
  if (!recipient) deny("RECIPIENT_MISSING");
  const context: NoticeContext = {
    tenantId, extraChargeId: extra.id, bookingId: currentBooking!.id, rentalCustomerId: extra.rentalCustomerId,
    vehicleId: extra.vehicleId, bookingVehicleId: vehicle.id, siteId: vehicle.siteId, type: extra.type,
    currency: extra.currency, amountCents: extra.amountCents, adminFeeCents: extra.adminFeeCents,
    totalAmountCents: extra.totalAmountCents, description: extra.description
  };
  const payload = {
    recipient,
    subject: `Preavviso addebito extra noleggio ${currentBooking!.code}`,
    body: [
      `Gentile ${currentBooking!.customerName},`,
      "ti informiamo che e stato registrato un importo extra collegato al tuo noleggio.",
      `Causale: ${extra.description}`,
      `Importo: ${(extra.totalAmountCents / 100).toFixed(2)} ${extra.currency}`,
      "Se hai domande contatta l'autonoleggio prima dell'addebito."
    ].join("\n\n")
  };
  return { extra, context, payload, licenseExpiresAt: license.expiresAt ? Date.parse(license.expiresAt) : null };
};

// Preserve the queue's original context independently of lifecycle/timestamp
// changes after acceptance. Dispatch additionally compares the current context.
const verifiedContext = (item: QueueItem): NoticeContext | null => {
  const meta = metaOf(item);
  const raw = meta.noticeContext;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as NoticeContext;
  const fields = ["tenantId", "extraChargeId", "bookingId", "rentalCustomerId", "bookingVehicleId", "siteId", "type", "currency", "description"] as const;
  if (fields.some((field) => typeof c[field] !== "string") || !c.tenantId || !c.extraChargeId ||
      !(c.vehicleId === null || typeof c.vehicleId === "string") ||
      [c.amountCents, c.adminFeeCents, c.totalAmountCents].some((n) => !Number.isSafeInteger(n))) return null;
  if (meta.contextVersion !== 1 || item.tenantId !== c.tenantId || meta.tenantId !== c.tenantId ||
      meta.extraChargeId !== c.extraChargeId || meta.bookingId !== c.bookingId ||
      meta.rentalCustomerId !== c.rentalCustomerId || meta.type !== c.type ||
      item.deduplicationKey !== keyFor(c.tenantId, c.extraChargeId) || meta.contextHash !== fingerprint(c, item)) return null;
  return c;
};

export type ExtraNoticeStatus = "NONE" | "PENDING" | "SENT" | "FAILED" | "BLOCKED" | "LEGACY_UNVERIFIED";
export const withExtraChargeNoticeStates = async <T extends { id: string; status: string; notifiedAt?: Date | null }>(tenantId: string, rows: T[]) => {
  if (!rows.length) return rows;
  const audits = await prisma.auditLog.findMany({ where: {
    tenantId, resource, resourceId: { in: rows.map((row) => row.id) }, action: { in: [queuedAction, acceptedAction] }
  }, orderBy: { createdAt: "desc" } });
  const queueIds = audits.filter((row) => row.action === queuedAction).map((row) => stringOf((row.details as any)?.queueEmailId)).filter((id): id is string => Boolean(id));
  const queues = await prisma.emailQueue.findMany({ where: { tenantId, type: noticeType, id: { in: queueIds } } });
  return rows.map((row) => {
    const own = audits.filter((audit) => audit.resourceId === row.id);
    const accepted = own.find((audit) => {
      const d = (audit.details ?? {}) as Record<string, unknown>;
      return audit.action === acceptedAction && d.contextVersion === 1 && d.emailProvider === "resend" &&
        stringOf(d.providerMessageId) && typeof d.providerAcceptedAt === "string" && Number.isFinite(Date.parse(d.providerAcceptedAt));
    });
    const command = own.find((audit) => audit.action === queuedAction);
    const queueId = stringOf((command?.details as any)?.queueEmailId);
    const queue = queues.find((item) => item.id === queueId);
    let notificationStatus: ExtraNoticeStatus = accepted ? "SENT" : "NONE";
    if (!accepted && command) notificationStatus = queue?.status === "PENDING" ? "PENDING"
      : queue?.status === "FAILED" ? (metaOf(queue).dispatchBlockedReason ? "BLOCKED" : "FAILED") : "LEGACY_UNVERIFIED";
    if (!accepted && !command && row.status === "NOTIFIED") notificationStatus = "LEGACY_UNVERIFIED";
    return { ...row, notificationStatus, notifiedAt: accepted ? new Date(String((accepted.details as any).providerAcceptedAt)) : null };
  });
};

export const requestExtraChargeNotice = async (
  input: { tenantId: string; extraChargeId: string; userId: string },
  queueService: Pick<EmailQueueService, "enqueueManyOnce">
) => {
  const extra = await prisma.$transaction(async (tx) => {
    const locked = await lockContext(tx, input.tenantId, input.extraChargeId);
    const actor = await tx.user.findFirst({ where: { id: input.userId, tenantId: input.tenantId, status: "ACTIVE", deletedAt: null }, select: { id: true } });
    if (!actor) deny("ACTOR_UNAVAILABLE");
    const key = keyFor(input.tenantId, locked.extra.id);
    const command = await tx.auditLog.findFirst({ where: { tenantId: input.tenantId, action: queuedAction, resource, resourceId: locked.extra.id } });
    if (command) {
      if (locked.extra.status !== "APPROVED" && locked.extra.status !== "NOTIFIED") deny("STATUS_INVALID");
      return locked.extra;
    }
    if (locked.extra.status !== "APPROVED") deny("STATUS_INVALID");
    if (locked.licenseExpiresAt !== null && locked.licenseExpiresAt < Date.now()) deny("LICENSE_EXPIRED");
    const meta = {
      tenantId: input.tenantId, extraChargeId: locked.extra.id, bookingId: locked.extra.bookingId,
      rentalCustomerId: locked.extra.rentalCustomerId, type: locked.extra.type, actorUserId: input.userId,
      contextVersion: 1, noticeContext: locked.context, contextHash: fingerprint(locked.context, locked.payload)
    };
    await queueService.enqueueManyOnce([{ tenantId: input.tenantId, type: noticeType, ...locked.payload, meta, deduplicationKey: key }], tx);
    const queued = await tx.emailQueue.findFirst({ where: { tenantId: input.tenantId, type: noticeType, deduplicationKey: key } });
    if (!queued || !verifiedContext(queued)) deny("COMMAND_INVALID");
    await createAuditLog(tx, { tenantId: input.tenantId, userId: input.userId, action: queuedAction, resource, resourceId: locked.extra.id,
      details: { bookingId: locked.extra.bookingId, queueEmailId: queued.id, contextVersion: 1 } });
    return locked.extra;
  }, { maxWait: 5000, timeout: 10000 });
  return (await withExtraChargeNoticeStates(input.tenantId, [extra]))[0]!;
};

export const dispatchExtraChargeNotice = async (
  item: QueueItem, processingToken: string, currentTime: () => Date, leaseMs: number, startDelivery: () => Promise<Receipt>
): Promise<Receipt | null> => {
  const meta = metaOf(item);
  const delivery: { outcome?: Promise<{ receipt: Receipt } | { error: unknown }> } = {};
  try {
    await prisma.$transaction(async (tx) => {
      let reason: string | null = null;
      let licenseExpiresAt: number | null = null;
      const context = verifiedContext(item);
      if (!context || ["html", "replyTo", "fromName", "attachments"].some((key) => Object.hasOwn(meta, key))) reason = "METADATA_INVALID";
      else {
        try {
          const current = await lockContext(tx, context.tenantId, context.extraChargeId);
          licenseExpiresAt = current.licenseExpiresAt;
          if (current.extra.status !== "APPROVED") reason = "EXTRA_STATUS_CHANGED";
          else if (fingerprint(current.context, current.payload) !== meta.contextHash) reason = "CONTEXT_CHANGED";
          else if (await tx.auditLog.findFirst({ where: { tenantId: context.tenantId, resource: "tenant", action: "PLATFORM_TENANT_STATUS_CHANGED", createdAt: { gte: item.createdAt } }, select: { id: true } })) reason = "TENANT_STATUS_CHANGED";
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          reason = error.code;
        }
      }
      const checkedAt = currentTime();
      const owned = await tx.emailQueue.updateMany({ where: { id: item.id, status: "PENDING", processingToken, leaseExpiresAt: { gt: checkedAt } }, data: { leaseExpiresAt: new Date(checkedAt.getTime() + leaseMs) } });
      if (owned.count !== 1) return;
      // Row locks cannot freeze wall time. The license may expire while a
      // domain/queue lock is being acquired after the initial policy check.
      if (!reason && licenseExpiresAt !== null && licenseExpiresAt < Date.now()) reason = "LICENSE_EXPIRED";
      if (reason) {
        await tx.emailQueue.updateMany({ where: { id: item.id, status: "PENDING", processingToken }, data: {
          status: "FAILED", lastError: "EXTRA_NOTICE_DISPATCH_BLOCKED:" + reason,
          processingToken: null, processingStartedAt: null, leaseExpiresAt: null,
          meta: { ...meta, dispatchBlockedReason: reason, dispatchBlockedAt: currentTime().toISOString() } as Prisma.InputJsonValue
        } });
        return;
      }
      // Initiate under the authorization locks; wait for the network outside.
      delivery.outcome = startDelivery().then((receipt) => ({ receipt }), (error: unknown) => ({ error }));
    }, { maxWait: 5000, timeout: 10000 });
  } catch (error) {
    if (!delivery.outcome) throw error;
    logger.warn({ queueId: item.id }, "Extra notice guard commit uncertain after provider initiation");
  }
  if (!delivery.outcome) return null;
  const outcome = await delivery.outcome;
  if ("error" in outcome) throw outcome.error;
  return outcome.receipt;
};

export type ExtraNoticeFinalizationContext = { extra: RentalExtraCharge | null; skipReason: string | null; actorUserId?: string | null };
export const lockExtraNoticeFinalization = async (tx: Prisma.TransactionClient, item: QueueItem): Promise<ExtraNoticeFinalizationContext> => {
  const context = verifiedContext(item);
  const meta = metaOf(item);
  if (!context) return { extra: null, skipReason: "CONTEXT_UNVERIFIED" };
  // Accepted receipt recovery is local bookkeeping; suspension must never
  // cause a second provider send or erase an already accepted notification.
  await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${context.tenantId} FOR KEY SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "RentalExtraCharge" WHERE "id" = ${context.extraChargeId} AND "tenantId" = ${context.tenantId} FOR UPDATE`;
  const extra = await tx.rentalExtraCharge.findFirst({ where: { id: context.extraChargeId, tenantId: context.tenantId, deletedAt: null } });
  if (!extra || extra.bookingId !== context.bookingId || extra.rentalCustomerId !== context.rentalCustomerId ||
      extra.vehicleId !== context.vehicleId || extra.type !== context.type) return { extra: null, skipReason: "TARGET_CHANGED" };
  const booking = await tx.rentalBooking.findFirst({ where: { id: context.bookingId, tenantId: context.tenantId, deletedAt: null,
    customerId: context.rentalCustomerId, vehicleId: context.bookingVehicleId,
    vehicle: { tenantId: context.tenantId, site: { tenantId: context.tenantId } },
    customer: { tenantId: context.tenantId, deletedAt: null }
  }, select: { id: true } });
  if (!booking) return { extra: null, skipReason: "TARGET_CHANGED" };
  const acceptedAt = stringOf(meta.providerAcceptedAt);
  // The worker passes a new receipt timestamp to finalization. Legacy stored
  // receipts without a timestamp cannot claim a domain date.
  if (meta.emailProvider && (!acceptedAt || !Number.isFinite(Date.parse(acceptedAt)))) return { extra: null, skipReason: "ACCEPTED_AT_UNVERIFIED" };
  const actorId = stringOf(meta.actorUserId);
  const actor = actorId ? await tx.user.findFirst({ where: { id: actorId, tenantId: context.tenantId }, select: { id: true } }) : null;
  return { extra, skipReason: null, actorUserId: actor?.id ?? null };
};

export const finalizeExtraNotice = async (
  tx: Prisma.TransactionClient, item: QueueItem, context: ExtraNoticeFinalizationContext,
  receipt: Receipt, acceptedAt: Date | null
) => {
  if (!context.extra) return;
  if (!stringOf(receipt.id) || !acceptedAt || !Number.isFinite(acceptedAt.getTime())) throw new Error("Extra notice receipt is not verifiable");
  const extra = context.extra;
  const updated = await tx.rentalExtraCharge.updateMany({ where: { id: extra.id, tenantId: extra.tenantId, deletedAt: null }, data: {
    notifiedAt: acceptedAt, ...(extra.status === "APPROVED" ? { status: "NOTIFIED" as const } : {})
  } });
  if (updated.count !== 1) throw new Error("Extra notice target changed during finalization");
  await createAuditLog(tx, { tenantId: extra.tenantId, userId: context.actorUserId, action: acceptedAction, resource, resourceId: extra.id,
    details: { bookingId: extra.bookingId, queueEmailId: item.id, contextVersion: 1, emailProvider: receipt.provider,
      providerMessageId: receipt.id, providerAcceptedAt: acceptedAt.toISOString() } });
};
