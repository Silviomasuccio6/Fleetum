import { AsyncLocalStorage } from "node:async_hooks";
import pino from "pino";

type LogContext = {
  requestId?: string;
  tenantId?: string;
  userId?: string;
};

const logContextStorage = new AsyncLocalStorage<LogContext>();

export const runWithLogContext = <T>(context: LogContext, callback: () => T): T =>
  logContextStorage.run({ ...context }, callback);

export const appendLogContext = (context: Partial<LogContext>) => {
  const current = logContextStorage.getStore();
  if (!current) return;
  Object.assign(current, context);
};

export const getLogContext = () => logContextStorage.getStore() ?? null;

export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  mixin() {
    const context = logContextStorage.getStore();
    if (!context) return {};
    const payload: Record<string, string> = {};
    if (context.requestId) payload.requestId = context.requestId;
    if (context.tenantId) payload.tenantId = context.tenantId;
    if (context.userId) payload.userId = context.userId;
    return payload;
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "password",
      "passwordHash",
      "token",
      "refreshToken",
      "currentPassword",
      "newPassword",
      "smtpPass",
      "headers.authorization",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.refreshToken",
      "*.currentPassword",
      "*.newPassword"
    ],
    remove: true
  }
});
