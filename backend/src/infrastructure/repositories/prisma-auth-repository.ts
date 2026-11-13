import { prisma } from "../database/prisma/client.js";
import { lockUserForAuthMutation } from "../database/prisma/auth-user-lock.js";
import { AppError } from "../../shared/errors/app-error.js";

export class PrismaAuthRepository {
  findLoginCandidatesByEmail(email: string) {
    return prisma.user.findMany({
      where: { email, deletedAt: null },
      select: { id: true, passwordHash: true, status: true }
    });
  }

  findUserByEmailGlobal(email: string) {
    return prisma.user.findFirst({ where: { email, deletedAt: null } });
  }

  findUsersByEmailGlobal(email: string) {
    return prisma.user.findMany({ where: { email, deletedAt: null } });
  }

  createTenant(name: string) {
    return prisma.tenant.create({ data: { name } });
  }

  createInvitationToken(userId: string, tokenHash: string, expiresAt: Date) {
    return prisma.invitationToken.create({ data: { userId, tokenHash, expiresAt } });
  }

  findValidInvitationToken(tokenHash: string) {
    return prisma.invitationToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true }
    });
  }

  activateUserByInvitation(
    invitationId: string,
    userId: string,
    passwordHash: string,
    firstName?: string,
    lastName?: string
  ) {
    return prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          status: "ACTIVE",
          ...(firstName ? { firstName } : {}),
          ...(lastName ? { lastName } : {})
        }
      }),
      prisma.invitationToken.update({ where: { id: invitationId }, data: { usedAt: new Date() } })
    ]);
  }

  createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date) {
    return prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
  }

  findValidPasswordResetToken(tokenHash: string) {
    return prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
        user: { is: { deletedAt: null, status: "ACTIVE" } }
      },
      include: { user: true }
    });
  }

  consumePasswordResetToken(recordId: string, userId: string, passwordHash: string) {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const userExists = await lockUserForAuthMutation(tx, userId);
      if (!userExists) {
        throw new AppError("Token reset non valido o scaduto", 400, "INVALID_TOKEN");
      }

      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: recordId, userId, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });
      if (consumed.count !== 1) {
        throw new AppError("Token reset non valido o scaduto", 400, "INVALID_TOKEN");
      }

      const updated = await tx.user.updateMany({
        where: { id: userId, deletedAt: null, status: "ACTIVE" },
        data: { passwordHash }
      });
      if (updated.count !== 1) {
        throw new AppError("Token reset non valido o scaduto", 400, "INVALID_TOKEN");
      }

      await tx.passwordResetToken.updateMany({
        where: { userId, id: { not: recordId }, usedAt: null },
        data: { usedAt: now }
      });
      await tx.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now }
      });

      return { success: true };
    });
  }

  findUserPasswordHash(tenantId: string, userId: string) {
    return prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { passwordHash: true }
    });
  }

  updateUserPassword(userId: string, passwordHash: string) {
    return prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }
}
