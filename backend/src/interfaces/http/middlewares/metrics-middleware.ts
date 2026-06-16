import { NextFunction, Request, Response } from "express";
import { metrics } from "../../../infrastructure/observability/metrics.js";
import { env } from "../../../shared/config/env.js";

export const observeHttpMetrics = (req: Request, res: Response, next: NextFunction) => {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    metrics.observeHttpRequest({
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs
    });
  });
  next();
};

export const metricsHandler = (req: Request, res: Response) => {
  if (!env.METRICS_ENABLED) {
    res.status(404).json({ message: "Metrics disabled", error: "METRICS_DISABLED" });
    return;
  }

  const configuredToken = env.METRICS_TOKEN;
  const headerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice("Bearer ".length)
    : undefined;

  if (env.NODE_ENV === "production" && !configuredToken) {
    res.status(403).json({ message: "Metrics token required in production", error: "METRICS_TOKEN_REQUIRED" });
    return;
  }

  if (configuredToken && headerToken !== configuredToken) {
    res.status(401).json({ message: "Metrics non autorizzate", error: "METRICS_UNAUTHORIZED" });
    return;
  }

  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(metrics.renderPrometheus());
};
