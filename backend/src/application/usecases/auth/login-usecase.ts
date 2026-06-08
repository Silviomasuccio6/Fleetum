import bcrypt from "bcryptjs";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { PrismaUserRepository } from "../../../infrastructure/repositories/prisma-user-repository.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { LoginInput } from "../../dtos/auth-dto.js";
import { AuthSessionService } from "../../services/auth-session-service.js";
import { LicensePolicyService } from "../../services/license-policy-service.js";
import { TokenService } from "../../services/token-service.js";

export class LoginUseCase {
  constructor(
    private readonly userRepository: PrismaUserRepository,
    private readonly tokenService: TokenService,
    private readonly licensePolicyService: LicensePolicyService,
    private readonly authSessionService: AuthSessionService
  ) {}

  async execute(input: LoginInput, context?: { userAgent?: string; ipAddress?: string }) {
    const candidates = await prisma.user.findMany({
      where: { email: input.email, deletedAt: null },
      select: { id: true, passwordHash: true, status: true }
    });
    if (!candidates.length) throw new AppError("Credenziali non valide", 401, "UNAUTHORIZED");

    const matchingUserIds: string[] = [];
    for (const candidate of candidates) {
      const ok = await bcrypt.compare(input.password, candidate.passwordHash);
      if (ok) matchingUserIds.push(candidate.id);
    }

    if (matchingUserIds.length === 0) throw new AppError("Credenziali non valide", 401, "UNAUTHORIZED");
    if (matchingUserIds.length > 1) {
      throw new AppError(
        "Email associata a più tenant. Contatta supporto per unificare l'utenza.",
        409,
        "AMBIGUOUS_LOGIN"
      );
    }

    const user = await this.userRepository.findById(matchingUserIds[0]);
    return this.issueSessionForUser(user?.id ?? "", context);
  }

  async executeTrustedEmail(email: string, context?: { userAgent?: string; ipAddress?: string }) {
    const normalized = email.trim().toLowerCase();
    if (!normalized) throw new AppError("Email provider non valida", 400, "INVALID_SOCIAL_EMAIL");

    const candidates = await prisma.user.findMany({
      where: { email: normalized, deletedAt: null },
      select: { id: true }
    });

    if (candidates.length === 0) {
      throw new AppError("Nessun utente associato a questo account social. Crea prima un account.", 404, "SOCIAL_USER_NOT_FOUND");
    }

    if (candidates.length > 1) {
      throw new AppError(
        "Email associata a più tenant. Accedi con email/password o contatta il supporto.",
        409,
        "AMBIGUOUS_LOGIN"
      );
    }

    return this.issueSessionForUser(candidates[0].id, context);
  }

  private async issueSessionForUser(userId: string, context?: { userAgent?: string; ipAddress?: string }) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new AppError("Utente non trovato", 404, "NOT_FOUND");
    if (user.status !== "ACTIVE") throw new AppError("Utente non attivo", 403, "FORBIDDEN");
    const access = await this.licensePolicyService.evaluateAccess(user.tenantId);
    const canAuthenticateForBilling =
      access.reason === "LICENSE_PENDING" ||
      access.reason === "LICENSE_EXPIRED" ||
      access.reason === "LICENSE_PAST_DUE" ||
      access.reason === "LICENSE_CANCELED";
    if (access.blocked && !canAuthenticateForBilling) {
      if (access.reason === "TENANT_INACTIVE") throw new AppError("Tenant disattivato. Contatta l'amministratore.", 403, "TENANT_INACTIVE");
      if (access.reason === "LICENSE_SUSPENDED") throw new AppError("Licenza sospesa. Contatta il supporto.", 403, "LICENSE_SUSPENDED");
      throw new AppError("Licenza scaduta. Rinnova per continuare.", 402, "LICENSE_EXPIRED");
    }

    const session = await this.authSessionService.createSession({
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
      permissions: user.permissions,
      userAgent: context?.userAgent,
      ipAddress: context?.ipAddress
    });
    const token = this.tokenService.sign({
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
      permissions: user.permissions,
      tokenType: "access",
      sessionId: session.sessionId
    });
    return { token, refreshToken: session.refreshToken, refreshExpiresAt: session.refreshExpiresAt, user };
  }
}
