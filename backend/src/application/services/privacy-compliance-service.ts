import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { PrismaAuditLogRepository } from "../../infrastructure/repositories/prisma-audit-log-repository.js";
import { metrics } from "../../infrastructure/observability/metrics.js";
import { storageProvider } from "../../infrastructure/storage/storage-provider.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  RENTAL_CUSTOMER_DATA_EXPORT_SCHEMA_VERSION,
  RENTAL_CUSTOMER_EXPORT_RELATION_INVENTORY
} from "./rental-customer-data-export-inventory.js";
import { buildRentalCustomerAnonymizationData } from "./rental-customer-pii.js";

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

const exportBlockedInternalKeys = new Set([
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "secret",
  "stripecustomerid",
  "stripepaymentmethodid",
  "stripesetupintentid",
  "stripepaymentintentid",
  "stripesessionid",
  "storagekey",
  "bucket",
  "signedurl",
  "contentbase64"
]);

const scrubExportInternalValues = (value: unknown): unknown => {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(scrubExportInternalValues);
  if (typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
    const normalizedKey = key.replace(/[_-]/g, "").toLowerCase();
    return [key, exportBlockedInternalKeys.has(normalizedKey) ? "[excluded]" : scrubExportInternalValues(nested)];
  }));
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
          orderBy: { pickupAt: "desc" },
          select: {
            id: true,
            code: true,
            status: true,
            contractStatus: true,
            cargosStatus: true,
            customerName: true,
            customerEmail: true,
            customerPhone: true,
            customerDocument: true,
            pickupAt: true,
            returnAt: true,
            pickupLocation: true,
            returnLocation: true,
            pickupKm: true,
            returnKm: true,
            expectedTotal: true,
            finalTotal: true,
            reason: true,
            internalNotes: true,
            contractSignedAt: true,
            cargosSentAt: true,
            cargosOutcomeMessage: true,
            cargosTransmissionId: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
            vehicle: { select: { id: true, plate: true, brand: true, model: true } },
            notes: {
              select: { id: true, type: true, message: true, createdAt: true },
              orderBy: { createdAt: "asc" }
            },
            attachments: {
              select: {
                id: true,
                fileName: true,
                mimeType: true,
                sizeBytes: true,
                category: true,
                createdAt: true
              },
              orderBy: { createdAt: "asc" }
            },
            pricingSnapshot: {
              select: {
                id: true,
                priceListName: true,
                pricePackageName: true,
                extraKmPolicyName: true,
                baseRateUnit: true,
                baseRateAmount: true,
                vatRate: true,
                discountPercent: true,
                hourOverflowRule: true,
                estimatedKm: true,
                actualKm: true,
                includedKmTotal: true,
                extraKmEstimated: true,
                extraKmActual: true,
                extraKmEstimatedCost: true,
                extraKmActualCost: true,
                daysCharged: true,
                expectedSubtotal: true,
                expectedTaxAmount: true,
                expectedTotal: true,
                finalSubtotal: true,
                finalTaxAmount: true,
                finalTotal: true,
                notes: true,
                metadata: true,
                createdAt: true,
                updatedAt: true,
                deletedAt: true
              }
            },
            contract: {
              select: {
                id: true,
                status: true,
                templateVersion: true,
                title: true,
                content: true,
                emailTo: true,
                emailSubject: true,
                emailBody: true,
                pdfFileName: true,
                pdfGeneratedAt: true,
                lastSentAt: true,
                signedAt: true,
                errorMessage: true,
                createdAt: true,
                updatedAt: true,
                deletedAt: true,
                events: {
                  select: { id: true, type: true, message: true, details: true, createdAt: true },
                  orderBy: { createdAt: "asc" }
                },
                deliveries: {
                  select: {
                    id: true,
                    channel: true,
                    recipient: true,
                    subject: true,
                    body: true,
                    status: true,
                    sentAt: true,
                    details: true,
                    errorMessage: true,
                    createdAt: true
                  },
                  orderBy: { createdAt: "asc" }
                }
              }
            }
          }
        },
        paymentProfiles: {
          select: { id: true, status: true, createdAt: true, updatedAt: true, deletedAt: true },
          orderBy: { createdAt: "asc" }
        },
        paymentMethods: {
          select: {
            id: true,
            bookingId: true,
            cardBrand: true,
            cardLast4: true,
            cardExpMonth: true,
            cardExpYear: true,
            cardholderName: true,
            status: true,
            mandateAccepted: true,
            mandateAcceptedAt: true,
            mandateIp: true,
            mandateUserAgent: true,
            termsVersion: true,
            isDefault: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true
          },
          orderBy: { createdAt: "asc" }
        },
        rentalDeposits: {
          select: {
            id: true,
            bookingId: true,
            vehicleId: true,
            paymentMethodId: true,
            amountCents: true,
            capturedAmountCents: true,
            currency: true,
            status: true,
            failureReason: true,
            authorizedAt: true,
            capturedAt: true,
            releasedAt: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true
          },
          orderBy: { createdAt: "asc" }
        },
        rentalExtraCharges: {
          select: {
            id: true,
            bookingId: true,
            vehicleId: true,
            paymentMethodId: true,
            type: true,
            description: true,
            amountCents: true,
            adminFeeCents: true,
            totalAmountCents: true,
            currency: true,
            status: true,
            evidenceFileUrl: true,
            notifiedAt: true,
            chargedAt: true,
            failureReason: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true
          },
          orderBy: { createdAt: "asc" }
        },
        rentalPaymentEvents: {
          select: {
            id: true,
            provider: true,
            eventId: true,
            type: true,
            paymentProfileId: true,
            paymentMethodId: true,
            depositId: true,
            extraChargeId: true,
            bookingId: true,
            processedAt: true,
            status: true,
            errorMessage: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!customer) throw new AppError("Cliente non trovato", 404, "CUSTOMER_NOT_FOUND");

    const {
      attachments,
      bookings,
      paymentProfiles,
      paymentMethods,
      rentalDeposits,
      rentalExtraCharges,
      rentalPaymentEvents,
      ...profile
    } = customer;
    const bookingIds = bookings.map((booking) => booking.id);
    const contractIds = bookings.flatMap((booking) => booking.contract ? [booking.contract.id] : []);
    const attachmentIds = attachments.map((attachment) => attachment.id);
    const relatedResourceIds = Array.from(new Set([
      input.customerId,
      ...bookingIds,
      ...contractIds,
      ...attachmentIds,
      ...rentalDeposits.map((deposit) => deposit.id),
      ...rentalExtraCharges.map((charge) => charge.id)
    ]));
    const contractDeliveries = bookings.flatMap((booking) => booking.contract?.deliveries ?? []);
    const communicationRecipients = Array.from(new Set([
      profile.email,
      ...bookings.map((booking) => booking.customerEmail),
      ...contractDeliveries.map((delivery) => delivery.recipient)
    ].filter((value): value is string => Boolean(value))));
    const emailFilter = communicationRecipients.length
      ? { tenantId: input.tenantId, recipient: { in: communicationRecipients } }
      : null;

    const [consents, emailQueue, auditTrail, storedFiles] = await Promise.all([
      prisma.consentLog.findMany({
        where: {
          tenantId: input.tenantId,
          OR: [
            { customerId: input.customerId },
            { subjectType: "rental_customer", subjectId: input.customerId }
          ]
        },
        select: {
          id: true,
          subjectType: true,
          subjectId: true,
          consentType: true,
          granted: true,
          channel: true,
          source: true,
          ipAddress: true,
          userAgent: true,
          documentCode: true,
          documentVersion: true,
          metadata: true,
          createdAt: true
        },
        orderBy: { createdAt: "asc" }
      }),
      emailFilter
        ? prisma.emailQueue.findMany({
            where: emailFilter,
            select: {
              id: true,
              type: true,
              recipient: true,
              subject: true,
              body: true,
              status: true,
              attempts: true,
              maxAttempts: true,
              nextAttemptAt: true,
              lastError: true,
              createdAt: true,
              updatedAt: true
            },
            orderBy: { createdAt: "asc" }
          })
        : Promise.resolve([]),
      prisma.auditLog.findMany({
        where: { tenantId: input.tenantId, resourceId: { in: relatedResourceIds } },
        select: { id: true, action: true, resource: true, resourceId: true, details: true, createdAt: true },
        orderBy: { createdAt: "asc" }
      }),
      prisma.storedFileObject.findMany({
        where: { tenantId: input.tenantId, resourceId: { in: relatedResourceIds } },
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          checksumSha256: true,
          resourceType: true,
          resourceId: true,
          visibility: true,
          createdAt: true,
          deletedAt: true
        },
        orderBy: { createdAt: "asc" }
      })
    ]);
    const exportedConsents = consents.map((consent) => ({
      ...consent,
      metadata: scrubExportInternalValues(consent.metadata)
    }));
    const exportedAuditTrail = auditTrail.map((event) => ({
      ...event,
      details: scrubExportInternalValues(event.details)
    }));

    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "DATA_SUBJECT_EXPORT",
      resource: "RentalCustomer",
      resourceId: input.customerId,
      details: {
        schemaVersion: RENTAL_CUSTOMER_DATA_EXPORT_SCHEMA_VERSION,
        bookings: bookings.length,
        attachments: attachments.length,
        paymentRecords:
          paymentProfiles.length + paymentMethods.length + rentalDeposits.length +
          rentalExtraCharges.length + rentalPaymentEvents.length,
        consents: exportedConsents.length,
        communications: contractDeliveries.length + emailQueue.length,
        auditEvents: exportedAuditTrail.length,
        storedFiles: storedFiles.length
      }
    });

    return {
      schemaVersion: RENTAL_CUSTOMER_DATA_EXPORT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      scope: "rental_customer",
      subject: { type: "rental_customer", id: input.customerId },
      data: {
        profile,
        attachments,
        bookings,
        payments: {
          profiles: paymentProfiles,
          methods: paymentMethods,
          deposits: rentalDeposits,
          extraCharges: rentalExtraCharges,
          events: rentalPaymentEvents
        },
        consents: exportedConsents,
        communications: { contractDeliveries, emailQueue },
        auditTrail: exportedAuditTrail,
        storedFiles
      },
      inventory: RENTAL_CUSTOMER_EXPORT_RELATION_INVENTORY,
      securityExclusions: {
        rawProviderPayloads: "Excluded to prevent disclosure of provider secrets and unrelated payload data.",
        reusableProviderIdentifiers: "Stripe customer, payment method, setup intent and payment intent identifiers are excluded.",
        storageLocations: "Provider buckets, storage keys and newly generated signed URLs are excluded; file metadata remains included.",
        embeddedAttachments: "Binary and Base64 attachments are not embedded in this JSON export."
      }
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
        data: buildRentalCustomerAnonymizationData({ label, deletedAt: now })
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

    metrics.observeRetentionRun({
      status: "success",
      tenants: 1,
      deletedStoredFileObjects: result.deletedStoredFileObjects
    });

    return {
      executed: true,
      generatedAt: new Date().toISOString(),
      deleted: result
    };
  }
}
