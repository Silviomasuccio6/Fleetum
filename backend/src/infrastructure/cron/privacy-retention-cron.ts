import cron, { ScheduledTask } from "node-cron";
import { PrivacyComplianceService } from "../../application/services/privacy-compliance-service.js";
import { prisma } from "../database/prisma/client.js";
import { logger } from "../logging/logger.js";
import { env } from "../../shared/config/env.js";
import { metrics } from "../observability/metrics.js";

export const startPrivacyRetentionCron = (service: PrivacyComplianceService): ScheduledTask => {
  // One process must not overlap its own cleanup. Cross-process scheduling remains
  // an operational requirement; this is not a distributed lock.
  let running = false;
  return cron.schedule(env.PRIVACY_RETENTION_CRON_SCHEDULE, async () => {
    if (!env.PRIVACY_RETENTION_CRON_ENABLED || running) return;
    running = true;

    let tenantsProcessed = 0;
    let tenantsFailed = 0;
    let globalFailed = false;

    try {
      let globalResult: Awaited<ReturnType<PrivacyComplianceService["runGlobalRetention"]>> | null = null;
      if (env.PRIVACY_RETENTION_GLOBAL_ENABLED) {
        try {
          globalResult = await service.runGlobalRetention({ confirmation: "RUN_GLOBAL_RETENTION" });
        } catch {
          globalFailed = true;
        }
      }
      // Bound the run and paginate by immutable IDs. Deleting/deactivating a row
      // cannot shift an offset and skip the next tenant.
      const upperBound = await prisma.tenant.findFirst({
        where: { isActive: true, deletedAt: null },
        select: { id: true },
        orderBy: { id: "desc" }
      });

      const tenantDeleted = {
        passwordResetTokens: 0,
        invitationTokens: 0,
        refreshSessions: 0,
        deletedCustomerAttachments: 0,
        deletedStoredFileObjects: 0
      };
      let after: string | undefined;
      while (upperBound) {
        const tenants = await prisma.tenant.findMany({
          where: { isActive: true, deletedAt: null, id: { gt: after, lte: upperBound.id } },
          select: { id: true },
          orderBy: { id: "asc" },
          take: 500
        });
        if (!tenants.length) break;
        for (const tenant of tenants) {
          try {
            const result = await service.runRetention({
              tenantId: tenant.id,
              userId: null,
              confirmation: "RUN_RETENTION"
            });
            tenantsProcessed++;
            tenantDeleted.passwordResetTokens += result.deleted.passwordResetTokens;
            tenantDeleted.invitationTokens += result.deleted.invitationTokens;
            tenantDeleted.refreshSessions += result.deleted.refreshSessions;
            tenantDeleted.deletedCustomerAttachments += result.deleted.deletedCustomerAttachments;
            tenantDeleted.deletedStoredFileObjects += result.deleted.deletedStoredFileObjects;
          } catch {
            tenantsFailed++;
          }
        }
        after = tenants[tenants.length - 1]!.id;
        if (tenants.length < 500 || after === upperBound.id) break;
      }

      const summary = {
          global: globalResult
            ? { enabled: true, deleted: globalResult.deleted, purged: globalResult.purged }
            : { enabled: env.PRIVACY_RETENTION_GLOBAL_ENABLED },
          globalFailed,
          tenantsProcessed,
          tenantsFailed,
          tenantDeleted
      };
      const failed = globalFailed || tenantsFailed > 0;
      metrics.observeRetentionRun({
        status: failed ? "failure" : "success", tenants: tenantsProcessed,
        deletedStoredFileObjects: tenantDeleted.deletedStoredFileObjects
      });
      if (failed) logger.error(summary, "Privacy retention cron completed with failures");
      else logger.info(summary, "Privacy retention cron completed");
    } catch {
      metrics.observeRetentionRun({ status: "failure", tenants: tenantsProcessed });
      logger.error({ tenantsProcessed, tenantsFailed, globalFailed }, "Privacy retention cron failed");
    } finally {
      running = false;
    }
  });
};
