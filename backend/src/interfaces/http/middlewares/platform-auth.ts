import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { appendLogContext } from "../../../infrastructure/logging/logger.js";
import { env } from "../../../shared/config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { platformSessionService, verifyPlatformSessionToken } from "../../../application/services/platform-session-service.js";

const platformAuthentication = (logoutOnly: boolean) => async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    if (!token) throw new AppError("Token platform mancante", 401, "UNAUTHORIZED");

    const payload = verifyPlatformSessionToken(token);

    try {
      // Existing password-reset revocation remains independent of logout.
      const credential = await prisma.platformAdminCredential.findUnique({
        where: { email: env.PLATFORM_ADMIN_EMAIL.trim().toLowerCase() },
        select: { passwordChangedAt: true }
      });
      if (credential && (!payload.iat || payload.iat * 1000 < credential.passwordChangedAt.getTime())) {
        throw new AppError("Sessione Platform revocata. Accedi di nuovo.", 401, "PLATFORM_SESSION_REVOKED");
      }
      // Only the logout route can acknowledge an already-revoked bearer.
      // Subsequent authorization checks read the durable store without a cache;
      // requests admitted before the logout commit may still finish.
      if (!logoutOnly && await platformSessionService.isRevoked(token)) {
        throw new AppError("Sessione Platform revocata. Accedi di nuovo.", 401, "PLATFORM_SESSION_REVOKED");
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Verifica sessione Platform temporaneamente non disponibile", 503, "PLATFORM_SESSION_CHECK_UNAVAILABLE");
    }

    req.auth = payload;
    appendLogContext({ tenantId: payload.tenantId, userId: payload.userId });
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    if (error instanceof jwt.TokenExpiredError) return next(new AppError("Sessione Platform scaduta. Accedi di nuovo.", 401, "PLATFORM_SESSION_EXPIRED"));
    return next(new AppError("Token platform non valido", 401, "UNAUTHORIZED"));
  }
};

export const requirePlatformAuth = platformAuthentication(false);
// Keep this exception private to POST /auth/logout; never use for business routes.
export const requirePlatformLogoutAuth = platformAuthentication(true);
