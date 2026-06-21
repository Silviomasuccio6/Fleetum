import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { appendLogContext } from "../../../infrastructure/logging/logger.js";
import { env } from "../../../shared/config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { JwtPayload } from "../../../shared/types/auth.js";

export const requirePlatformAuth = async (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (!token) throw new AppError("Token platform mancante", 401, "UNAUTHORIZED");

  try {
    const payload = jwt.verify(token, env.PLATFORM_JWT_SECRET) as JwtPayload & { iat?: number };
    if (!payload?.platformAdmin || payload.tokenType !== "platform") {
      throw new AppError("Accesso platform negato", 403, "FORBIDDEN");
    }

    // Reject every Platform token issued before a completed password reset.
    const credential = await prisma.platformAdminCredential.findUnique({
      where: { email: env.PLATFORM_ADMIN_EMAIL.trim().toLowerCase() },
      select: { passwordChangedAt: true }
    });
    if (credential && (!payload.iat || payload.iat * 1000 < credential.passwordChangedAt.getTime())) {
      throw new AppError("Sessione Platform revocata. Accedi di nuovo.", 401, "PLATFORM_SESSION_REVOKED");
    }

    req.auth = payload;
    appendLogContext({ tenantId: payload.tenantId, userId: payload.userId });
    next();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Token platform non valido", 401, "UNAUTHORIZED");
  }
};
