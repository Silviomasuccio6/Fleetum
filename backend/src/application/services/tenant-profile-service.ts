import { prisma } from "../../infrastructure/database/prisma/client.js";
import {
  deleteRetiredPhysicalObject,
  persistNewUploadedFiles
} from "../../infrastructure/storage/upload-persistence.js";
import { storageProvider } from "../../infrastructure/storage/storage-provider.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  normalizeItalianVatNumber,
  normalizePostalCodeForCountry,
  normalizeSdiCode,
  normalizeTaxCode,
  validateCompanyRegistrationDraft
} from "../../shared/validation/company-registration.js";
import type { SignupCompanyInput, TenantCompanyProfileInput } from "../../interfaces/http/validators/tenant-profile-validators.js";

const normalizeText = (value?: string | null) => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeCountry = (value?: string | null) => (normalizeText(value) ?? "IT").toUpperCase();
const normalizeVat = (value?: string | null, country?: string | null) => {
  const normalizedCountry = normalizeCountry(country);
  if (normalizedCountry === "IT") return normalizeItalianVatNumber(value) || null;
  return normalizeText(value)?.replace(/\s+/g, "").toUpperCase() ?? null;
};

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
  private storageBucket() {
    return storageProvider.name === "s3" ? env.S3_BUCKET ?? "s3" : "local";
  }

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
      vatNumber: normalizeVat(input.vatNumber, country),
      taxCode: normalizeTaxCode(input.taxCode) || null,
      pec: normalizeText(input.pec)?.toLowerCase() ?? null,
      sdiCode: normalizeSdiCode(input.sdiCode) || null,
      rea: normalizeText(input.rea),
      legalAddress: normalizeText(input.legalAddress),
      city: normalizeText(input.city),
      province: normalizeText(input.province)?.toUpperCase() ?? null,
      postalCode: normalizePostalCodeForCountry(input.postalCode, country) || null,
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

  async ensureDefaultsForTenant(input: {
    tenantId: string;
    company?: Partial<SignupCompanyInput> | null;
  }) {
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

    await this.ensureDefaultsForTenant({ tenantId: input.tenantId, company: input.company });

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
    await this.ensureDefaultsForTenant({ tenantId });
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

      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          name: profilePayload.tradeName ?? profilePayload.legalName,
          vatNumber: profilePayload.vatNumber
        }
      });

      const existingSite = await tx.site.findFirst({
        where: { tenantId, deletedAt: null },
        select: { id: true }
      });
      if (!existingSite && profilePayload.legalAddress && profilePayload.city) {
        await tx.site.create({
          data: {
            tenantId,
            name: profilePayload.tradeName ?? profilePayload.legalName,
            address: profilePayload.legalAddress,
            city: profilePayload.city,
            email: profilePayload.email,
            phone: profilePayload.phone
          }
        });
      }

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
    const persisted = await persistNewUploadedFiles({
      tenantId,
      category: "branding",
      resourceType: "TenantBranding",
      resourceId: tenantId,
      files: [file],
      commit: async (tx, [upload]) => {
        const current = await tx.tenantBranding.findUnique({ where: { tenantId } });
        const branding = await tx.tenantBranding.upsert({
          where: { tenantId },
          create: {
            tenantId,
            logoFilePath: upload.key,
            logoFileName: file.originalname,
            logoMimeType: file.mimetype,
            primaryColor: "#21375d",
            accentColor: "#5d82c2",
            fontFamily: "helvetica"
          },
          update: {
            logoFilePath: upload.key,
            logoFileName: file.originalname,
            logoMimeType: file.mimetype
          }
        });

        if (current?.logoFilePath && current.logoFilePath !== upload.key) {
          await tx.storedFileObject.updateMany({
            where: {
              tenantId,
              provider: storageProvider.name,
              ...(storageProvider.name === "local"
                ? { OR: [{ bucket: this.storageBucket() }, { bucket: null }] }
                : { bucket: this.storageBucket() }),
              storageKey: current.logoFilePath,
              deletedAt: null
            },
            data: { deletedAt: new Date() }
          });
        }

        await tx.auditLog.create({
          data: {
            tenantId,
            userId: actorUserId,
            action: "TENANT_BRANDING_LOGO_UPDATED",
            resource: "TenantBranding",
            resourceId: branding.id,
            details: { fileName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size }
          }
        });

        const nextProfile = await tx.tenantProfile.findUnique({ where: { tenantId } });
        if (nextProfile) {
          const completeness = this.profileCompleteness(nextProfile as unknown as Record<string, unknown>, branding);
          await tx.tenantProfile.update({
            where: { tenantId },
            data: { profileCompletedAt: completeness.completed ? new Date() : null }
          });
        }
        return {
          branding,
          retiredKey: current?.logoFilePath && current.logoFilePath !== upload.key
            ? current.logoFilePath
            : null
        };
      }
    });

    if (persisted.result.retiredKey) {
      await deleteRetiredPhysicalObject({
        key: persisted.result.retiredKey,
        resourceType: "TenantBranding"
      });
    }

    return this.getProfile(tenantId);
  }

  async setCompanyVerificationDocument(tenantId: string, actorUserId: string, file: Express.Multer.File) {
    const persisted = await persistNewUploadedFiles({
      tenantId,
      category: "company-verification-documents",
      resourceType: "TenantCompanyVerificationDocument",
      resourceId: tenantId,
      files: [file],
      commit: async (tx, [upload]) => {
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: actorUserId,
            action: "TENANT_COMPANY_VERIFICATION_DOCUMENT_UPLOADED",
            resource: "StoredFileObject",
            resourceId: upload.storedFileObject.id,
            details: {
              fileName: file.originalname,
              mimeType: file.mimetype,
              sizeBytes: file.size,
              checksumSha256: upload.checksumSha256
            }
          }
        });
        return upload.storedFileObject;
      }
    });
    const storedFile = persisted.result;

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
    const retiredKey = await prisma.$transaction(async (tx) => {
      const current = await tx.tenantBranding.findUnique({ where: { tenantId } });
      if (!current) return null;
      const branding = await tx.tenantBranding.update({
        where: { tenantId },
        data: { logoFilePath: null, logoFileName: null, logoMimeType: null }
      });
      if (current.logoFilePath) {
        await tx.storedFileObject.updateMany({
          where: {
            tenantId,
            provider: storageProvider.name,
            ...(storageProvider.name === "local"
              ? { OR: [{ bucket: this.storageBucket() }, { bucket: null }] }
              : { bucket: this.storageBucket() }),
            storageKey: current.logoFilePath,
            deletedAt: null
          },
          data: { deletedAt: new Date() }
        });
      }
      await tx.tenantProfile.updateMany({ where: { tenantId }, data: { profileCompletedAt: null } });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: actorUserId,
          action: "TENANT_BRANDING_LOGO_REMOVED",
          resource: "TenantBranding",
          resourceId: branding.id,
          details: {}
        }
      });
      return current.logoFilePath;
    }, { isolationLevel: "Serializable" });
    if (retiredKey) {
      await deleteRetiredPhysicalObject({ key: retiredKey, resourceType: "TenantBranding" });
    }
    return this.getProfile(tenantId);
  }

  async contractBranding(tenantId: string, options: { ensureDefaults?: boolean } = {}) {
    const current = options.ensureDefaults === false
      ? await (async () => {
          const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: {
              tenantProfile: true,
              tenantBranding: true,
              tenantLegalSettings: true
            }
          });
          if (!tenant) throw new AppError("Tenant non trovato", 404, "TENANT_NOT_FOUND");
          return {
            profile: tenant.tenantProfile,
            branding: tenant.tenantBranding,
            legalSettings: tenant.tenantLegalSettings
          };
        })()
      : await this.getProfile(tenantId);
    const { profile, branding, legalSettings } = current;

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
