import { PrismaClient } from "@prisma/client";
import { logger } from "../../logging/logger.js";
import { metrics } from "../../observability/metrics.js";
import { env } from "../../../shared/config/env.js";

const isProduction = env.NODE_ENV === "production";
const slowQueryMs = env.PRISMA_SLOW_QUERY_MS ?? (isProduction ? 500 : 100);
const criticalQueryMs = 2000;

const basePrisma = new PrismaClient({
  log: isProduction
    ? [{ emit: "event", level: "error" }]
    : [
        { emit: "event", level: "query" },
        { emit: "event", level: "error" }
      ]
});

basePrisma.$on("error", (event) => {
  metrics.recordPrismaError("client");
  logger.error(
    {
      target: event.target,
      message: event.message
    },
    "Prisma client error"
  );
});

if (!isProduction) {
  basePrisma.$on("query", (event) => {
    if (event.duration <= slowQueryMs) return;
    logger.warn(
      {
        durationMs: event.duration,
        query: event.query
      },
      "Slow Prisma SQL query"
    );
  });
}

const shouldSkipOperationLog = (model: string | undefined, action: string) =>
  !model && ["queryRaw", "executeRaw", "queryRawUnsafe", "executeRawUnsafe"].includes(action);

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        void args;
        const startedAt = process.hrtime.bigint();
        try {
          const result = await query(args);
          const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
          const slow = durationMs >= slowQueryMs;
          metrics.observePrismaOperation({ model, action: operation, durationMs, slow });

          if (!shouldSkipOperationLog(model, operation) && slow) {
            const payload = {
              model: model ?? "raw",
              action: operation,
              durationMs: Number(durationMs.toFixed(2)),
              thresholdMs: slowQueryMs
            };
            if (durationMs >= criticalQueryMs) {
              logger.error(payload, "Critical slow Prisma operation");
            } else {
              logger.warn(payload, "Slow Prisma operation");
            }
          }

          return result;
        } catch (error) {
          const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
          metrics.recordPrismaError(operation);
          logger.error(
            {
              error,
              model: model ?? "raw",
              action: operation,
              durationMs: Number(durationMs.toFixed(2))
            },
            "Prisma operation failed"
          );
          throw error;
        }
      }
    }
  }
}) as typeof basePrisma;
