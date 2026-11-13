import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../../shared/config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { JwtPayload } from "../../../shared/types/auth.js";
import { ACCESS_COOKIE_NAME, getCookieValue } from "../utils/auth-cookies.js";
import { appendLogContext } from "../../../infrastructure/logging/logger.js";
import { prisma } from "../../../infrastructure/database/prisma/client.js";

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const cookieToken = getCookieValue(req, ACCESS_COOKIE_NAME);
    const token = bearerToken || cookieToken;
    if (!token) throw new AppError("Token mancante", 401, "UNAUTHORIZED");

    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (
      payload.tokenType !== "access" ||
      !payload.sessionId ||
      typeof payload.userId !== "string" ||
      typeof payload.tenantId !== "string"
    ) {
      throw new AppError("Token non valido", 401, "UNAUTHORIZED");
    }

    // Tenant access has an immediate, request-bound revocation SLA: logout and
    // reset revoke the backing session; suspension/deletion reject the user;
    // role changes take effect from this database snapshot. No cache is used.
    const session = await prisma.refreshSession.findFirst({
      where: {
        id: payload.sessionId,
        userId: payload.userId,
        tenantId: payload.tenantId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: {
          is: {
            id: payload.userId,
            tenantId: payload.tenantId,
            deletedAt: null,
            status: "ACTIVE"
          }
        }
      },
      select: {
        id: true,
        user: {
          select: {
            id: true,
            tenantId: true,
            roles: {
              select: {
                role: {
                  select: {
                    key: true,
                    permissions: { select: { permission: { select: { key: true } } } }
                  }
                }
              }
            }
          }
        }
      }
    });
    if (!session) {
      throw new AppError("Sessione non valida o revocata", 401, "UNAUTHORIZED");
    }

    const roles = session.user.roles.map(({ role }) => role.key);
    const permissions = Array.from(
      new Set(session.user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)))
    );
    req.auth = {
      ...payload,
      userId: session.user.id,
      tenantId: session.user.tenantId,
      roles,
      permissions,
      tokenType: "access",
      sessionId: session.id
    };
    appendLogContext({ tenantId: session.user.tenantId, userId: session.user.id });
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError("Token non valido", 401, "UNAUTHORIZED"));
    }
    return next(error);
  }
};
