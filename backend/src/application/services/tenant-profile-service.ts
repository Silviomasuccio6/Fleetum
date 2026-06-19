import crypto from "node:crypto";
import fs from "node:fs/promises";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { storageProvider } from "../../infrastructure/storage/storage-provider.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { validateCompanyRegistrationDraft } from "../../shared/validation/company-registration.js";
import type { SignupCompanyInput, TenantCompanyProfileInput } from "../../interfaces/http/validators/tenant-profile-validators.js";

const normalizeText = (value?: string | null) => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeCountry = (value?: string | null) => (normalizeText(value) ?? "IT").toUpperCase();
const normalizeVat = (value?: string | null) => normalizeText(value)?.replace(/\s+/g, "") ?? null;

const profileRequiredKeys = [
  "legalName",
  "vatNumber",
  "legalAddress",
  "city",
  "province",
  "postalCode",
  "email",
  "phone",
  "adminFirstName",
  "adminLastName",
  "adminEmail"
] as const;

export class TenantProfileService {
  private validateBusinessRules(input: Partial<TenantCompanyProfileInput | SignupCompanyInput>) {
    const errors = validateCompanyRegistrationDraft({
      country: input.country,
      tenantName: input.legalName,
      vatNumber: input.vatNumber,
      taxCode: input.taxCode,
      pec: input.pec,
      sdiCode: input.sdiCode,
      legalAddress: input.legalAddress,
      city: input.city,
      province: input.province,
      postalCode: input.postalCode,
      companyEmail: input.email,
      companyPhone: input.phone
    });
    if (errors.length > 0) {
      const first = errors[0];
      throw new AppError(first.message, 400, first.code);
    }
  }

  private profileCompleteness(profile: Record<string, unknown> | null, branding?: { logoFilePath?: string | null } | null) {
    if (!profile) {
      return {
        percentage: 0,
        completed: false,
        missing: [...profileRequiredKeys, "logo"] as string[]
      };
    }
    const missing = profileRequiredKeys.filter((key) => !normalizeText(profile[key] as string | null | undefined));
    if (!branding?.logoFilePath) missing.push("logo" as never);
    const total = profileRequiredKeys.length + 1;
    const percentage = Math.round(((total - missing.length) / total) * 100);
    return {
      percentage,
      completed: missing.length === 0,
      missing
    };
  }

  private profileData(input: Partial<TenantCompanyProfileInput | SignupCompanyInput>) {
    const country = normalizeCountry(input.country);
    return {
      legalName: normalizeText(input.legalName)!,
      tradeName: normalizeText(input.tradeName),
      legalForm: normalizeText(input.legalForm),
      vatNumber: normalizeVat(input.vatNumber),
      taxCode: normalizeText(input.taxCode),
      pec: normalizeText(input.pec),
      sdiCode: normalizeText(input.sdiCode)?.toUpperCase() ?? null,
      rea: normalizeText(input.rea),
      legalAddress: normalizeText(input.legalAddress),
      city: normalizeText(input.city),
      province: normalizeText(input.province)?.toUpperCase() ?? null,
      postalCode: normalizeText(input.postalCode),
      country,
      phone: normalizeText(input.phone),
      email: normalizeText(input.email)?.toLowerCase() ?? null,
      website: normalizeText(input.website),
      adminFirstName: normalizeText(input.adminFirstName),
      adminLastName: normalizeText(input.adminLastName),
      adminEmail: normalizeText(input.adminEmail)?.toLowerCase() ?? null,
      adminPhone: normalizeText(input.adminPhone),
      adminRole: normalizeText(input.adminRole)
    };
  }

  async ensureForTenant(input: {
    tenantId: string;
    tenantName: string;
    adminFirstName?: string | null;
    adminLastName?: string | null;
    adminEmail?: string | null;
    company?: Partial<SignupCompanyInput> | null;
  }) {
    const legalName = normalizeText(input.company?.legalName) ?? input.tenantName;
    const hasCompanyOnboardingPayload = Boolean(
      input.company?.vatNumber ||
        input.company?.taxCode ||
        input.company?.pec ||
        input.company?.sdiCode ||
        input.company?.legalAddress ||
        input.company?.city ||
        input.company?.province ||
        input.company?.postalCode ||
        input.company?.email ||
        input.company?.phone
    );
    if (hasCompanyOnboardingPayload) {
      this.validateBusinessRules({
        ...input.company,
        legalName
      });
    }

    const profile = await prisma.tenantProfile.upsert({
      where: { tenantId: input.tenantId },
      create: {
        tenantId: input.tenantId,
        ...this.profileData({
          ...input.company,
          legalName,
          tradeName: input.company?.tradeName ?? input.tenantName,
          adminFirstName: input.company?.adminFirstName ?? input.adminFirstName ?? undefined,
          adminLastName: input.company?.adminLastName ?? input.adminLastName ?? undefined,
          adminEmail: input.company?.adminEmail ?? input.adminEmail ?? undefined
        })
      },
      update: {}
    });

    await prisma.tenantBranding.upsert({
      where: { tenantId: input.tenantId },
      create: {
        tenantId: input.tenantId,
        primaryColor: input.company?.primaryColor ?? "#21375d",
        accentColor: input.company?.accentColor ?? "#5d82c2",
        fontFamily: input.company?.fontFamily ?? "helvetica"
      },
      update: {}
    });

    await prisma.tenantLegalSettings.upsert({
      where: { tenantId: input.tenantId },
      create: {
        tenantId: input.tenantId,
        contractFooterText: "Contratto generato dal gestionale aziendale. Verificare i dati prima della sottoscrizione.",
        privacyNoticeVersion: "2026-05-05"
      },
      update: {}
    });

    return profile;
  }

  async getProfile(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        users: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { firstName: true, lastName: true, email: true }
        }
      }
    });
    if (!tenant) throw new AppError("Tenant non trovato", 404, "TENANT_NOT_FOUND");
    const firstAdmin = tenant.users[0];
    await this.ensureForTenant({
      tenantId,
      tenantName: tenant.name,
      adminFirstName: firstAdmin?.firstName,
      adminLastName: firstAdmin?.lastName,
      adminEmail: firstAdmin?.email
    });
    const [profile, branding, legalSettings] = await Promise.all([
      prisma.tenantProfile.findUnique({ where: { tenantId } }),
      prisma.tenantBranding.findUnique({ where: { tenantId } }),
      prisma.tenantLegalSettings.findUnique({ where: { tenantId } })
    ]);
    const completeness = this.profileCompleteness(profile as unknown as Record<string, unknown>, branding);
    return { profile, branding, legalSettings, completeness };
  }

  async updateProfile(tenantId: string, actorUserId: string, input: TenantCompanyProfileInput) {
    this.validateBusinessRules(input);

    const profilePayload = this.profileData(input);
    const [profile, branding, legalSettings] = await prisma.$transaction(async (tx) => {
      const profile = await tx.tenantProfile.upsert({
        where: { tenantId },
        create: { tenantId, ...profilePayload },
        update: {
          ...profilePayload,
          profileCompletedAt: this.profileCompleteness(profilePayload).completed ? new Date() : null
        }
      });

      const branding = await tx.tenantBranding.upsert({
        where: { tenantId },
        create: {
          tenantId,
          primaryColor: input.primaryColor ?? "#21375d",
          accentColor: input.accentColor ?? "#5d82c2",
          fontFamily: input.fontFamily ?? "helvetica"
        },
        update: {
          primaryColor: input.primaryColor ?? null,
          accentColor: input.accentColor ?? null,
          fontFamily: input.fontFamily ?? null
        }
      });

      const legalSettings = await tx.tenantLegalSettings.upsert({
        where: { tenantId },
        create: {
          tenantId,
          contractFooterText: input.contractFooterText ?? null,
          defaultContractTerms: input.defaultContractTerms ?? null,
          termsVersion: input.termsVersion ?? null,
          dpaVersion: input.dpaVersion ?? null,
          privacyNoticeVersion: "2026-05-05"
        },
        update: {
          contractFooterText: input.contractFooterText ?? null,
          defaultContractTerms: input.defaultContractTerms ?? null,
          termsVersion: input.termsVersion ?? null,
          dpaVersion: input.dpaVersion ?? null
        }
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: actorUserId,
          action: "TENANT_PROFILE_UPDATED",
          resource: "TenantProfile",
          resourceId: profile.id,
          details: {
            legalName: profile.legalName,
            completeness: this.profileCompleteness(profile as unknown as Record<string, unknown>, branding)
          }
        }
      });

      return [profile, branding, legalSettings] as const;
    });

    return { profile, branding, legalSettings, completeness: this.profileCompleteness(profile as unknown as Record<string, unknown>, branding) };
  }

  async setLogo(tenantId: string, actorUserId: string, file: Express.Multer.File) {
    const relativePath = storageProvider.buildKey(file.filename);
    await storageProvider.writeFromFile(relativePath, file.path, { tenantId, resourceType: "TenantBranding", resourceId: tenantId, originalName: file.originalname, mimeType: file.mimetype });
    if (storageProvider.name === "s3") await fs.unlink(file.path).catch(() => undefined);
    const current = await prisma.tenantBranding.findUnique({ where: { tenantId } });
    const branding = await prisma.tenantBranding.upsert({
      where: { tenantId },
      create: {
        tenantId,
        logoFilePath: relativePath,
        logoFileName: file.originalname,
        logoMimeType: file.mimetype,
        primaryColor: "#21375d",
        accentColor: "#5d82c2",
        fontFamily: "helvetica"
      },
      update: {
        logoFilePath: relativePath,
        logoFileName: file.originalname,
        logoMimeType: file.mimetype
      }
    });

    if (current?.logoFilePath && current.logoFilePath !== relativePath) {
      await storageProvider.delete(current.logoFilePath);
    }

    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: actorUserId,
        action: "TENANT_BRANDING_LOGO_UPDATED",
        resource: "TenantBranding",
        resourceId: branding.id,
        details: { fileName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size }
      }
    });

    const nextProfile = await prisma.tenantProfile.findUnique({ where: { tenantId } });
    if (nextProfile) {
      const completeness = this.profileCompleteness(nextProfile as unknown as Record<string, unknown>, branding);
      await prisma.tenantProfile.update({
        where: { tenantId },
        data: { profileCompletedAt: completeness.completed ? new Date() : null }
      });
    }

    return this.getProfile(tenantId);
  }

  async setCompanyVerificationDocument(tenantId: string, actorUserId: string, file: Express.Multer.File) {
    const fileBuffer = await fs.readFile(file.path);
    const checksumSha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const storageKey = storageProvider.buildKey("tenant-verifications", tenantId, `${Date.now()}-${safeName}`);

    await storageProvider.writeFromFile(storageKey, file.path, {
      tenantId,
      resourceType: "TenantCompanyVerificationDocument",
      resourceId: tenantId,
      originalName: file.originalname,
      mimeType: file.mimetype
    });
    if (storageProvider.name === "s3") await fs.unlink(file.path).catch(() => undefined);

    const storedFile = await prisma.storedFileObject.create({
      data: {
        tenantId,
        provider: storageProvider.name,
        bucket: storageProvider.name === "s3" ? env.S3_BUCKET ?? null : null,
        storageKey,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        checksumSha256,
        resourceType: "TenantCompanyVerificationDocument",
        resourceId: tenantId,
        visibility: "private"
      }
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: actorUserId,
        action: "TENANT_COMPANY_VERIFICATION_DOCUMENT_UPLOADED",
        resource: "StoredFileObject",
        resourceId: storedFile.id,
        details: {
          fileName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          checksumSha256
        }
      }
    });

    return {
      document: {
        id: storedFile.id,
        originalName: storedFile.originalName,
        mimeType: storedFile.mimeType,
        sizeBytes: storedFile.sizeBytes,
        createdAt: storedFile.createdAt,
        visibility: storedFile.visibility
      }
    };
  }

  async removeLogo(tenantId: string, actorUserId: string) {
    const current = await prisma.tenantBranding.findUnique({ where: { tenantId } });
    if (!current) return this.getProfile(tenantId);
    if (current.logoFilePath) {
      await storageProvider.delete(current.logoFilePath);
    }
    const branding = await prisma.tenantBranding.update({
      where: { tenantId },
      data: { logoFilePath: null, logoFileName: null, logoMimeType: null }
    });
    await prisma.tenantProfile.updateMany({ where: { tenantId }, data: { profileCompletedAt: null } });
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: actorUserId,
        action: "TENANT_BRANDING_LOGO_REMOVED",
        resource: "TenantBranding",
        resourceId: branding.id,
        details: {}
      }
    });
    return this.getProfile(tenantId);
  }

  async contractBranding(tenantId: string) {
    const { profile, branding, legalSettings } = await this.getProfile(tenantId);
    return {
      companyName: profile?.tradeName ?? profile?.legalName ?? undefined,
      companyAddress: [profile?.legalAddress, profile?.postalCode, profile?.city, profile?.province, profile?.country].filter(Boolean).join(", "),
      companyVat: [profile?.vatNumber ? `P.IVA ${profile.vatNumber}` : null, profile?.taxCode ? `CF ${profile.taxCode}` : null]
        .filter(Boolean)
        .join(" · "),
      companyEmail: profile?.email ?? profile?.pec ?? undefined,
      companyPhone: profile?.phone ?? undefined,
      logoFilePath: branding?.logoFilePath ?? undefined,
      logoFileName: branding?.logoFileName ?? undefined,
      brandPrimary: branding?.primaryColor ?? undefined,
      brandAccent: branding?.accentColor ?? undefined,
      brandFont: branding?.fontFamily ?? undefined,
      contractFooterText: legalSettings?.contractFooterText ?? undefined,
      defaultContractTerms: legalSettings?.defaultContractTerms ?? undefined
    };
  }
}
