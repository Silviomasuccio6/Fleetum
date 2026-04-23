import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import { prisma } from "./infrastructure/database/prisma/client.js";
import { apiRouter } from "./interfaces/http/routes/index.js";
import { platformAlertService, platformRouter } from "./interfaces/http/routes/platform-index.js";
import { env } from "./shared/config/env.js";
import { errorHandler } from "./interfaces/http/middlewares/error-handler.js";
import { notFoundHandler } from "./interfaces/http/middlewares/not-found.js";
import { createPlatformIpAllowlist } from "./interfaces/http/middlewares/platform-ip-allowlist.js";
import { requestContext } from "./interfaces/http/middlewares/request-context.js";

const sensitiveQueryParams = new Set([
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "otp",
  "password",
  "secret",
  "code"
]);

const sanitizeRequestUrl = (rawUrl?: string) => {
  if (!rawUrl) return "/";
  try {
    const parsed = new URL(rawUrl, "http://localhost");
    for (const key of new Set(parsed.searchParams.keys())) {
      const lowerKey = key.toLowerCase();
      const shouldMask = sensitiveQueryParams.has(lowerKey) || lowerKey.includes("token") || lowerKey.includes("secret");
      if (shouldMask) parsed.searchParams.set(key, "***");
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    const [pathname] = rawUrl.split("?");
    return pathname || "/";
  }
};

morgan.token("safe-url", (req) => {
  const requestWithOriginalUrl = req as unknown as { originalUrl?: string; url?: string };
  const originalUrl = requestWithOriginalUrl.originalUrl ?? requestWithOriginalUrl.url;
  return sanitizeRequestUrl(originalUrl);
});

const getAllowedOrigins = (corsOrigin: string) => {
  const localDevOrigins =
    env.NODE_ENV === "production"
      ? []
      : ["http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:5173", "http://127.0.0.1:5174"];

  return Array.from(
    new Set(
      [
        corsOrigin,
        env.CORS_ORIGIN,
        env.PLATFORM_CORS_ORIGIN,
        ...localDevOrigins
      ].filter(Boolean)
    )
  );
};

const healthPaths = new Set(["/api/health", "/api/ready", "/platform-api/health", "/platform-api/ready"]);

const applyCommon = (app: express.Express, corsOrigin: string) => {
  const allowedOrigins = getAllowedOrigins(corsOrigin);
  const styleSrc = env.NODE_ENV === "production" ? ["'self'"] : ["'self'", "'unsafe-inline'"];

  app.set("etag", false);
  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc,
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'", ...allowedOrigins],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"]
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );

  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  });

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true
    })
  );

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => healthPaths.has(req.path)
    })
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(requestContext);
  app.use(
    morgan(
      ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
    )
  );
};

export const createApp = () => {
  const app = express();
  applyCommon(app, env.CORS_ORIGIN);
  app.use("/api", apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

export const createPlatformApp = () => {
  const app = express();
  applyCommon(app, env.PLATFORM_CORS_ORIGIN);
  app.use(createPlatformIpAllowlist(platformAlertService));
  app.get("/platform-api/health", (_req, res) =>
    res.json({ ok: true, service: "fermi-platform-api", timestamp: new Date().toISOString() })
  );
  app.get("/platform-api/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: "up" });
    } catch {
      res.status(503).json({ ok: false, db: "down", message: env.NODE_ENV === "production" ? "Database non disponibile" : "Database query failed" });
    }
  });
  app.use("/platform-api", platformRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
