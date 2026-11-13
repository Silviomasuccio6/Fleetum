import bcrypt from "bcryptjs";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { lockUserForAuthMutation } from "../../../infrastructure/database/prisma/auth-user-lock.js";
import { PrismaUserRepository } from "../../../infrastructure/repositories/prisma-user-repository.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { AuthSessionService } from "../../services/auth-session-service.js";

export class ManageProfileUseCase {
  constructor(private readonly userRepository: PrismaUserRepository, private readonly authSessionService: AuthSessionService) {}

  async me(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new AppError("Utente non trovato", 404, "NOT_FOUND");
    return user;
  }

  async updateProfile(tenantId: string, userId: string, input: { firstName: string; lastName: string }) {
    const user = await this.userRepository.updateProfile(tenantId, userId, input);
    if (!user) throw new AppError("Utente non trovato", 404, "NOT_FOUND");
    return user;
  }

  async changePassword(
    tenantId: string,
    userId: string,
    input: { currentPassword: string; newPassword: string; logoutAllDevices?: boolean }
  ) {
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null, status: "ACTIVE" },
      select: { passwordHash: true }
    });
    if (!user) throw new AppError("Utente non trovato", 404, "NOT_FOUND");

    const validCurrent = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!validCurrent) throw new AppError("Password attuale non valida", 400, "VALIDATION_ERROR");

    const samePassword = await bcrypt.compare(input.newPassword, user.passwordHash);
    if (samePassword) throw new AppError("La nuova password deve essere diversa dalla precedente", 400, "VALIDATION_ERROR");

    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    await prisma.$transaction(async (tx) => {
      const conflict = () => new AppError("Le credenziali o lo stato dell'utente sono cambiati. Riprova.", 409, "CONFLICT");
      if (!(await lockUserForAuthMutation(tx, userId))) throw conflict();

      // A reset or another password change that won the shared lock must not
      // be overwritten by a request verified against an earlier credential.
      const updated = await tx.user.updateMany({
        where: { id: userId, tenantId, deletedAt: null, status: "ACTIVE", passwordHash: user.passwordHash },
        data: { passwordHash }
      });
      if (updated.count !== 1) throw conflict();

      const now = new Date();
      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now }
      });

      if (input.logoutAllDevices) {
        // Refresh rotation takes the same user lock: its successor is either
        // included here or cannot be created from the now-revoked session.
        const revoked = await tx.refreshSession.updateMany({
          where: { userId, tenantId, revokedAt: null },
          data: { revokedAt: now }
        });
        if (revoked.count > 0) {
          await tx.auditLog.create({
            data: {
              tenantId,
              userId,
              action: "AUTH_SESSIONS_REVOKED_ALL",
              resource: "auth_session",
              details: { count: revoked.count }
            }
          });
        }
      }
    });

    return { updated: true, sessionsRevoked: Boolean(input.logoutAllDevices) };
  }
}
