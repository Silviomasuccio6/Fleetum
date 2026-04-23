import { randomUUID } from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { logger, runWithLogContext } from "../../../infrastructure/logging/logger.js";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

const normalizeRequestId = (raw: unknown): string | null => {
  const candidate = String(raw ?? "").trim();
  if (!candidate) return null;
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : null;
};

const resolveRequestId = (req: Request) => {
  const headerValue = req.headers[REQUEST_ID_HEADER];
  if (Array.isArray(headerValue)) {
    for (const value of headerValue) {
      const normalized = normalizeRequestId(value);
      if (normalized) return normalized;
    }
  } else {
    const normalized = normalizeRequestId(headerValue);
    if (normalized) return normalized;
  }
  return randomUUID();
};

export const requestContext = (req: Request, res: Response, next: NextFunction) => {
  const requestId = resolveRequestId(req);
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  const startedAt = Date.now();
  runWithLogContext({ requestId }, () => {
    res.on("finish", () => {
      logger.info(
        {
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
          ip: req.ip
        },
        "HTTP request completed"
      );
    });
    next();
  });
};
