import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../../shared/config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { JwtPayload } from "../../../shared/types/auth.js";
import { appendLogContext } from "../../../infrastructure/logging/logger.js";

export const requirePlatformAuth = (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (!token) throw new AppError("Token platform mancante", 401, "UNAUTHORIZED");

  try {
    const payload = jwt.verify(token, env.PLATFORM_JWT_SECRET) as JwtPayload;
    if (!payload?.platformAdmin || payload.tokenType !== "platform") {
      throw new AppError("Accesso platform negato", 403, "FORBIDDEN");
    }
    req.auth = payload;
    appendLogContext({ tenantId: payload.tenantId, userId: payload.userId });
    next();
  } catch (error) {
    if (error instanceof AppError) throw error;

    try {
      const tenantPayload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
      if (tenantPayload?.tenantId && tenantPayload.tokenType !== "platform") {
        throw new AppError("Accesso platform negato", 403, "FORBIDDEN");
      }
    } catch (tenantError) {
      if (tenantError instanceof AppError) throw tenantError;
    }

    throw new AppError("Token platform non valido", 401, "UNAUTHORIZED");
  }
};
