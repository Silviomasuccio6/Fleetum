import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { JwtPayload } from "../../shared/types/auth.js";

const REVOCATION_ACTION = "PLATFORM_SESSION_REVOKED";
const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export const verifyPlatformSessionToken = (token: string) => {
  let payload: JwtPayload & jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.PLATFORM_JWT_SECRET, { algorithms: ["HS256"] }) as JwtPayload & jwt.JwtPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw new AppError("Sessione Platform scaduta. Accedi di nuovo.", 401, "PLATFORM_SESSION_EXPIRED");
    throw new AppError("Token platform non valido", 401, "UNAUTHORIZED");
  }
  if (
    payload.platformAdmin !== true || payload.tokenType !== "platform" ||
    payload.userId !== "platform-admin" || payload.tenantId !== "platform" ||
    !Number.isSafeInteger(payload.exp) || !payload.exp
  ) throw new AppError("Accesso platform negato", 403, "FORBIDDEN");
  return payload;
};

// Security events are durable revocation records. Retain this action at least
// until its recorded JWT expiry; deleting a live record would restore access.
export class PlatformSessionService {
  constructor(private readonly database: typeof prisma = prisma) {}

  async isRevoked(token: string) {
    const event = await this.database.platformSecurityEvent.findFirst({
      where: { action: REVOCATION_ACTION, details: { path: ["tokenHash"], equals: tokenHash(token) } },
      select: { id: true }
    });
    return Boolean(event);
  }

  async logout(token: string) {
    const payload = verifyPlatformSessionToken(token);
    const hash = tokenHash(token);
    const expiresAt = new Date(payload.exp! * 1000).toISOString();
    await this.database.$transaction(async (tx) => {
      // One durable event per bearer under concurrent retries. This lock never
      // contains the bearer, and contention fails within two seconds.
      await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
      await tx.$queryRaw<Array<{ locked: string }>>`
        SELECT pg_advisory_xact_lock(hashtextextended(${`fleetum:platform-logout:${hash}`}, 0))::text AS locked
      `;
      const existing = await tx.platformSecurityEvent.findFirst({
        where: { action: REVOCATION_ACTION, details: { path: ["tokenHash"], equals: hash } },
        select: { id: true }
      });
      if (!existing) await tx.platformSecurityEvent.create({ data: {
        action: REVOCATION_ACTION,
        actor: env.PLATFORM_ADMIN_EMAIL.trim().toLowerCase(),
        details: { tokenHash: hash, expiresAt }
      } });
    }, { maxWait: 2000, timeout: 5000 });
    return { revoked: true as const };
  }
}

export const platformSessionService = new PlatformSessionService();
