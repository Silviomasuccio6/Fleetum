import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { EmailQueueService, createRawToken, hashToken } from "../../../infrastructure/email/email-queue-service.js";
import { env } from "../../../shared/config/env.js";

export class RequestPasswordResetUseCase {
  constructor(private readonly emailQueueService: EmailQueueService) {}

  async execute(email: string) {
    const users = await prisma.user.findMany({ where: { email, deletedAt: null } });
    if (!users.length) return { accepted: true };

    for (const user of users) {
      const rawToken = createRawToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 1000 * 60 * 30);

      await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } });

      const link = `${env.APP_URL}/reset-password?token=${rawToken}`;
      const subject = "Reset password - Fleetum";
      const body = `Ciao ${user.firstName},\n\nusa questo link per reimpostare la password (valido 30 minuti):\n${link}\n\nSe non hai richiesto il reset, ignora questa email.`;

      await this.emailQueueService.enqueue({
        tenantId: user.tenantId,
        type: "PASSWORD_RESET",
        recipient: user.email,
        subject,
        body
      });
    }

    return { accepted: true };
  }
}
