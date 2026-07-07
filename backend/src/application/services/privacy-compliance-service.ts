import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { PrismaAuditLogRepository } from "../../infrastructure/repositories/prisma-audit-log-repository.js";
import { storageProvider } from "../../infrastructure/storage/storage-provider.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

const retentionDefaults = {
  expiredTokenRetentionDays: 30,
  expiredSessionRetentionDays: 90,
  deletedCustomerAttachmentGraceDays: 30,
  deletedStoredFileObjectGraceDays: env.PRIVACY_RETENTION_DELETED_FILE_GRACE_DAYS
};

const subDays = (date: Date, days: number) => new Date(date.getTime() - days * 86400000);

const unlinkStoredFile = async (filePath: string) => {
  await storageProvider.delete(filePath);
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
  private readonly currentStorageBucket = storageProvider.name === "s3" ? env.S3_BUCKET ?? "s3" : "local";

  private deletedStoredFileWhere(tenantId: string, cutoff: Date): Prisma.StoredFileObjectWhereInput {
    const bucketFilter =
      storageProvider.name === "local"
        ? { OR: [{ bucket: this.currentStorageBucket }, { bucket: null }] }
        : { bucket: this.currentStorageBucket };

    return {
      tenantId,
      provider: storageProvider.name,
      deletedAt: { lt: cutoff },
      ...bucketFilter
    };
  }

  async createErasureRequest(input: {
    tenantId: string;
    userId?: string | null;
    customerId: string;
    legalBasis: string;
    deleteAttachments?: boolean;
  }) {
    const requestedAt = new Date();

    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "DATA_SUBJECT_ERASURE_REQUESTED",
      resource: "RentalCustomer",
      resourceId: input.customerId,
      details: {
        legalBasis: input.legalBasis.slice(0, 300),
        deleteAttachments: input.deleteAttachments !== false,
        requestedAt: requestedAt.toISOString()
      }
    });

    const result = await this.anonymizeCustomer({
      tenantId: input.tenantId,
      userId: input.userId,
      customerId: input.customerId,
      confirmation: "ANONYMIZE_CUSTOMER",
      legalBasis: input.legalBasis,
      deleteAttachments: input.deleteAttachments
    });

    return {
      requestLogged: true,
      requestedAt: requestedAt.toISOString(),
      ...result
    };
  }

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
    deletedStoredFileObjectGraceDays?: number;
  }) {
    const now = new Date();
    const tokenCutoff = subDays(now, input.expiredTokenRetentionDays ?? retentionDefaults.expiredTokenRetentionDays);
    const sessionCutoff = subDays(now, input.expiredSessionRetentionDays ?? retentionDefaults.expiredSessionRetentionDays);
    const deletedCustomerCutoff = subDays(now, input.deletedCustomerAttachmentGraceDays ?? retentionDefaults.deletedCustomerAttachmentGraceDays);
    const deletedStoredFileCutoff = subDays(now, input.deletedStoredFileObjectGraceDays ?? retentionDefaults.deletedStoredFileObjectGraceDays);

    const [passwordResetTokens, invitationTokens, refreshSessions, deletedCustomerAttachments, deletedStoredFileObjects] = await Promise.all([
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
      }),
      prisma.storedFileObject.count({
        where: this.deletedStoredFileWhere(input.tenantId, deletedStoredFileCutoff)
      })
    ]);

    return {
      generatedAt: now.toISOString(),
      mode: "dry_run",
      cutoffs: {
        tokenCutoff: tokenCutoff.toISOString(),
        sessionCutoff: sessionCutoff.toISOString(),
        deletedCustomerCutoff: deletedCustomerCutoff.toISOString(),
        deletedStoredFileCutoff: deletedStoredFileCutoff.toISOString()
      },
      candidates: {
        passwordResetTokens,
        invitationTokens,
        refreshSessions,
        deletedCustomerAttachments,
        deletedStoredFileObjects
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
    deletedStoredFileObjectGraceDays?: number;
  }) {
    if (input.confirmation !== "RUN_RETENTION") {
      throw new AppError("Conferma richiesta per eseguire la retention", 400, "RETENTION_CONFIRMATION_REQUIRED");
    }

    const preview = await this.previewRetention(input);
    const deletedCustomerCutoff = new Date(preview.cutoffs.deletedCustomerCutoff);
    const sessionCutoff = new Date(preview.cutoffs.sessionCutoff);
    const tokenCutoff = new Date(preview.cutoffs.tokenCutoff);
    const deletedStoredFileCutoff = new Date(preview.cutoffs.deletedStoredFileCutoff);

    const [attachments, deletedStoredFiles] = await Promise.all([
      prisma.rentalCustomerAttachment.findMany({
        where: {
          tenantId: input.tenantId,
          customer: { deletedAt: { lt: deletedCustomerCutoff } }
        },
        select: { id: true, filePath: true }
      }),
      prisma.storedFileObject.findMany({
        where: this.deletedStoredFileWhere(input.tenantId, deletedStoredFileCutoff),
        select: { id: true, storageKey: true }
      })
    ]);

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
      const deletedStoredFileObjects = deletedStoredFiles.length
        ? await tx.storedFileObject.deleteMany({
            where: {
              tenantId: input.tenantId,
              id: { in: deletedStoredFiles.map((file) => file.id) }
            }
          })
        : { count: 0 };

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
              deletedCustomerAttachments: deletedCustomerAttachments.count,
              deletedStoredFileObjects: deletedStoredFileObjects.count
            },
            storageProvider: storageProvider.name,
            storageBucket: this.currentStorageBucket,
            executedAt: new Date().toISOString()
          } as Prisma.InputJsonValue
        }
      });

      return {
        passwordResetTokens: passwordResetTokens.count,
        invitationTokens: invitationTokens.count,
        refreshSessions: refreshSessions.count,
        deletedCustomerAttachments: deletedCustomerAttachments.count,
        deletedStoredFileObjects: deletedStoredFileObjects.count
      };
    });

    for (const attachment of attachments) {
      await unlinkStoredFile(attachment.filePath);
    }
    for (const file of deletedStoredFiles) {
      await unlinkStoredFile(file.storageKey);
    }

    return {
      executed: true,
      generatedAt: new Date().toISOString(),
      deleted: result
    };
  }
}
