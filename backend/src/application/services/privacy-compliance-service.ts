import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { PrismaAuditLogRepository } from "../../infrastructure/repositories/prisma-audit-log-repository.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

const uploadRootDir = path.resolve(process.cwd(), env.UPLOAD_DIR);

const retentionDefaults = {
  expiredTokenRetentionDays: 30,
  expiredSessionRetentionDays: 90,
  deletedCustomerAttachmentGraceDays: 30
};

const subDays = (date: Date, days: number) => new Date(date.getTime() - days * 86400000);

const resolveStoredFile = (filePath: string) => {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (fullPath !== uploadRootDir && !fullPath.startsWith(`${uploadRootDir}${path.sep}`)) {
    throw new AppError("Percorso file non valido", 400, "INVALID_FILE_PATH");
  }
  return fullPath;
};

const unlinkStoredFile = async (filePath: string) => {
  const fullPath = resolveStoredFile(filePath);
  await fs.unlink(fullPath).catch(() => undefined);
};

const anonymizedLabel = (id: string) => `Cliente anonimizzato ${crypto.createHash("sha256").update(id).digest("hex").slice(0, 8)}`;

const scrubJson = (value: unknown): unknown => {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(scrubJson);
  if (typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const blocked = new Set([
    "email",
    "phone",
    "customerEmail",
    "customerPhone",
    "documentNumber",
    "drivingLicenseNumber",
    "taxCode",
    "companyVatNumber",
    "signatureDataUrl",
    "signatureFilePath",
    "recipient"
  ]);
  return Object.fromEntries(
    Object.entries(source).map(([key, nested]) => [key, blocked.has(key) ? "[redacted]" : scrubJson(nested)])
  );
};

export class PrivacyComplianceService {
  private readonly auditRepository = new PrismaAuditLogRepository();

  async exportCustomerData(input: { tenantId: string; userId?: string | null; customerId: string }) {
    const customer = await prisma.rentalCustomer.findFirst({
      where: { tenantId: input.tenantId, id: input.customerId, deletedAt: null },
      include: {
        attachments: {
          select: {
            id: true,
            bookingId: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            category: true,
            createdAt: true
          },
          orderBy: { createdAt: "desc" }
        },
        bookings: {
          where: { deletedAt: null },
          orderBy: { pickupAt: "desc" },
          select: {
            id: true,
            code: true,
            status: true,
            contractStatus: true,
            cargosStatus: true,
            pickupAt: true,
            returnAt: true,
            pickupKm: true,
            returnKm: true,
            expectedTotal: true,
            finalTotal: true,
            vehicle: { select: { plate: true, brand: true, model: true } },
            contract: {
              select: {
                id: true,
                status: true,
                templateVersion: true,
                pdfGeneratedAt: true,
                lastSentAt: true,
                signedAt: true,
                deliveries: {
                  select: {
                    id: true,
                    channel: true,
                    status: true,
                    sentAt: true,
                    createdAt: true
                  },
                  orderBy: { createdAt: "desc" }
                }
              }
            }
          }
        }
      }
    });

    if (!customer) throw new AppError("Cliente non trovato", 404, "CUSTOMER_NOT_FOUND");

    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "DATA_SUBJECT_EXPORT",
      resource: "RentalCustomer",
      resourceId: input.customerId,
      details: {
        bookings: customer.bookings.length,
        attachments: customer.attachments.length
      }
    });

    return {
      generatedAt: new Date().toISOString(),
      scope: "rental_customer",
      customer
    };
  }

  async anonymizeCustomer(input: {
    tenantId: string;
    userId?: string | null;
    customerId: string;
    confirmation: string;
    legalBasis: string;
    deleteAttachments?: boolean;
  }) {
    if (input.confirmation !== "ANONYMIZE_CUSTOMER") {
      throw new AppError("Conferma richiesta per anonimizzare il cliente", 400, "PRIVACY_CONFIRMATION_REQUIRED");
    }
    if (!input.legalBasis.trim()) {
      throw new AppError("Base decisionale/privacy richiesta", 422, "PRIVACY_LEGAL_BASIS_REQUIRED");
    }

    const customer = await prisma.rentalCustomer.findFirst({
      where: { tenantId: input.tenantId, id: input.customerId },
      select: { id: true, deletedAt: true }
    });
    if (!customer) throw new AppError("Cliente non trovato", 404, "CUSTOMER_NOT_FOUND");

    const label = anonymizedLabel(input.customerId);
    const now = new Date();

    const attachments = input.deleteAttachments !== false
      ? await prisma.rentalCustomerAttachment.findMany({
          where: { tenantId: input.tenantId, customerId: input.customerId },
          select: { id: true, filePath: true }
        })
      : [];

    const result = await prisma.$transaction(async (tx) => {
      const bookingUpdate = await tx.rentalBooking.updateMany({
        where: { tenantId: input.tenantId, customerId: input.customerId },
        data: {
          customerName: label,
          customerEmail: null,
          customerPhone: null,
          customerDocument: null
        }
      });

      const contractUpdate = await tx.bookingContract.updateMany({
        where: { tenantId: input.tenantId, booking: { customerId: input.customerId } },
        data: {
          emailTo: null,
          emailBody: null,
          errorMessage: null
        }
      });

      const attachmentDelete = input.deleteAttachments !== false
        ? await tx.rentalCustomerAttachment.deleteMany({
            where: { tenantId: input.tenantId, customerId: input.customerId }
          })
        : { count: 0 };

      await tx.rentalCustomer.update({
        where: { id: input.customerId },
        data: {
          firstName: "Cliente",
          lastName: label.replace("Cliente ", ""),
          drivingLicenseNumber: "",
          drivingLicenseIssuedAt: null,
          drivingLicenseExpiresAt: null,
          drivingLicenseAuthority: null,
          drivingLicenseCategory: null,
          email: null,
          phone: null,
          dateOfBirth: null,
          placeOfBirth: null,
          nationality: null,
          residenceAddress: null,
          taxCode: null,
          documentType: null,
          documentNumber: null,
          documentIssuedAt: null,
          documentExpiresAt: null,
          documentAuthority: null,
          companyName: null,
          companyLegalForm: null,
          companyVatNumber: null,
          companyTaxCode: null,
          companyLegalAddress: null,
          companyPec: null,
          companySdi: null,
          companyRea: null,
          legalRepFirstName: null,
          legalRepLastName: null,
          legalRepTaxCode: null,
          legalRepRole: null,
          legalRepEmail: null,
          legalRepPhone: null,
          notes: null,
          deletedAt: now
        }
      });

      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          action: "DATA_SUBJECT_ANONYMIZED",
          resource: "RentalCustomer",
          resourceId: input.customerId,
          details: {
            legalBasis: input.legalBasis.slice(0, 300),
            bookingsUpdated: bookingUpdate.count,
            contractsUpdated: contractUpdate.count,
            attachmentsDeleted: attachmentDelete.count,
            contractRecordsPreserved: true,
            executedAt: now.toISOString()
          } as Prisma.InputJsonValue
        }
      });

      return {
        bookingsUpdated: bookingUpdate.count,
        contractsUpdated: contractUpdate.count,
        attachmentsDeleted: attachmentDelete.count
      };
    });

    for (const attachment of attachments) {
      await unlinkStoredFile(attachment.filePath);
    }

    return {
      anonymized: true,
      customerId: input.customerId,
      label,
      ...result
    };
  }

  async previewRetention(input: {
    tenantId: string;
    expiredTokenRetentionDays?: number;
    expiredSessionRetentionDays?: number;
    deletedCustomerAttachmentGraceDays?: number;
  }) {
    const now = new Date();
    const tokenCutoff = subDays(now, input.expiredTokenRetentionDays ?? retentionDefaults.expiredTokenRetentionDays);
    const sessionCutoff = subDays(now, input.expiredSessionRetentionDays ?? retentionDefaults.expiredSessionRetentionDays);
    const deletedCustomerCutoff = subDays(now, input.deletedCustomerAttachmentGraceDays ?? retentionDefaults.deletedCustomerAttachmentGraceDays);

    const [passwordResetTokens, invitationTokens, refreshSessions, deletedCustomerAttachments] = await Promise.all([
      prisma.passwordResetToken.count({
        where: { expiresAt: { lt: tokenCutoff }, user: { tenantId: input.tenantId } }
      }),
      prisma.invitationToken.count({
        where: { expiresAt: { lt: tokenCutoff }, user: { tenantId: input.tenantId } }
      }),
      prisma.refreshSession.count({
        where: {
          tenantId: input.tenantId,
          OR: [
            { expiresAt: { lt: sessionCutoff } },
            { revokedAt: { lt: sessionCutoff } }
          ]
        }
      }),
      prisma.rentalCustomerAttachment.count({
        where: {
          tenantId: input.tenantId,
          customer: { deletedAt: { lt: deletedCustomerCutoff } }
        }
      })
    ]);

    return {
      generatedAt: now.toISOString(),
      mode: "dry_run",
      cutoffs: {
        tokenCutoff: tokenCutoff.toISOString(),
        sessionCutoff: sessionCutoff.toISOString(),
        deletedCustomerCutoff: deletedCustomerCutoff.toISOString()
      },
      candidates: {
        passwordResetTokens,
        invitationTokens,
        refreshSessions,
        deletedCustomerAttachments
      }
    };
  }

  async runRetention(input: {
    tenantId: string;
    userId?: string | null;
    confirmation: string;
    expiredTokenRetentionDays?: number;
    expiredSessionRetentionDays?: number;
    deletedCustomerAttachmentGraceDays?: number;
  }) {
    if (input.confirmation !== "RUN_RETENTION") {
      throw new AppError("Conferma richiesta per eseguire la retention", 400, "RETENTION_CONFIRMATION_REQUIRED");
    }

    const preview = await this.previewRetention(input);
    const deletedCustomerCutoff = new Date(preview.cutoffs.deletedCustomerCutoff);
    const sessionCutoff = new Date(preview.cutoffs.sessionCutoff);
    const tokenCutoff = new Date(preview.cutoffs.tokenCutoff);

    const attachments = await prisma.rentalCustomerAttachment.findMany({
      where: {
        tenantId: input.tenantId,
        customer: { deletedAt: { lt: deletedCustomerCutoff } }
      },
      select: { id: true, filePath: true }
    });

    const result = await prisma.$transaction(async (tx) => {
      const passwordResetTokens = await tx.passwordResetToken.deleteMany({
        where: { expiresAt: { lt: tokenCutoff }, user: { tenantId: input.tenantId } }
      });
      const invitationTokens = await tx.invitationToken.deleteMany({
        where: { expiresAt: { lt: tokenCutoff }, user: { tenantId: input.tenantId } }
      });
      const refreshSessions = await tx.refreshSession.deleteMany({
        where: {
          tenantId: input.tenantId,
          OR: [
            { expiresAt: { lt: sessionCutoff } },
            { revokedAt: { lt: sessionCutoff } }
          ]
        }
      });
      const deletedCustomerAttachments = await tx.rentalCustomerAttachment.deleteMany({
        where: {
          tenantId: input.tenantId,
          customer: { deletedAt: { lt: deletedCustomerCutoff } }
        }
      });

      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          action: "DATA_RETENTION_EXECUTED",
          resource: "PrivacyRetention",
          resourceId: input.tenantId,
          details: {
            preview: scrubJson(preview),
            deleted: {
              passwordResetTokens: passwordResetTokens.count,
              invitationTokens: invitationTokens.count,
              refreshSessions: refreshSessions.count,
              deletedCustomerAttachments: deletedCustomerAttachments.count
            },
            executedAt: new Date().toISOString()
          } as Prisma.InputJsonValue
        }
      });

      return {
        passwordResetTokens: passwordResetTokens.count,
        invitationTokens: invitationTokens.count,
        refreshSessions: refreshSessions.count,
        deletedCustomerAttachments: deletedCustomerAttachments.count
      };
    });

    for (const attachment of attachments) {
      await unlinkStoredFile(attachment.filePath);
    }

    return {
      executed: true,
      generatedAt: new Date().toISOString(),
      deleted: result
    };
  }
}
