import type { EmailQueue, Prisma } from "@prisma/client";
import { hasFeature } from "../../application/services/feature-entitlements-service.js";
import { LicensePolicyService } from "../../application/services/license-policy-service.js";
import { snapshotFromRow } from "../../application/services/tenant-subscription-service.js";
import { prisma } from "../database/prisma/client.js";
import type { emailSender } from "./email-sender.js";
import { logger } from "../logging/logger.js";

type Receipt = Awaited<ReturnType<typeof emailSender.send>>;
type Outcome = { receipt: Receipt } | { error: unknown };
type QueuedReport = Pick<EmailQueue, "id" | "tenantId" | "createdAt" | "meta">;

export const dispatchScheduledReport = async (
  item: QueuedReport,
  processingToken: string,
  currentTime: () => Date,
  leaseMs: number,
  startDelivery: () => Promise<Receipt>
): Promise<Receipt | null> => {
  // A present subscription allows SHARE on Tenant: it is compatible with the
  // FK checks of subscription writers. If absent, UPDATE prevents a concurrent
  // subscription insert from changing the legacy-license decision.
  const hadSubscription = item.tenantId !== null && Boolean(await prisma.tenantSubscription.findUnique({
    where: { tenantId: item.tenantId },
    select: { tenantId: true }
  }));
  const delivery: { outcome?: Promise<Outcome> } = {};

  try {
    await prisma.$transaction(async (tx) => {
      let reason: string | null = null;
      if (!item.tenantId) {
        reason = "TENANT_MISSING";
      } else {
        const tenants = hadSubscription
          ? await tx.$queryRaw<Array<{ isActive: boolean; deletedAt: Date | null }>>`
              SELECT "isActive", "deletedAt" FROM "Tenant" WHERE "id" = ${item.tenantId} FOR SHARE
            `
          : await tx.$queryRaw<Array<{ isActive: boolean; deletedAt: Date | null }>>`
              SELECT "isActive", "deletedAt" FROM "Tenant" WHERE "id" = ${item.tenantId} FOR UPDATE
            `;
        const tenant = tenants[0];
        if (!tenant) reason = "TENANT_MISSING";
        else if (tenant.deletedAt) reason = "TENANT_DELETED";
        else if (!tenant.isActive) reason = "TENANT_INACTIVE";

        if (tenant) {
          const subscriptions = await tx.$queryRaw<Array<{ tenantId: string }>>`
            SELECT "tenantId" FROM "TenantSubscription" WHERE "tenantId" = ${item.tenantId} FOR UPDATE
          `;
          if (hadSubscription && subscriptions.length === 0) {
            throw new Error("Scheduled report subscription changed before dispatch");
          }
        }
      }

      const checkedAt = currentTime();
      const owned = await tx.emailQueue.updateMany({
        where: {
          id: item.id,
          status: "PENDING",
          processingToken,
          leaseExpiresAt: { gt: checkedAt }
        },
        data: { leaseExpiresAt: new Date(checkedAt.getTime() + leaseMs) }
      });
      if (owned.count !== 1) return;

      if (!reason && item.tenantId) {
        const statusChanged = await tx.auditLog.findFirst({
          where: {
            tenantId: item.tenantId,
            resource: "tenant",
            action: "PLATFORM_TENANT_STATUS_CHANGED",
            // Equal timestamps are conservatively blocked: PostgreSQL stores
            // milliseconds, so distinct writes can share the same timestamp.
            createdAt: { gte: item.createdAt }
          },
          select: { id: true }
        });
        if (statusChanged) reason = "TENANT_STATUS_CHANGED";
        else {
          // Read through the same transaction/connection while holding the
          // subscription lock; reuse the canonical license policy and mapping.
          const licensePolicy = new LicensePolicyService({
            getLatestByAction: (tenantId, resource, action) => tx.auditLog.findFirst({
              where: { tenantId, resource, action },
              orderBy: { createdAt: "desc" }
            })
          }, async (tenantId) => {
            const row = await tx.tenantSubscription.findUnique({ where: { tenantId } });
            return row ? snapshotFromRow(row) : null;
          });
          const entitlements = await licensePolicy.getTenantEntitlements(item.tenantId);
          if (entitlements.license.status !== "ACTIVE" && entitlements.license.status !== "TRIAL") {
            reason = `LICENSE_${entitlements.license.status}`;
          } else if (!hasFeature(entitlements.plan, "scheduled_reports")) {
            reason = "FEATURE_UNAVAILABLE";
          }
        }
      }

      if (reason) {
        await tx.emailQueue.updateMany({
          where: { id: item.id, status: "PENDING", processingToken },
          data: {
            status: "FAILED",
            lastError: `SCHEDULED_REPORT_DISPATCH_BLOCKED:${reason}`,
            processingToken: null,
            processingStartedAt: null,
            leaseExpiresAt: null,
            meta: {
              ...((item.meta ?? {}) as Record<string, unknown>),
              dispatchBlockedReason: reason,
              dispatchBlockedAt: currentTime().toISOString()
            } as Prisma.InputJsonValue
          }
        });
        return;
      }

      // This MUST initiate the provider request synchronously, before returning
      // its Promise (protected by the sender contract test). Tenant suspension
      // cannot commit between this authorization and request initiation.
      // Observe rejection immediately, but NEVER await the network inside the
      // transaction: an in-flight message must not delay tenant suspension.
      delivery.outcome = startDelivery().then(
        (receipt) => ({ receipt }),
        (error: unknown) => ({ error })
      );
    }, { maxWait: 5000, timeout: 10000 });
  } catch (error) {
    if (!delivery.outcome) throw error;
    // The request already started. Even a rollback or lost commit acknowledgement
    // must await it, then persist its receipt/finalization rather than resending.
    logger.warn({ queueId: item.id }, "Scheduled report guard commit uncertain after provider initiation");
  }

  if (!delivery.outcome) return null;
  const outcome = await delivery.outcome;
  if ("error" in outcome) throw outcome.error;
  return outcome.receipt;
};
