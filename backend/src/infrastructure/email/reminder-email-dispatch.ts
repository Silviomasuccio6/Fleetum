import type { EmailQueue, Prisma } from "@prisma/client";
import { LicensePolicyService } from "../../application/services/license-policy-service.js";
import { snapshotFromRow } from "../../application/services/tenant-subscription-service.js";
import { daysBetween } from "../../shared/utils/date.js";
import { prisma } from "../database/prisma/client.js";
import { logger } from "../logging/logger.js";
import { stoppageHistoricalUsersOwned } from "../repositories/stoppage-tenant-scope.js";
import type { emailSender } from "./email-sender.js";

export const automaticReminderTypes = ["AUTOMATIC", "AUTOMATIC_RETRY", "ESCALATION"];
const manualReminderTypes = ["MANUAL", "MANUAL_RETRY"];
export const openReminderStatuses = ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"];
export type ReminderStoppage = Prisma.StoppageGetPayload<{
  include: { site: true; vehicle: true; workshop: true }
}>;
type Receipt = Awaited<ReturnType<typeof emailSender.send>>;
type Outcome = { receipt: Receipt } | { error: unknown };
type QueuedReminder = Pick<EmailQueue, "id" | "tenantId" | "createdAt" | "meta" | "recipient">;

// Producers and dispatchers use the same order: Tenant -> Subscription ->
// Stoppage -> Site/Vehicle/Workshop -> Queue. Historical users are read without
// row locks to avoid inverting auth's User -> Tenant FK. Provider finalization starts
// with Tenant too, so Reminder's FK checks cannot invert this order.
export const lockReminderContext = async (
  tx: Prisma.TransactionClient,
  tenantId: string,
  stoppageId: string
): Promise<{ reason: string | null; stoppage: ReminderStoppage | null }> => {
  const hadSubscription = Boolean(await tx.tenantSubscription.findUnique({
    where: { tenantId }, select: { tenantId: true }
  }));
  const tenants = hadSubscription
    ? await tx.$queryRaw<Array<{ isActive: boolean; deletedAt: Date | null }>>`
        SELECT "isActive", "deletedAt" FROM "Tenant" WHERE "id" = ${tenantId} FOR SHARE
      `
    : await tx.$queryRaw<Array<{ isActive: boolean; deletedAt: Date | null }>>`
        SELECT "isActive", "deletedAt" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE
      `;
  const tenant = tenants[0];
  if (!tenant) return { reason: "TENANT_MISSING", stoppage: null };
  if (tenant.deletedAt) return { reason: "TENANT_DELETED", stoppage: null };
  if (!tenant.isActive) return { reason: "TENANT_INACTIVE", stoppage: null };
  const subscriptions = await tx.$queryRaw<Array<{ tenantId: string }>>`
    SELECT "tenantId" FROM "TenantSubscription" WHERE "tenantId" = ${tenantId} FOR UPDATE
  `;
  if (hadSubscription && subscriptions.length === 0) {
    throw new Error("Reminder subscription changed before authorization");
  }
  const policy = new LicensePolicyService({
    getLatestByAction: (owner, resource, action) => tx.auditLog.findFirst({
      where: { tenantId: owner, resource, action }, orderBy: { createdAt: "desc" }
    })
  }, async (owner) => {
    const row = await tx.tenantSubscription.findUnique({ where: { tenantId: owner } });
    return row ? snapshotFromRow(row) : null;
  });
  const license = await policy.getTenantLicense(tenantId);
  if (license.status !== "ACTIVE" && license.status !== "TRIAL") {
    return { reason: "LICENSE_" + license.status, stoppage: null };
  }

  await tx.$queryRaw`
    SELECT "id" FROM "Stoppage" WHERE "id" = ${stoppageId} AND "tenantId" = ${tenantId} FOR UPDATE
  `;
  const stoppage = await tx.stoppage.findFirst({ where: { id: stoppageId, tenantId } });
  if (!stoppage) return { reason: "STOPPAGE_MISSING", stoppage: null };
  if (stoppage.deletedAt) return { reason: "STOPPAGE_DELETED", stoppage: null };
  const sites = await tx.$queryRaw<Array<{ tenantId: string; deletedAt: Date | null }>>`
    SELECT "tenantId", "deletedAt" FROM "Site" WHERE "id" = ${stoppage.siteId} FOR SHARE
  `;
  const vehicles = await tx.$queryRaw<Array<{ tenantId: string; siteId: string; deletedAt: Date | null }>>`
    SELECT "tenantId", "siteId", "deletedAt" FROM "Vehicle" WHERE "id" = ${stoppage.vehicleId} FOR SHARE
  `;
  const workshops = await tx.$queryRaw<Array<{ tenantId: string; deletedAt: Date | null; isActive: boolean }>>`
    SELECT "tenantId", "deletedAt", "isActive" FROM "Workshop" WHERE "id" = ${stoppage.workshopId} FOR SHARE
  `;
  if ([sites[0], vehicles[0], workshops[0]].some((row) => !row || row.tenantId !== tenantId || row.deletedAt)) {
    return { reason: "STOPPAGE_RELATION_INVALID", stoppage: null };
  }
  const vehicleSites = await tx.$queryRaw<Array<{ tenantId: string }>>`
    SELECT "tenantId" FROM "Site" WHERE "id" = ${vehicles[0].siteId} FOR SHARE
  `;
  if (!vehicleSites.length || vehicleSites[0].tenantId !== tenantId) {
    return { reason: "STOPPAGE_RELATION_INVALID", stoppage: null };
  }
  if (!workshops[0].isActive) return { reason: "WORKSHOP_INACTIVE", stoppage: null };
  if (!(await stoppageHistoricalUsersOwned(tx, tenantId, stoppage))) {
    return { reason: "STOPPAGE_RELATION_INVALID", stoppage: null };
  }
  // Inactive but non-deleted sites/vehicles can still have an operational
  // stoppage. No existing rule requires them to be active for a reminder.
  return {
    reason: null,
    stoppage: await tx.stoppage.findFirstOrThrow({
      where: { id: stoppageId, tenantId }, include: { site: true, vehicle: true, workshop: true }
    })
  };
};

export const automaticReminderIsDue = async (
  tx: Prisma.TransactionClient, stoppage: ReminderStoppage, now: Date
) => {
  if (!openReminderStatuses.includes(stoppage.status) || stoppage.reminderAfterDays === null) return false;
  const row = await tx.auditLog.findFirst({
    where: { tenantId: stoppage.tenantId, resource: "playbooks", action: "SETTINGS_PLAYBOOKS" },
    orderBy: { createdAt: "desc" }
  });
  const playbooks = (row?.details ?? {}) as Record<string, { enabled?: boolean; reminderEveryDays?: unknown }>;
  const playbook = playbooks[stoppage.status];
  const playbookDays = playbook?.enabled ? Number(playbook.reminderEveryDays ?? 0) : 0;
  const threshold = stoppage.reminderAfterDays;
  const effective = Number.isFinite(playbookDays) && playbookDays > 0
    ? Math.min(threshold || playbookDays, playbookDays) : threshold;
  return daysBetween(stoppage.openedAt, now) >= effective &&
    (!stoppage.lastReminderSentAt || daysBetween(stoppage.lastReminderSentAt, now) >= effective);
};

export const dispatchReminderEmail = async (
  item: QueuedReminder, processingToken: string, currentTime: () => Date,
  leaseMs: number, startDelivery: () => Promise<Receipt>
): Promise<Receipt | null> => {
  const meta = (item.meta ?? {}) as Record<string, unknown>;
  const tenantId = item.tenantId;
  const stoppageId = typeof meta.stoppageId === "string" ? meta.stoppageId : "";
  const reminderType = typeof meta.reminderType === "string" ? meta.reminderType : "";
  const isAutomatic = automaticReminderTypes.includes(reminderType);
  const delivery: { outcome?: Promise<Outcome> } = {};
  try {
    await prisma.$transaction(async (tx) => {
      let reason: string | null = null;
      let stoppage: ReminderStoppage | null = null;
      if (!tenantId || meta.tenantId !== tenantId || !stoppageId ||
          (!isAutomatic && !manualReminderTypes.includes(reminderType))) {
        reason = "METADATA_INVALID";
      } else {
        const context = await lockReminderContext(tx, tenantId, stoppageId);
        reason = context.reason; stoppage = context.stoppage;
        if (!reason && stoppage) {
          const statusChanged = await tx.auditLog.findFirst({
            where: { tenantId, resource: "tenant", action: "PLATFORM_TENANT_STATUS_CHANGED",
              createdAt: { gte: item.createdAt } }, select: { id: true }
          });
          if (statusChanged) reason = "TENANT_STATUS_CHANGED";
          else if ((stoppage.workshopEmailSnapshot || stoppage.workshop.email) !== item.recipient) {
            reason = "RECIPIENT_CHANGED";
          } else if (isAutomatic && !(await automaticReminderIsDue(tx, stoppage, currentTime()))) {
            reason = "STOPPAGE_NOT_DUE";
          }
        }
      }
      const checkedAt = currentTime();
      const owned = await tx.emailQueue.updateMany({
        where: { id: item.id, status: "PENDING", processingToken, leaseExpiresAt: { gt: checkedAt } },
        data: { leaseExpiresAt: new Date(checkedAt.getTime() + leaseMs) }
      });
      if (owned.count !== 1) return;
      if (reason) {
        await tx.emailQueue.updateMany({
          where: { id: item.id, status: "PENDING", processingToken },
          data: {
            status: "FAILED", lastError: "REMINDER_DISPATCH_BLOCKED:" + reason,
            processingToken: null, processingStartedAt: null, leaseExpiresAt: null,
            meta: { ...meta, dispatchBlockedReason: reason, dispatchBlockedAt: currentTime().toISOString() } as Prisma.InputJsonValue
          }
        });
        return;
      }
      // The sender contract initiates fetch before returning the Promise.
      // Observe rejection now, release locks, then await the network outside.
      delivery.outcome = startDelivery().then(
        (receipt) => ({ receipt }), (error: unknown) => ({ error })
      );
    }, { maxWait: 5000, timeout: 10000 });
  } catch (error) {
    if (!delivery.outcome) throw error;
    logger.warn({ queueId: item.id }, "Reminder guard commit uncertain after provider initiation");
  }
  if (!delivery.outcome) return null;
  const outcome = await delivery.outcome;
  if ("error" in outcome) throw outcome.error;
  return outcome.receipt;
};
