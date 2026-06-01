import type { Request, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../../shared/config/env.js";

const secondsUntilReset = (req: Request, fallbackSeconds: number) => {
  const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
  if (!resetTime) return fallbackSeconds;
  const seconds = Math.ceil((resetTime.getTime() - Date.now()) / 1000);
  return Math.max(1, seconds);
};

type FleetumRateLimiterOptions = {
  name: string;
  windowMs: number;
  max: number;
  skip?: (req: Request) => boolean;
};

export const createFleetumRateLimiter = ({ name, windowMs, max, skip }: FleetumRateLimiterOptions): RequestHandler => {
  const fallbackRetryAfter = Math.ceil(windowMs / 1000);
  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
    handler: (req, res) => {
      const retryAfter = secondsUntilReset(req, fallbackRetryAfter);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Too many requests", retryAfter });
    }
  });

  return (req, res, next) => {
    const isDevelopment = process.env.NODE_ENV === "development" || (!process.env.NODE_ENV && env.NODE_ENV === "development");
    if (isDevelopment) {
      next();
      return;
    }

    res.setHeader("X-RateLimit-Policy", name);
    limiter(req, res, next);
  };
};

const isHealthPath = (req: Request) =>
  ["/api/health", "/api/ready", "/platform-api/health", "/platform-api/ready"].includes(req.originalUrl || req.path);

const isStripeWebhookPath = (req: Request) => {
  const path = req.originalUrl || req.path;
  return path === "/api/billing/webhook" || path === "/stripe/webhooks";
};

export const genericRateLimiter = createFleetumRateLimiter({
  name: "generic-ip-100-per-15m",
  windowMs: 15 * 60 * 1000,
  max: 100,
  skip: (req) => isHealthPath(req) || isStripeWebhookPath(req)
});

export const authRateLimiter = createFleetumRateLimiter({
  name: "auth-ip-10-per-15m",
  windowMs: 15 * 60 * 1000,
  max: 10
});

export const registrationRateLimiter = createFleetumRateLimiter({
  name: "registration-ip-3-per-1h",
  windowMs: 60 * 60 * 1000,
  max: 3
});

export const forgotPasswordRateLimiter = createFleetumRateLimiter({
  name: "forgot-password-ip-5-per-1h",
  windowMs: 60 * 60 * 1000,
  max: 5
});
