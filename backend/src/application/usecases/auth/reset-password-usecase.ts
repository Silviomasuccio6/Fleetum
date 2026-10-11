import bcrypt from "bcryptjs";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { lockUserForAuthMutation } from "../../../infrastructure/database/prisma/auth-user-lock.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { hashToken } from "../../../infrastructure/email/email-queue-service.js";

export class ResetPasswordUseCase {
  async execute(input: { token: string; newPassword: string }) {
    const tokenHash = hashToken(input.token);
    const preflightAt = new Date();
    const record = await prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: preflightAt },
        user: { is: { deletedAt: null, status: "ACTIVE" } }
      },
      select: {
        id: true,
        userId: true,
        user: { select: { status: true, deletedAt: true } }
      }
    });
    if (!record || record.user.status !== "ACTIVE" || record.user.deletedAt) {
      throw new AppError("Token reset non valido o scaduto", 400, "INVALID_TOKEN");
    }

    // Avoid the password-hash cost for clearly invalid or ineligible tokens.
    const passwordHash = await bcrypt.hash(input.newPassword, 12);

    await prisma.$transaction(async (tx) => {
      const now = new Date();
      const userExists = await lockUserForAuthMutation(tx, record.userId);
      if (!userExists) {
        throw new AppError("Token reset non valido o scaduto", 400, "INVALID_TOKEN");
      }

      // Compare-and-set prevents two concurrent submissions of the same token
      // from both changing credentials.
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });
      if (consumed.count !== 1) {
        throw new AppError("Token reset non valido o scaduto", 400, "INVALID_TOKEN");
      }

      // The status predicate is intentional: password reset never activates an
      // invited or suspended account, including a suspension racing this reset.
      const updated = await tx.user.updateMany({
        where: { id: record.userId, deletedAt: null, status: "ACTIVE" },
        data: { passwordHash }
      });
      if (updated.count !== 1) {
        throw new AppError("Token reset non valido o scaduto", 400, "INVALID_TOKEN");
      }

      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, id: { not: record.id }, usedAt: null },
        data: { usedAt: now }
      });
      await tx.refreshSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now }
      });
    });

    return { success: true };
  }
}
