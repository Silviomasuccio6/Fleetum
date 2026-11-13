import bcrypt from "bcryptjs";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { lockUserForAuthMutation } from "../../../infrastructure/database/prisma/auth-user-lock.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { hashToken } from "../../../infrastructure/email/email-queue-service.js";

export class AcceptInviteUseCase {
  async execute(input: { token: string; password: string; firstName?: string; lastName?: string }) {
    const tokenHash = hashToken(input.token);

    const invite = await prisma.invitationToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
        user: { is: { deletedAt: null, status: "INVITED" } }
      },
      include: { user: true }
    });

    if (!invite) throw new AppError("Invito non valido o scaduto", 400, "INVALID_INVITE");

    const passwordHash = await bcrypt.hash(input.password, 12);

    await prisma.$transaction(async (tx) => {
      const userExists = await lockUserForAuthMutation(tx, invite.userId);
      if (!userExists) throw new AppError("Invito non valido o scaduto", 400, "INVALID_INVITE");
      const now = new Date();

      const consumed = await tx.invitationToken.updateMany({
        where: { id: invite.id, userId: invite.userId, tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });
      if (consumed.count !== 1) throw new AppError("Invito non valido o scaduto", 400, "INVALID_INVITE");

      // An invitation activates only an account still awaiting activation. It
      // cannot undo suspension or replace credentials after an earlier accept.
      const activated = await tx.user.updateMany({
        where: { id: invite.userId, deletedAt: null, status: "INVITED" },
        data: {
          passwordHash,
          status: "ACTIVE",
          ...(input.firstName ? { firstName: input.firstName } : {}),
          ...(input.lastName ? { lastName: input.lastName } : {})
        }
      });
      if (activated.count !== 1) throw new AppError("Invito non valido o scaduto", 400, "INVALID_INVITE");

      await tx.invitationToken.updateMany({
        where: { userId: invite.userId, id: { not: invite.id }, usedAt: null },
        data: { usedAt: now }
      });
      // Historical accounts returned to INVITED may still have reset links.
      // Activation must not make those older credential-recovery links usable.
      await tx.passwordResetToken.updateMany({
        where: { userId: invite.userId, usedAt: null },
        data: { usedAt: now }
      });
      await tx.refreshSession.updateMany({
        where: { userId: invite.userId, revokedAt: null },
        data: { revokedAt: now }
      });
    });

    return { success: true, email: invite.user.email };
  }
}
