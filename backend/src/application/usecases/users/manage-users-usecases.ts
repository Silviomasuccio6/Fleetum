import bcrypt from "bcryptjs";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { EmailQueueService, createRawToken, hashToken } from "../../../infrastructure/email/email-queue-service.js";
import { env } from "../../../shared/config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { PrismaUserRepository } from "../../../infrastructure/repositories/prisma-user-repository.js";

export class ManageUsersUseCases {
  constructor(private readonly userRepository: PrismaUserRepository, private readonly emailQueueService: EmailQueueService) {}

  list(tenantId: string) {
    return this.userRepository.list(tenantId);
  }

  listRoles() {
    return this.userRepository.listRoles();
  }

  async create(
    tenantId: string,
    input: {
      email: string;
      firstName: string;
      lastName: string;
      password: string;
      roleKey: "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
    }
  ) {
    const existing = await this.userRepository.findByEmail(tenantId, input.email);
    if (existing) throw new AppError("Email già presente nel tenant", 409, "CONFLICT");

    const passwordHash = await bcrypt.hash(input.password, 12);
    return this.userRepository.create({
      tenantId,
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      roleKey: input.roleKey
    });
  }

  async updateProfile(
    tenantId: string,
    userId: string,
    input: Partial<{ firstName: string; lastName: string; status: "ACTIVE" | "INVITED" | "SUSPENDED" }>
  ) {
    const user = await this.userRepository.updateProfile(tenantId, userId, input);
    if (!user) throw new AppError("Utente non trovato", 404, "NOT_FOUND");
    return user;
  }

  async setRole(tenantId: string, userId: string, roleKey: "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER") {
    const user = await this.userRepository.setRole(tenantId, userId, roleKey);
    if (!user) throw new AppError("Utente non trovato", 404, "NOT_FOUND");
    return user;
  }

  async remove(tenantId: string, userId: string, requesterId: string) {
    if (userId === requesterId) throw new AppError("Non puoi eliminare il tuo account", 400, "VALIDATION_ERROR");
    await this.userRepository.softDelete(tenantId, userId);
  }

  async invite(
    tenantId: string,
    input: {
      email: string;
      firstName: string;
      lastName: string;
      roleKey: "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
    }
  ) {
    const existing = await this.userRepository.findByEmail(tenantId, input.email);
    if (existing) throw new AppError("Email già presente nel tenant", 409, "CONFLICT");

    const placeholderPassword = await bcrypt.hash(createRawToken(), 12);
    const user = await this.userRepository.create({
      tenantId,
      email: input.email,
      passwordHash: placeholderPassword,
      firstName: input.firstName,
      lastName: input.lastName,
      roleKey: input.roleKey
    });
    await this.userRepository.updateProfile(tenantId, user.id, { status: "INVITED" });

    const rawToken = createRawToken();
    await prisma.invitationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)
      }
    });

    const link = `${env.APP_URL}/accept-invite?token=${rawToken}`;
    const subject = "Invito Fleetum";
    const body = `Ciao ${input.firstName},\\n\\nsei stato invitato su Fleetum. Completa l'attivazione dal link:\\n${link}\\n\\nIl link scade tra 7 giorni.`;

    await this.emailQueueService.enqueue({
      tenantId,
      type: "USER_INVITATION",
      recipient: input.email,
      subject,
      body
    });

    return { invited: true };
  }
}
