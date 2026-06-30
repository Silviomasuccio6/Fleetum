import bcrypt from "bcryptjs";
import { PrismaUserRepository } from "../../../infrastructure/repositories/prisma-user-repository.js";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { SignupInput } from "../../dtos/auth-dto.js";
import { getPlanMonthlyPrice } from "../../services/feature-entitlements-service.js";
import { TenantProfileService } from "../../services/tenant-profile-service.js";
import { upsertTenantSubscription } from "../../services/tenant-subscription-service.js";

type SocialSignupInput = {
  email: string;
  provider: "google" | "apple";
  firstName?: string;
  lastName?: string;
  fullName?: string;
};

export class SignupUseCase {
  constructor(
    private readonly userRepository: PrismaUserRepository,
    private readonly tenantProfileService: TenantProfileService = new TenantProfileService()
  ) {}

  async execute(input: SignupInput) {
    const globalExisting = await prisma.user.findFirst({ where: { email: input.email, deletedAt: null } });
    if (globalExisting) throw new AppError("Email già utilizzata", 409, "CONFLICT");

    const tenant = await prisma.tenant.create({
      data: {
        name: input.company?.tradeName ?? input.tenantName,
        vatNumber: input.company?.vatNumber ?? null
      }
    });
    const existing = await this.userRepository.findByEmail(tenant.id, input.email);
    if (existing) throw new AppError("Email già utilizzata", 409, "CONFLICT");

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.userRepository.create({
      tenantId: tenant.id,
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      roleKey: "ADMIN"
    });

    await this.tenantProfileService.ensureForTenant({
      tenantId: tenant.id,
      tenantName: input.tenantName,
      adminFirstName: input.firstName,
      adminLastName: input.lastName,
      adminEmail: input.email,
      company: {
        ...input.company,
        legalName: input.company?.legalName ?? input.tenantName,
        tradeName: input.company?.tradeName ?? input.tenantName,
        adminFirstName: input.company?.adminFirstName ?? input.firstName,
        adminLastName: input.company?.adminLastName ?? input.lastName,
        adminEmail: input.company?.adminEmail ?? input.email,
        adminPhone: input.company?.adminPhone ?? input.phone,
        adminRole: input.company?.adminRole ?? input.adminRole
      }
    });

    const subscription = await upsertTenantSubscription({
      tenantId: tenant.id,
      plan: "STARTER",
      seats: 3,
      status: "PENDING",
      expiresAt: null,
      priceMonthly: getPlanMonthlyPrice("STARTER"),
      billingCycle: "monthly",
      provider: "stripe"
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        action: "PLATFORM_LICENSE_UPDATED",
        resource: "tenant",
        resourceId: tenant.id,
        details: {
          source: "signup_pending_billing",
          after: {
            plan: "STARTER",
            seats: 3,
            status: "PENDING",
            expiresAt: null,
            priceMonthly: getPlanMonthlyPrice("STARTER"),
            billingCycle: "monthly",
            updatedAt: new Date().toISOString(),
            subscription
          }
        }
      }
    });

    return { tenantId: tenant.id, user };
  }
  async executeSocial(input: SocialSignupInput) {
    const normalizedEmail = input.email.trim().toLowerCase();
    if (!normalizedEmail) throw new AppError("Email social non valida", 400, "INVALID_SOCIAL_EMAIL");

    const globalExisting = await prisma.user.findFirst({ where: { email: normalizedEmail, deletedAt: null } });
    if (globalExisting) throw new AppError("Email già utilizzata", 409, "CONFLICT");

    const nameParts = (input.fullName ?? "").trim().split(/\s+/).filter(Boolean);
    const firstName = (input.firstName?.trim() || nameParts[0] || "Admin").slice(0, 60);
    const lastName = (input.lastName?.trim() || nameParts.slice(1).join(" ") || input.provider.toUpperCase()).slice(0, 60);
    const tenantName = "Account in configurazione";

    const randomPassword = `S!${Math.random().toString(36).slice(2, 12)}A1`;
    const passwordHash = await bcrypt.hash(randomPassword, 12);

    const tenant = await prisma.tenant.create({ data: { name: tenantName } });
    const user = await this.userRepository.create({
      tenantId: tenant.id,
      email: normalizedEmail,
      passwordHash,
      firstName,
      lastName,
      roleKey: "ADMIN"
    });

    await this.tenantProfileService.ensureDefaultsForTenant({
      tenantId: tenant.id,
      company: null
    });

    const subscription = await upsertTenantSubscription({
      tenantId: tenant.id,
      plan: "STARTER",
      seats: 3,
      status: "PENDING",
      expiresAt: null,
      priceMonthly: getPlanMonthlyPrice("STARTER"),
      billingCycle: "monthly",
      provider: "stripe"
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        action: "PLATFORM_LICENSE_UPDATED",
        resource: "tenant",
        resourceId: tenant.id,
        details: {
          source: "signup_pending_billing",
          after: {
            plan: "STARTER",
            seats: 3,
            status: "PENDING",
            expiresAt: null,
            priceMonthly: getPlanMonthlyPrice("STARTER"),
            billingCycle: "monthly",
            updatedAt: new Date().toISOString(),
            subscription
          }
        }
      }
    });

    return { tenantId: tenant.id, user };
  }

}
