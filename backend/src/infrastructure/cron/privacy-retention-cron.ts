import cron, { ScheduledTask } from "node-cron";
import { PrivacyComplianceService } from "../../application/services/privacy-compliance-service.js";
import { prisma } from "../database/prisma/client.js";
import { logger } from "../logging/logger.js";
import { env } from "../../shared/config/env.js";
import { metrics } from "../observability/metrics.js";

export const startPrivacyRetentionCron = (service: PrivacyComplianceService): ScheduledTask => {
  return cron.schedule(env.PRIVACY_RETENTION_CRON_SCHEDULE, async () => {
    if (!env.PRIVACY_RETENTION_CRON_ENABLED) return;

    try {
      const globalResult = env.PRIVACY_RETENTION_GLOBAL_ENABLED
        ? await service.runGlobalRetention({ confirmation: "RUN_GLOBAL_RETENTION" })
        : null;
      const tenants = await prisma.tenant.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true },
        take: 500
      });

      const tenantDeleted = {
        passwordResetTokens: 0,
        invitationTokens: 0,
        refreshSessions: 0,
        deletedCustomerAttachments: 0,
        deletedStoredFileObjects: 0
      };
      for (const tenant of tenants) {
        const result = await service.runRetention({
          tenantId: tenant.id,
          userId: null,
          confirmation: "RUN_RETENTION"
        });
        tenantDeleted.passwordResetTokens += result.deleted.passwordResetTokens;
        tenantDeleted.invitationTokens += result.deleted.invitationTokens;
        tenantDeleted.refreshSessions += result.deleted.refreshSessions;
        tenantDeleted.deletedCustomerAttachments += result.deleted.deletedCustomerAttachments;
        tenantDeleted.deletedStoredFileObjects += result.deleted.deletedStoredFileObjects;
      }

      logger.info(
        {
          global: globalResult
            ? { enabled: true, deleted: globalResult.deleted, purged: globalResult.purged }
            : { enabled: false },
          tenantsProcessed: tenants.length,
          tenantDeleted
        },
        "Privacy retention cron completed"
      );
    } catch (error) {
      metrics.observeRetentionRun({ status: "failure", tenants: 0 });
      logger.error({ error }, "Privacy retention cron failed");
    }
  });
};
