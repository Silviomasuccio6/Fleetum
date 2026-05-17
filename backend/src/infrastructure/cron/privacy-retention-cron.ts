import cron, { ScheduledTask } from "node-cron";
import { PrivacyComplianceService } from "../../application/services/privacy-compliance-service.js";
import { prisma } from "../database/prisma/client.js";
import { logger } from "../logging/logger.js";
import { env } from "../../shared/config/env.js";

export const startPrivacyRetentionCron = (service: PrivacyComplianceService): ScheduledTask => {
  return cron.schedule(env.PRIVACY_RETENTION_CRON_SCHEDULE, async () => {
    if (!env.PRIVACY_RETENTION_CRON_ENABLED) return;

    try {
      const tenants = await prisma.tenant.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true },
        take: 500
      });

      const results = [];
      for (const tenant of tenants) {
        const result = await service.runRetention({
          tenantId: tenant.id,
          userId: null,
          confirmation: "RUN_RETENTION"
        });
        results.push({ tenantId: tenant.id, deleted: result.deleted });
      }

      logger.info({ tenants: results.length, results }, "Privacy retention cron completed");
    } catch (error) {
      logger.error({ error }, "Privacy retention cron failed");
    }
  });
};
