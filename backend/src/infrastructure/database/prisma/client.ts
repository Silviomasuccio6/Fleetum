import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../../../shared/config/env.js";
import { logger } from "../../logging/logger.js";

const isProduction = env.NODE_ENV === "production";
const slowQueryWarningMs = env.PRISMA_SLOW_QUERY_MS;
const slowQueryErrorMs = 2000;

type QueryEvent = {
  timestamp: Date;
  query: string;
  params: string;
  duration: number;
  target: string;
};

type ErrorEvent = {
  timestamp: Date;
  message: string;
  target: string;
};

type PrismaClientWithEvents = PrismaClient & {
  $on(event: "query", callback: (event: QueryEvent) => void): void;
  $on(event: "error", callback: (event: ErrorEvent) => void): void;
};

const prismaLogConfig: Prisma.PrismaClientOptions["log"] = isProduction
  ? [{ emit: "event", level: "error" }]
  : [
      { emit: "event", level: "query" },
      { emit: "event", level: "error" }
    ];

const isHealthCheckQuery = (query?: string) => {
  const normalized = (query ?? "")
    .replace(/\/\*.*?\*\//gs, "")
    .replace(/;$/, "")
    .trim()
    .toLowerCase();
  return normalized === "select 1" || normalized === "select 1 as result";
};

const shouldSkipOperationLog = (model: string | undefined, action: string) => {
  // Raw operations may contain inline SQL supplied by callers. We skip them here to avoid logging PII.
  if (!model && ["queryRaw", "queryRawUnsafe", "executeRaw", "executeRawUnsafe"].includes(action)) return true;
  return false;
};

const logSlowOperation = (input: {
  duration: number;
  model?: string;
  action: string;
}) => {
  if (input.duration < slowQueryWarningMs) return;

  const payload = {
    duration: input.duration,
    thresholdMs: slowQueryWarningMs,
    model: input.model ?? "raw",
    action: input.action,
    operation: input.model ? `${input.model}.${input.action}` : input.action
  };

  if (isProduction && input.duration >= slowQueryErrorMs) {
    logger.error(payload, "Very slow Prisma operation");
    return;
  }

  logger.warn(payload, "Slow Prisma operation");
};

const basePrisma = new PrismaClient({ log: prismaLogConfig }) as PrismaClientWithEvents;

if (!isProduction) {
  basePrisma.$on("query", (event) => {
    if (event.duration < slowQueryWarningMs || isHealthCheckQuery(event.query)) return;
    logger.warn(
      {
        duration: event.duration,
        query: event.query,
        target: event.target
      },
      "Slow query"
    );
  });
}

basePrisma.$on("error", (event) => {
  logger.error(
    {
      target: event.target,
      message: event.message
    },
    "Prisma error"
  );
});

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, query, args }) {
        const startedAt = performance.now();
        try {
          return await query(args);
        } finally {
          const duration = Math.round(performance.now() - startedAt);
          if (!shouldSkipOperationLog(model, operation)) {
            logSlowOperation({ duration, model, action: operation });
          }
        }
      }
    },
    $queryRaw: async ({ query, args }) => query(args),
    $queryRawUnsafe: async ({ query, args }) => query(args),
    $executeRaw: async ({ query, args }) => query(args),
    $executeRawUnsafe: async ({ query, args }) => query(args)
  }
});
