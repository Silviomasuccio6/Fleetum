import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import { prisma } from "./infrastructure/database/prisma/client.js";
import { apiRouter } from "./interfaces/http/routes/index.js";
import { platformAlertService, platformRouter } from "./interfaces/http/routes/platform-index.js";
import { env } from "./config/env.js";
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

const localTenantOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
const localPlatformOrigins = ["http://localhost:5174", "http://127.0.0.1:5174"];

const expandOriginVariants = (origin: string) => {
  try {
    const url = new URL(origin);
    const variants = [url.origin];

    if (!url.hostname.startsWith("www.")) {
      variants.push(`${url.protocol}//www.${url.host}`);
    } else {
      variants.push(`${url.protocol}//${url.host.replace(/^www\./, "")}`);
    }

    return variants;
  } catch {
    return [origin];
  }
};

const getAllowedOrigins = (corsOrigin: string, localOrigins: string[]) => {
  const devOrigins = env.NODE_ENV === "production" ? [] : localOrigins;
  const configuredOrigins = corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .flatMap(expandOriginVariants);

  return Array.from(
    new Set(
      [
        ...configuredOrigins,
        ...devOrigins
      ].filter(Boolean)
    )
  );
};

const healthPaths = new Set(["/api/health", "/api/ready", "/platform-api/health", "/platform-api/ready"]);

const applyCommon = (app: express.Express, corsOrigin: string, localDevOrigins: string[]) => {
  const allowedOrigins = getAllowedOrigins(corsOrigin, localDevOrigins);
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

  app.use(express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      if ((req as express.Request).originalUrl === "/api/billing/webhook") {
        (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      }
    }
  }));
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
  applyCommon(app, env.CORS_ORIGIN, localTenantOrigins);
  app.use("/api", apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

export const createPlatformApp = () => {
  const app = express();
  applyCommon(app, env.PLATFORM_CORS_ORIGIN, localPlatformOrigins);
  app.use(createPlatformIpAllowlist(platformAlertService));
  app.get("/platform-api/health", (_req, res) =>
    res.json({ ok: true, service: "fleetum-platform-api", timestamp: new Date().toISOString() })
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
