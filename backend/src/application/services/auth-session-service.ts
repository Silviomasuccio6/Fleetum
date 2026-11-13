import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { lockUserForAuthMutation } from "../../infrastructure/database/prisma/auth-user-lock.js";
import { PrismaUserRepository } from "../../infrastructure/repositories/prisma-user-repository.js";
import { AppError } from "../../shared/errors/app-error.js";
import { TokenService } from "./token-service.js";

const REFRESH_TTL_DAYS = 30;

const hashToken = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

const toSessionUser = (user: {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  status: "ACTIVE" | "INVITED" | "SUSPENDED";
  roles: Array<{ role: { key: string; permissions: Array<{ permission: { key: string } }> } }>;
}) => ({
  id: user.id,
  tenantId: user.tenantId,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  status: user.status,
  roles: user.roles.map(({ role }) => role.key),
  permissions: Array.from(
    new Set(user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)))
  )
});

export class AuthSessionService {
  constructor(private readonly tokenService: TokenService, private readonly userRepository: PrismaUserRepository) {}

  private generateRefreshToken() {
    return crypto.randomBytes(48).toString("hex");
  }

  async createSession(input: {
    userId: string;
    tenantId: string;
    roles: string[];
    permissions: string[];
    userAgent?: string;
    ipAddress?: string;
    expectedPasswordHash?: string;
  }) {
    const rawRefresh = this.generateRefreshToken();
    const refreshHash = hashToken(rawRefresh);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86400000);

    const session = await prisma.$transaction(async (tx) => {
      const userExists = await lockUserForAuthMutation(tx, input.userId);
      if (!userExists) throw new AppError("Utente non trovato", 404, "NOT_FOUND");

      const currentUser = await tx.user.findFirst({
        where: {
          id: input.userId,
          tenantId: input.tenantId,
          deletedAt: null,
          status: "ACTIVE"
        },
        select: { passwordHash: true }
      });
      if (!currentUser) throw new AppError("Utente non attivo", 403, "FORBIDDEN");
      if (input.expectedPasswordHash && currentUser.passwordHash !== input.expectedPasswordHash) {
        throw new AppError("Credenziali non valide", 401, "UNAUTHORIZED");
      }

      const created = await tx.refreshSession.create({
        data: {
          userId: input.userId,
          tenantId: input.tenantId,
          tokenHash: refreshHash,
          userAgent: input.userAgent,
          ipAddress: input.ipAddress,
          expiresAt
        }
      });

      if (input.ipAddress) {
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentSessions = await tx.refreshSession.findMany({
          where: { userId: input.userId, createdAt: { gte: dayAgo } },
          select: { ipAddress: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 30
        });
        const uniqueIps = new Set(recentSessions.map((x) => x.ipAddress).filter(Boolean));
        if (uniqueIps.size >= 4) {
          await tx.auditLog.create({
            data: {
              tenantId: input.tenantId,
              userId: input.userId,
              action: "SECURITY_ALERT_SESSION_ANOMALY",
              resource: "security",
              details: {
                uniqueIpsLast24h: uniqueIps.size,
                ipAddress: input.ipAddress,
                sample: Array.from(uniqueIps).slice(0, 6)
              } as any
            }
          });
        }
      }

      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          action: "AUTH_SESSION_CREATED",
          resource: "auth_session",
          resourceId: created.id,
          details: {
            sessionId: created.id,
            ipAddress: input.ipAddress ?? null,
            userAgent: input.userAgent ?? null
          }
        }
      });

      return created;
    });

    const accessToken = this.tokenService.signAccess({
      userId: input.userId,
      tenantId: input.tenantId,
      roles: input.roles,
      permissions: input.permissions,
      tokenType: "access",
      sessionId: session.id
    });

    return { accessToken, refreshToken: rawRefresh, sessionId: session.id, refreshExpiresAt: expiresAt.toISOString() };
  }

  async refresh(rawRefreshToken: string, userAgent?: string, ipAddress?: string) {
    const tokenHash = hashToken(rawRefreshToken);
    const rawRotatedRefresh = this.generateRefreshToken();
    const rotatedRefreshHash = hashToken(rawRotatedRefresh);
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86400000);

    const rotated = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const candidate = await tx.refreshSession.findUnique({ where: { tokenHash } });
      if (!candidate || candidate.expiresAt.getTime() <= now.getTime()) {
        return { kind: "invalid" as const };
      }
      const userExists = await lockUserForAuthMutation(tx, candidate.userId);
      if (!userExists) return { kind: "invalid" as const };

      // Re-read after taking the shared user lock. A password reset that won
      // the lock has already revoked this session; if refresh won, reset waits
      // and then sees/revokes the successor created below.
      const current = await tx.refreshSession.findUnique({ where: { tokenHash } });
      if (!current || current.expiresAt.getTime() <= now.getTime()) {
        return { kind: "invalid" as const };
      }
      if (current.revokedAt) {
        if (current.replacedById) {
          await tx.auditLog.create({
            data: {
              tenantId: current.tenantId,
              userId: current.userId,
              action: "SECURITY_ALERT_REFRESH_REUSE",
              resource: "auth_session",
              resourceId: current.id,
              details: {
                sessionId: current.id,
                replacedBySessionId: current.replacedById,
                ipAddress: ipAddress ?? null,
                userAgent: userAgent ?? null
              } as any
            }
          });
        }
        return { kind: "invalid" as const };
      }

      // Only one concurrent request can consume this row. A losing legitimate
      // retry receives 401 and does not revoke the winner or its successor.
      const consumed = await tx.refreshSession.updateMany({
        where: {
          id: current.id,
          tokenHash,
          revokedAt: null,
          expiresAt: { gt: now }
        },
        data: { revokedAt: now }
      });
      if (consumed.count !== 1) {
        const latest = await tx.refreshSession.findUnique({ where: { tokenHash } });
        if (latest?.replacedById) {
          await tx.auditLog.create({
            data: {
              tenantId: latest.tenantId,
              userId: latest.userId,
              action: "SECURITY_ALERT_REFRESH_REUSE",
              resource: "auth_session",
              resourceId: latest.id,
              details: {
                sessionId: latest.id,
                replacedBySessionId: latest.replacedById,
                ipAddress: ipAddress ?? null,
                userAgent: userAgent ?? null
              } as any
            }
          });
        }
        return { kind: "invalid" as const };
      }

      const userRecord = await tx.user.findFirst({
        where: {
          id: current.userId,
          tenantId: current.tenantId,
          deletedAt: null,
          status: "ACTIVE"
        },
        select: {
          id: true,
          tenantId: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
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
      });
      if (!userRecord) {
        throw new AppError("Utente non attivo", 403, "FORBIDDEN");
      }

      const successor = await tx.refreshSession.create({
        data: {
          userId: userRecord.id,
          tenantId: userRecord.tenantId,
          tokenHash: rotatedRefreshHash,
          userAgent,
          ipAddress,
          expiresAt: refreshExpiresAt
        }
      });

      await tx.refreshSession.update({
        where: { id: current.id },
        data: { replacedById: successor.id }
      });

      await tx.auditLog.create({
        data: {
          tenantId: userRecord.tenantId,
          userId: userRecord.id,
          action: "AUTH_SESSION_CREATED",
          resource: "auth_session",
          resourceId: successor.id,
          details: {
            sessionId: successor.id,
            ipAddress: ipAddress ?? null,
            userAgent: userAgent ?? null
          } as any
        }
      });
      await tx.auditLog.create({
        data: {
          tenantId: current.tenantId,
          userId: current.userId,
          action: "AUTH_SESSION_REFRESHED",
          resource: "auth_session",
          resourceId: current.id,
          details: {
            oldSessionId: current.id,
            newSessionId: successor.id,
            ipAddress: ipAddress ?? null,
            userAgent: userAgent ?? null
          } as any
        }
      });

      if (ipAddress) {
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentSessions = await tx.refreshSession.findMany({
          where: { userId: userRecord.id, createdAt: { gte: dayAgo } },
          select: { ipAddress: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 30
        });
        const uniqueIps = new Set(recentSessions.map(({ ipAddress: value }) => value).filter(Boolean));
        if (uniqueIps.size >= 4) {
          await tx.auditLog.create({
            data: {
              tenantId: userRecord.tenantId,
              userId: userRecord.id,
              action: "SECURITY_ALERT_SESSION_ANOMALY",
              resource: "security",
              details: {
                uniqueIpsLast24h: uniqueIps.size,
                ipAddress,
                sample: Array.from(uniqueIps).slice(0, 6)
              } as any
            }
          });
        }
      }

      return { kind: "rotated" as const, sessionId: successor.id, user: toSessionUser(userRecord) };
    });

    if (rotated.kind !== "rotated") {
      throw new AppError("Refresh token non valido", 401, "UNAUTHORIZED");
    }

    const accessToken = this.tokenService.signAccess({
      userId: rotated.user.id,
      tenantId: rotated.user.tenantId,
      roles: rotated.user.roles,
      permissions: rotated.user.permissions,
      tokenType: "access",
      sessionId: rotated.sessionId
    });

    return {
      sessionId: rotated.sessionId,
      user: rotated.user,
      accessToken,
      refreshToken: rawRotatedRefresh,
      refreshExpiresAt: refreshExpiresAt.toISOString()
    };
  }

  private async revokeSessionChain(
    sessionId: string,
    userId: string,
    action: "AUTH_SESSION_REVOKED_CURRENT" | "AUTH_SESSION_REVOKED_BY_ID"
  ) {
    await prisma.$transaction(async (tx) => {
      const userExists = await lockUserForAuthMutation(tx, userId);
      if (!userExists) return;

      // A refresh that won the user lock may already have replaced the session
      // referenced by the access token. Revoke its whole linear successor chain
      // while holding that same lock so logout cannot miss the active leaf.
      const ids: string[] = [];
      const visited = new Set<string>();
      let cursor: string | null = sessionId;
      let tenantId: string | undefined;
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        const session: { id: string; tenantId: string; replacedById: string | null } | null =
          await tx.refreshSession.findFirst({
            where: { id: cursor, userId },
            select: { id: true, tenantId: true, replacedById: true }
          });
        if (!session) break;
        ids.push(session.id);
        tenantId ??= session.tenantId;
        cursor = session.replacedById;
      }

      if (!ids.length || !tenantId) return;
      const revoked = await tx.refreshSession.updateMany({
        where: { id: { in: ids }, userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      if (revoked.count > 0) {
        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action,
            resource: "auth_session",
            resourceId: sessionId,
            details: { count: revoked.count }
          }
        });
      }
    });
    return { revoked: true };
  }

  async revokeCurrent(sessionId: string, userId: string) {
    return this.revokeSessionChain(sessionId, userId, "AUTH_SESSION_REVOKED_CURRENT");
  }

  async revokeById(sessionId: string, userId: string) {
    return this.revokeSessionChain(sessionId, userId, "AUTH_SESSION_REVOKED_BY_ID");
  }

  async revokeAll(userId: string) {
    await prisma.$transaction(async (tx) => {
      const userExists = await lockUserForAuthMutation(tx, userId);
      if (!userExists) return;

      const session = await tx.refreshSession.findFirst({
        where: { userId, revokedAt: null },
        select: { tenantId: true }
      });
      const revoked = await tx.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      if (session && revoked.count > 0) {
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            userId,
            action: "AUTH_SESSIONS_REVOKED_ALL",
            resource: "auth_session",
            details: { count: revoked.count }
          }
        });
      }
    });
    return { revoked: true };
  }

  async list(userId: string) {
    const select = {
      id: true,
      userAgent: true,
      ipAddress: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true
    } as const;
    return prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const active = await tx.refreshSession.findMany({
          where: { userId, revokedAt: null, expiresAt: { gt: now } },
          orderBy: { createdAt: "desc" },
          select
        });
        const historyLimit = Math.max(0, 20 - active.length);
        const history = historyLimit
          ? await tx.refreshSession.findMany({
              where: {
                userId,
                OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }]
              },
              orderBy: { createdAt: "desc" },
              take: historyLimit,
              select
            })
          : [];
        return { data: [...active, ...history] };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }
}
