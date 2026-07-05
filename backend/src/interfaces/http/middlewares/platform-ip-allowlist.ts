import { NextFunction, Request, Response } from "express";
import { PlatformAlertService } from "../../../application/services/platform-alert-service.js";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { env } from "../../../shared/config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { getClientIp, toIpAllowlist } from "../../../shared/utils/ip.js";
import {
  hashPlatformFingerprint,
  parsePlatformTrustedDeviceCookie
} from "../utils/platform-trusted-device-cookies.js";

const allowed = toIpAllowlist(env.PLATFORM_ALLOWED_IPS_CSV);

const publicPlatformPaths = new Set([
  "/platform-api/health",
  "/platform-api/ready",
  "/platform-api/auth/login",
  "/platform-api/auth/password-reset/request",
  "/platform-api/auth/password-reset/verify",
  "/platform-api/auth/password-reset/confirm"
]);

const normalizePath = (req: Request) => (req.originalUrl || req.path || "").split("?")[0] ?? "";

export type PlatformTrustedDeviceVerifier = (req: Request, sourceIp: string) => Promise<boolean>;

export const verifyPlatformTrustedDevice: PlatformTrustedDeviceVerifier = async (req, sourceIp) => {
  if (!env.PLATFORM_TRUSTED_DEVICE_ENABLED) return false;

  const trustedCookie = parsePlatformTrustedDeviceCookie(req);
  if (!trustedCookie) return false;

  const now = new Date();
  const userAgentHash = hashPlatformFingerprint(req.headers["user-agent"]);
  const device = await prisma.platformTrustedDevice.findFirst({
    where: {
      deviceId: trustedCookie.deviceId,
      tokenHash: trustedCookie.tokenHash,
      userAgentHash,
      revokedAt: null,
      expiresAt: { gt: now }
    },
    select: { id: true }
  });

  if (!device) return false;

  await prisma.platformTrustedDevice.update({
    where: { id: device.id },
    data: {
      lastUsedAt: now,
      lastIpHash: hashPlatformFingerprint(sourceIp)
    }
  });

  return true;
};

export const createPlatformIpAllowlist = (
  alerts: PlatformAlertService,
  trustedDeviceVerifier: PlatformTrustedDeviceVerifier = verifyPlatformTrustedDevice
) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (env.PLATFORM_IP_ALLOWLIST_MODE === "disabled") {
      return next();
    }

    const ip = getClientIp(req);
    if (allowed.has(ip)) {
      return next();
    }

    if (env.PLATFORM_IP_ALLOWLIST_MODE === "optional") {
      const path = normalizePath(req);
      if (publicPlatformPaths.has(path)) {
        return next();
      }

      if (await trustedDeviceVerifier(req, ip)) {
        return next();
      }
    }

    await alerts.notify({
      type: "PLATFORM_UNAUTHORIZED_IP",
      actor: "anonymous",
      sourceIp: ip,
      details: `Blocked request to ${req.method} ${req.originalUrl}`
    });

    const code = env.PLATFORM_IP_ALLOWLIST_MODE === "optional" ? "PLATFORM_DEVICE_REQUIRED" : "PLATFORM_IP_FORBIDDEN";
    const message = env.PLATFORM_IP_ALLOWLIST_MODE === "optional"
      ? "Accesso platform consentito solo da IP autorizzato o dispositivo fidato. Accedi con OTP per autorizzare questo dispositivo."
      : "Accesso platform non autorizzato per questo IP";

    next(new AppError(message, 403, code));
  };
};
