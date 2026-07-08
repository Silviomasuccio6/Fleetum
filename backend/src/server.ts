import { Server } from "node:http";
import { createApp, createPlatformApp } from "./app.js";
import { startEmailQueueCron } from "./infrastructure/cron/email-queue-cron.js";
import { startBillingDunningCron } from "./infrastructure/cron/billing-dunning-cron.js";
import { startPrivacyRetentionCron } from "./infrastructure/cron/privacy-retention-cron.js";
import { startReminderCron } from "./infrastructure/cron/reminder-cron.js";
import { startReportsCron } from "./infrastructure/cron/reports-cron.js";
import { BillingDunningService } from "./application/services/billing-dunning-service.js";
import { PrivacyComplianceService } from "./application/services/privacy-compliance-service.js";
import { prisma } from "./infrastructure/database/prisma/client.js";
import { logger } from "./infrastructure/logging/logger.js";
import { PrismaAuditLogRepository } from "./infrastructure/repositories/prisma-audit-log-repository.js";
import { emailQueueCronService, reminderCronUseCase } from "./interfaces/http/routes/index.js";
import { env } from "./shared/config/env.js";

const app = createApp();
const platformApp = createPlatformApp();

const apiServer = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, `API running on http://localhost:${env.PORT}`);
});

const platformServer = platformApp.listen(env.PLATFORM_PORT, env.PLATFORM_BIND_HOST, () => {
  logger.info(
    { host: env.PLATFORM_BIND_HOST, port: env.PLATFORM_PORT },
    `Platform API running on http://${env.PLATFORM_BIND_HOST}:${env.PLATFORM_PORT}/platform-api`
  );
});

const reminderTask = startReminderCron(reminderCronUseCase);
const emailQueueTask = startEmailQueueCron(emailQueueCronService);
const reportsTask = startReportsCron(emailQueueCronService);
const privacyRetentionTask = startPrivacyRetentionCron(new PrivacyComplianceService());
const billingDunningTask = startBillingDunningCron(new BillingDunningService(new PrismaAuditLogRepository()));

let shuttingDown = false;

const closeServer = (server: Server) =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.warn({ signal }, "Shutdown requested, stopping services");

  reminderTask.stop();
  emailQueueTask.stop();
  reportsTask.stop();
  privacyRetentionTask.stop();
  billingDunningTask.stop();

  const closeAll = Promise.allSettled([closeServer(apiServer), closeServer(platformServer)]).then(() => "closed" as const);
  const closeTimeout = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), env.SHUTDOWN_GRACE_MS)
  );
  const closeResult = await Promise.race([closeAll, closeTimeout]);

  if (closeResult === "timeout") {
    logger.error(
      { graceMs: env.SHUTDOWN_GRACE_MS },
      "Server shutdown timeout reached; forcing process exit"
    );
  }

  await prisma.$disconnect().catch((error) => {
    logger.error({ error }, "Error while disconnecting Prisma during shutdown");
  });

  logger.info("Shutdown completed");
};

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
});

process.on("uncaughtException", (error) => {
  logger.error({ error }, "Uncaught exception");
  void shutdown("uncaughtException").finally(() => process.exit(1));
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection");
  void shutdown("unhandledRejection").finally(() => process.exit(1));
});
