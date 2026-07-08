import cron, { ScheduledTask } from "node-cron";
import { BillingDunningService } from "../../application/services/billing-dunning-service.js";
import { env } from "../../shared/config/env.js";
import { logger } from "../logging/logger.js";

export const startBillingDunningCron = (service: BillingDunningService): ScheduledTask => {
  return cron.schedule(env.BILLING_DUNNING_CRON_SCHEDULE, async () => {
    if (!env.BILLING_DUNNING_CRON_ENABLED) return;

    try {
      const result = await service.suspendOverduePastDueSubscriptions();
      logger.info({ result }, "Billing dunning cron completed");
    } catch (error) {
      logger.error({ error }, "Billing dunning cron failed");
    }
  });
};
