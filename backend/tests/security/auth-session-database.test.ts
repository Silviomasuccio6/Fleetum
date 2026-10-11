import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { AuthSessionService } from "../../src/application/services/auth-session-service.js";
import { ResetPasswordUseCase } from "../../src/application/usecases/auth/reset-password-usecase.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";

const runId = `auth-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let tenantId = "";
let userId = "";

describe("password reset and refresh persistence", () => {
  before(async () => {
    await prisma.$connect();
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('Tenant', 'User', 'RefreshSession', 'PasswordResetToken')
    `;
    assert.equal(tables.length, 4, "Auth race test requires a migrated PostgreSQL test database");

    const tenant = await prisma.tenant.create({ data: { name: `Auth race ${runId}` } });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: {
        tenantId,
        email: `${runId}@example.test`,
        passwordHash: "synthetic-old-password-hash",
        firstName: "Synthetic",
        lastName: "Auth race",
        status: "ACTIVE"
      }
    });
    userId = user.id;
  });

  after(async () => {
    if (tenantId) {
      await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.passwordResetToken.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.refreshSession.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
      await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("leaves no usable successor when password reset races refresh rotation", async () => {
    const rawRefresh = randomBytes(32).toString("hex");
    const rawReset = randomBytes(32).toString("hex");
    await prisma.refreshSession.create({
      data: {
        userId,
        tenantId,
        tokenHash: hash(rawRefresh),
        expiresAt: new Date(Date.now() + 60_000)
      }
    });
    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hash(rawReset),
        expiresAt: new Date(Date.now() + 60_000)
      }
    });

    const sessions = new AuthSessionService(
      { signAccess: () => "synthetic-access-token" } as any,
      {} as any
    );
    const results = await Promise.allSettled([
      sessions.refresh(rawRefresh, "synthetic-agent", "127.0.0.1"),
      new ResetPasswordUseCase().execute({
        token: rawReset,
        newPassword: "synthetic-new-password-123"
      })
    ]);

    assert.equal(results[1].status, "fulfilled", "Password reset must complete");
    const activeSessions = await prisma.refreshSession.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }
    });
    assert.equal(activeSessions, 0, "Reset must revoke both the predecessor and any concurrent successor");
  });

  it("leaves no usable successor when logout races refresh rotation", async () => {
    const rawRefresh = randomBytes(32).toString("hex");
    const current = await prisma.refreshSession.create({
      data: {
        userId,
        tenantId,
        tokenHash: hash(rawRefresh),
        expiresAt: new Date(Date.now() + 60_000)
      }
    });
    const sessions = new AuthSessionService(
      { signAccess: () => "synthetic-access-token" } as any,
      {} as any
    );

    const results = await Promise.allSettled([
      sessions.refresh(rawRefresh, "synthetic-agent", "127.0.0.1"),
      sessions.revokeCurrent(current.id, userId)
    ]);

    assert.equal(results[1].status, "fulfilled", "Logout must complete");
    const activeSessions = await prisma.refreshSession.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }
    });
    assert.equal(activeSessions, 0, "Logout must revoke the predecessor and any concurrent successor");
  });
});
