import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../../shared/config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { JwtPayload } from "../../../shared/types/auth.js";
import { ACCESS_COOKIE_NAME, getCookieValue } from "../utils/auth-cookies.js";
import { appendLogContext } from "../../../infrastructure/logging/logger.js";

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  const cookieToken = getCookieValue(req, ACCESS_COOKIE_NAME);
  const token = bearerToken || cookieToken;

  if (!token) throw new AppError("Token mancante", 401, "UNAUTHORIZED");

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (payload.tokenType && payload.tokenType !== "access") {
      throw new AppError("Token non valido", 401, "UNAUTHORIZED");
    }
    req.auth = payload;
    appendLogContext({ tenantId: payload.tenantId, userId: payload.userId });
    next();
  } catch {
    throw new AppError("Token non valido", 401, "UNAUTHORIZED");
  }
};
