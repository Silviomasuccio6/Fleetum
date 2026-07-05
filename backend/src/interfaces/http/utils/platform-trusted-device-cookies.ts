import crypto from "node:crypto";
import { Request, Response } from "express";
import { env } from "../../../shared/config/env.js";
import { getCookieValue } from "./auth-cookies.js";

export const PLATFORM_TRUSTED_DEVICE_COOKIE = "fleetum_platform_device";

const isSecure = env.NODE_ENV === "production";
const cookiePath = "/platform-api";

const hmac = (value: string) => crypto.createHmac("sha256", env.PLATFORM_JWT_SECRET).update(value).digest("hex");

export const hashPlatformSecret = hmac;
export const hashPlatformFingerprint = (value?: string | string[] | null) => {
  const normalized = Array.isArray(value) ? value.join(",") : value;
  return hmac(normalized?.trim() || "unknown");
};

export const createPlatformTrustedDeviceToken = () => {
  const deviceId = crypto.randomBytes(18).toString("base64url");
  const secret = crypto.randomBytes(32).toString("base64url");
  return {
    deviceId,
    secret,
    cookieValue: `${deviceId}.${secret}`,
    tokenHash: hashPlatformSecret(secret)
  };
};

export const parsePlatformTrustedDeviceCookie = (req: Request) => {
  const raw = getCookieValue(req, PLATFORM_TRUSTED_DEVICE_COOKIE);
  if (!raw) return null;
  const [deviceId, secret] = raw.split(".");
  if (!deviceId || !secret || !/^[A-Za-z0-9_-]{16,}$/.test(deviceId) || !/^[A-Za-z0-9_-]{32,}$/.test(secret)) return null;
  return { deviceId, tokenHash: hashPlatformSecret(secret) };
};

export const setPlatformTrustedDeviceCookie = (res: Response, cookieValue: string, expiresAt: Date) => {
  res.cookie(PLATFORM_TRUSTED_DEVICE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "strict",
    path: cookiePath,
    expires: expiresAt
  });
};

export const clearPlatformTrustedDeviceCookie = (res: Response) => {
  res.clearCookie(PLATFORM_TRUSTED_DEVICE_COOKIE, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "strict",
    path: cookiePath
  });
};
