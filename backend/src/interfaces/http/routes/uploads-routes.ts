import { Request, Response, Router } from "express";
import type { Prisma } from "@prisma/client";
import { extractInvoiceTotalFromPdf } from "../../../application/services/invoice-pdf-parser-service.js";
import { extractRegistrationDateFromBooklet } from "../../../application/services/vehicle-booklet-parser-service.js";
import { computeVehicleRevisionDueAt } from "../../../application/services/vehicle-revision-schedule-service.js";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { lockOwnedStoppage, ownedStoppageWhere } from "../../../infrastructure/repositories/stoppage-tenant-scope.js";
import { lockOwnedVehicle, ownedVehicleWhere } from "../../../infrastructure/repositories/vehicle-tenant-scope.js";
import { logger } from "../../../infrastructure/logging/logger.js";
import { validateUploadedFile } from "../../../infrastructure/storage/file-security.js";
import {
  cleanupOnUploadFailure,
  cleanupRequestUploads,
  withRequestUploadCleanup
} from "../../../infrastructure/storage/upload-lifecycle.js";
import {
  deleteRetiredPhysicalObject,
  persistNewUploadedFiles
} from "../../../infrastructure/storage/upload-persistence.js";
import {
  upload,
  uploadMaintenanceAttachments,
  uploadRentalCustomerAttachments,
  uploadVehicleBooklet
} from "../../../infrastructure/storage/multer.js";
import { storageProvider } from "../../../infrastructure/storage/storage-provider.js";
import { PrismaAuditLogRepository } from "../../../infrastructure/repositories/prisma-audit-log-repository.js";
import { env } from "../../../shared/config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

const auditRepository = new PrismaAuditLogRepository();
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const isInvoiceAnalyzableFile = (file: Express.Multer.File) =>
  file.mimetype === "application/pdf" ||
  file.mimetype.startsWith("image/") ||
  [".pdf", ".jpg", ".jpeg", ".png", ".webp"].some((ext) => file.originalname.toLowerCase().endsWith(ext));

const sendStoredFile = async (
  res: Response,
  input: {
    filePath: string;
    mimeType: string;
  }
) => {
  if (!(await storageProvider.exists(input.filePath))) {
    throw new AppError("File non trovato", 404, "NOT_FOUND");
  }

  const payload = await storageProvider.read(input.filePath);
  res.setHeader("Cache-Control", "private, max-age=60");
  res.type(input.mimeType || "application/octet-stream");
  res.send(payload);
};

export const uploadsRoutes = () => {
  const router = Router();

  const secureFiles = async (files: Express.Multer.File[]) => {
    for (const file of files) {
      const result = await validateUploadedFile(file.path, file.mimetype);
      file.size = result.sizeBytes;
    }
  };

  const uploadedHandler = (handler: (req: Request, res: Response) => Promise<void>) =>
    asyncHandler((req, res) => withRequestUploadCleanup(req, () => handler(req, res)));

  const auditFileEvent = async (
    input: {
      tenantId: string;
      userId?: string | null;
      action: string;
      resource: string;
      resourceId?: string | null;
      details?: Record<string, unknown>;
    }
  ) => {
    await auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      details: input.details
    });
  };

  const storageBucket = () => (storageProvider.name === "s3" ? env.S3_BUCKET ?? "s3" : "local");

  const markStoredFileDeleted = async (
    tx: Prisma.TransactionClient,
    tenantId: string,
    filePath: string
  ) => tx.storedFileObject.updateMany({
    where: {
      tenantId,
      provider: storageProvider.name,
      ...(storageProvider.name === "local"
        ? { OR: [{ bucket: storageBucket() }, { bucket: null }] }
        : { bucket: storageBucket() }),
      storageKey: filePath,
      deletedAt: null
    },
    data: { deletedAt: new Date() }
  });

  const requireOwnedStoppage = asyncHandler(async (req, _res, next) => {
    const target = await prisma.stoppage.findFirst({
      where: { ...await ownedStoppageWhere(req.auth!.tenantId), id: req.params.id },
      select: { id: true }
    });
    if (!target) throw new AppError("Fermo non trovato", 404, "NOT_FOUND");
    next();
  });

  const requireOwnedVehicle = asyncHandler(async (req, _res, next) => {
    const target = await prisma.vehicle.findFirst({
      where: { ...ownedVehicleWhere(req.auth!.tenantId), id: req.params.id },
      select: { id: true }
    });
    if (!target) throw new AppError("Veicolo non trovato", 404, "NOT_FOUND");
    next();
  });

  const requireOwnedMaintenance = asyncHandler(async (req, _res, next) => {
    const target = await prisma.vehicleMaintenance.findFirst({
      where: { id: req.params.id, tenantId: req.auth!.tenantId, deletedAt: null,
        vehicle: ownedVehicleWhere(req.auth!.tenantId, true) },
      select: { id: true }
    });
    if (!target) throw new AppError("Manutenzione non trovata", 404, "NOT_FOUND");
    next();
  });

  const lockMaintenanceOwner = async (tx: Prisma.TransactionClient, tenantId: string, id: string, historical = false) => {
    const where = { id, tenantId, ...(!historical ? { deletedAt: null } : {}) };
    const initial = await tx.vehicleMaintenance.findFirst({ where, select: { vehicleId: true } });
    if (!initial) throw new AppError("Manutenzione non trovata", 404, "NOT_FOUND");
    await lockOwnedVehicle(tx, tenantId, initial.vehicleId, true);
    await tx.$queryRaw`SELECT "id" FROM "VehicleMaintenance" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    const current = await tx.vehicleMaintenance.findFirst({ where, select: { vehicleId: true } });
    if (!current || current.vehicleId !== initial.vehicleId) throw new AppError("Manutenzione non trovata", 404, "NOT_FOUND");
  };

  const requireOwnedCustomer = asyncHandler(async (req, _res, next) => {
    const target = await prisma.rentalCustomer.findFirst({
      where: { id: req.params.customerId, tenantId: req.auth!.tenantId, deletedAt: null },
      select: { id: true }
    });
    if (!target) throw new AppError("Cliente non trovato", 404, "CUSTOMER_NOT_FOUND");
    next();
  });

  router.post(
    "/stoppages/:id/photos",
    requirePermissions("stoppages:write"),
    requireOwnedStoppage,
    cleanupOnUploadFailure(upload.array("files", 8)),
    uploadedHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const files = (req.files ?? []) as Express.Multer.File[];
      await secureFiles(files);
      await persistNewUploadedFiles({
        tenantId,
        category: "stoppage-photos",
        resourceType: "StoppagePhoto",
        resourceId: req.params.id,
        files,
        commit: async (tx, uploads) => {
          await lockOwnedStoppage(tx, tenantId, req.params.id);
          return tx.stoppagePhoto.createMany({
            data: uploads.map((upload) => ({
              stoppageId: req.params.id,
              filePath: upload.key,
              fileName: upload.file.originalname || upload.file.filename,
              mimeType: upload.file.mimetype,
              sizeBytes: upload.file.size
            }))
          });
        }
      });

      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_UPLOAD",
        resource: "StoppagePhoto",
        resourceId: req.params.id,
        details: { count: files.length, category: "stoppage_photo" }
      });

      res.status(201).json({ uploaded: files.length });
    })
  );

  router.get(
    "/stoppage-photos/:photoId/file",
    requirePermissions("stoppages:read"),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const photo = await prisma.stoppagePhoto.findFirst({
        where: { id: req.params.photoId, stoppage: await ownedStoppageWhere(tenantId, prisma, true) },
        select: { filePath: true, mimeType: true }
      });
      if (!photo) throw new AppError("Foto non trovata", 404, "NOT_FOUND");
      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_DOWNLOAD",
        resource: "StoppagePhoto",
        resourceId: req.params.photoId,
        details: { category: "stoppage_photo", mimeType: photo.mimeType }
      });
      await sendStoredFile(res, photo);
    })
  );

  router.delete(
    "/stoppage-photos/:photoId",
    requirePermissions("stoppages:write"),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const photo = await prisma.stoppagePhoto.findFirst({
        where: { id: req.params.photoId, stoppage: await ownedStoppageWhere(tenantId, prisma, true) },
        select: { id: true, stoppageId: true, filePath: true }
      });
      if (!photo) throw new AppError("Foto non trovata", 404, "NOT_FOUND");

      await prisma.$transaction(async (tx) => {
        await lockOwnedStoppage(tx, tenantId, photo.stoppageId, true);
        await tx.stoppagePhoto.delete({ where: { id: photo.id } });
        await markStoredFileDeleted(tx, tenantId, photo.filePath);
      }, { isolationLevel: "Serializable" });
      await deleteRetiredPhysicalObject({ key: photo.filePath, resourceType: "StoppagePhoto" });
      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_DELETE",
        resource: "StoppagePhoto",
        resourceId: photo.id,
        details: { category: "stoppage_photo" }
      });
      res.status(204).send();
    })
  );

  router.post(
    "/vehicles/:id/photos",
    requirePermissions("vehicles:write"),
    requireOwnedVehicle,
    cleanupOnUploadFailure(upload.array("files", 8)),
    uploadedHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const files = (req.files ?? []) as Express.Multer.File[];
      await secureFiles(files);
      await persistNewUploadedFiles({
        tenantId,
        category: "vehicle-photos",
        resourceType: "VehiclePhoto",
        resourceId: req.params.id,
        files,
        commit: async (tx, uploads) => {
          await lockOwnedVehicle(tx, tenantId, req.params.id);
          return tx.vehiclePhoto.createMany({
          data: uploads.map((upload) => ({
            vehicleId: req.params.id,
            filePath: upload.key,
            fileName: upload.file.originalname || upload.file.filename,
            mimeType: upload.file.mimetype,
            sizeBytes: upload.file.size
          }))
          });
        }
      });

      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_UPLOAD",
        resource: "VehiclePhoto",
        resourceId: req.params.id,
        details: { count: files.length, category: "vehicle_photo" }
      });

      res.status(201).json({ uploaded: files.length });
    })
  );

  router.get(
    "/vehicle-photos/:photoId/file",
    requirePermissions("vehicles:read"),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const photo = await prisma.vehiclePhoto.findFirst({
        where: { id: req.params.photoId, vehicle: ownedVehicleWhere(tenantId, true) },
        select: { filePath: true, mimeType: true }
      });
      if (!photo) throw new AppError("Foto non trovata", 404, "NOT_FOUND");
      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_DOWNLOAD",
        resource: "VehiclePhoto",
        resourceId: req.params.photoId,
        details: { category: "vehicle_photo", mimeType: photo.mimeType }
      });
      await sendStoredFile(res, photo);
    })
  );

  router.delete(
    "/vehicle-photos/:photoId",
    requirePermissions("vehicles:write"),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const photo = await prisma.vehiclePhoto.findFirst({
        where: { id: req.params.photoId, vehicle: ownedVehicleWhere(tenantId, true) },
        select: { id: true, vehicleId: true, filePath: true }
      });
      if (!photo) throw new AppError("Foto non trovata", 404, "NOT_FOUND");

      await prisma.$transaction(async (tx) => {
        await lockOwnedVehicle(tx, tenantId, photo.vehicleId, true);
        await tx.vehiclePhoto.delete({ where: { id: photo.id } });
        await markStoredFileDeleted(tx, tenantId, photo.filePath);
      }, { isolationLevel: "Serializable" });
      await deleteRetiredPhysicalObject({ key: photo.filePath, resourceType: "VehiclePhoto" });
      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_DELETE",
        resource: "VehiclePhoto",
        resourceId: photo.id,
        details: { category: "vehicle_photo" }
      });
      res.status(204).send();
    })
  );

  router.post(
    "/vehicles/:id/booklet",
    requirePermissions("vehicles:write"),
    requireOwnedVehicle,
    cleanupOnUploadFailure(uploadVehicleBooklet.single("file")),
    uploadedHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const vehicle = await prisma.vehicle.findFirst({
        where: { ...ownedVehicleWhere(tenantId), id: req.params.id },
        select: { id: true, registrationDate: true, lastRevisionAt: true, revisionDueAt: true }
      });
      if (!vehicle) throw new AppError("Veicolo non trovato", 404, "NOT_FOUND");

      const file = req.file as Express.Multer.File | undefined;
      if (!file) throw new AppError("File libretto mancante", 400, "MISSING_FILE");
      await secureFiles([file]);

      const detectedRegistrationDate = await extractRegistrationDateFromBooklet(file.path, file.mimetype);
      const persisted = await persistNewUploadedFiles({
        tenantId,
        category: "vehicle-booklets",
        resourceType: "VehicleBooklet",
        resourceId: req.params.id,
        files: [file],
        commit: async (tx, [upload]) => {
          const currentVehicle = await lockOwnedVehicle(tx, tenantId, req.params.id);
          const revisionDueAt = computeVehicleRevisionDueAt({
            registrationDate: detectedRegistrationDate ?? currentVehicle.registrationDate,
            lastRevisionAt: currentVehicle.lastRevisionAt, manualRevisionDueAt: currentVehicle.revisionDueAt
          });
          const existing = await tx.vehicleBooklet.findUnique({ where: { vehicleId: req.params.id }, select: { tenantId: true } });
          if (existing && existing.tenantId !== tenantId) throw new AppError("Libretto non trovato", 404, "NOT_FOUND");
          const existingBooklet = await tx.vehicleBooklet.findFirst({
            where: { tenantId, vehicleId: req.params.id },
            select: { id: true, filePath: true }
          });
          const select = {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            extractedRegistrationDate: true
          } as const;
          const booklet = existingBooklet
            ? await tx.vehicleBooklet.update({
                where: { id: existingBooklet.id },
                data: {
                  filePath: upload.key,
                  fileName: file.originalname || file.filename,
                  mimeType: file.mimetype,
                  sizeBytes: file.size,
                  extractedRegistrationDate: detectedRegistrationDate
                },
                select
              })
            : await tx.vehicleBooklet.create({
                data: {
                  tenantId,
                  vehicleId: req.params.id,
                  filePath: upload.key,
                  fileName: file.originalname || file.filename,
                  mimeType: file.mimetype,
                  sizeBytes: file.size,
                  extractedRegistrationDate: detectedRegistrationDate
                },
                select
              });

          if (detectedRegistrationDate) {
            await tx.vehicle.updateMany({
              where: { id: req.params.id, tenantId, deletedAt: null },
              data: {
                registrationDate: detectedRegistrationDate,
                revisionDueAt
              }
            });
          }
          if (existingBooklet?.filePath && existingBooklet.filePath !== upload.key) {
            await markStoredFileDeleted(tx, tenantId, existingBooklet.filePath);
          }
          return {
            booklet,
            revisionDueAt,
            retiredKey: existingBooklet?.filePath && existingBooklet.filePath !== upload.key
              ? existingBooklet.filePath
              : null
          };
        }
      });
      const { booklet, retiredKey, revisionDueAt } = persisted.result;
      if (retiredKey) {
        await deleteRetiredPhysicalObject({ key: retiredKey, resourceType: "VehicleBooklet" });
      }

      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_UPLOAD",
        resource: "VehicleBooklet",
        resourceId: booklet.id,
        details: {
          category: "vehicle_booklet",
          vehicleId: req.params.id,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          detectedRegistrationDate: detectedRegistrationDate ? detectedRegistrationDate.toISOString() : null
        }
      });

      res.status(201).json({
        booklet,
        detectedRegistrationDate: detectedRegistrationDate ? detectedRegistrationDate.toISOString() : null,
        revisionDueAt: revisionDueAt ? revisionDueAt.toISOString() : null
      });
    })
  );

  router.get(
    "/vehicle-booklets/:bookletId/file",
    requirePermissions("vehicles:read"),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const booklet = await prisma.vehicleBooklet.findFirst({
        where: { id: req.params.bookletId, tenantId, vehicle: ownedVehicleWhere(tenantId, true) },
        select: { filePath: true, mimeType: true }
      });
      if (!booklet) throw new AppError("Libretto non trovato", 404, "NOT_FOUND");
      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_DOWNLOAD",
        resource: "VehicleBooklet",
        resourceId: req.params.bookletId,
        details: { category: "vehicle_booklet", mimeType: booklet.mimeType }
      });
      await sendStoredFile(res, booklet);
    })
  );

  router.delete(
    "/vehicle-booklets/:bookletId",
    requirePermissions("vehicles:write"),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const booklet = await prisma.vehicleBooklet.findFirst({
        where: { id: req.params.bookletId, tenantId, vehicle: ownedVehicleWhere(tenantId, true) },
        select: { id: true, vehicleId: true, filePath: true }
      });
      if (!booklet) throw new AppError("Libretto non trovato", 404, "NOT_FOUND");
      await prisma.$transaction(async (tx) => {
        await lockOwnedVehicle(tx, tenantId, booklet.vehicleId, true);
        await tx.vehicleBooklet.delete({ where: { id: booklet.id } });
        await markStoredFileDeleted(tx, tenantId, booklet.filePath);
      }, { isolationLevel: "Serializable" });
      await deleteRetiredPhysicalObject({ key: booklet.filePath, resourceType: "VehicleBooklet" });
      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_DELETE",
        resource: "VehicleBooklet",
        resourceId: booklet.id,
        details: { category: "vehicle_booklet" }
      });
      res.status(204).send();
    })
  );

  router.post(
    "/vehicle-maintenances/:id/attachments",
    requirePermissions("vehicles:write"),
    requireOwnedMaintenance,
    cleanupOnUploadFailure(uploadMaintenanceAttachments.array("files", 10)),
    asyncHandler(async (req, res) => {
      let backgroundOwnsStaging = false;
      try {
        const tenantId = req.auth!.tenantId;
        const maintenanceId = req.params.id;
        const files = (req.files ?? []) as Express.Multer.File[];
        await secureFiles(files);
        const invoiceAnalyzableFiles = files.filter((file) => isInvoiceAnalyzableFile(file)).length;

        const persisted = await persistNewUploadedFiles({
          tenantId,
          category: "maintenance-attachments",
          resourceType: "VehicleMaintenanceAttachment",
          resourceId: maintenanceId,
          files,
          commit: async (tx, uploads) => {
            await lockMaintenanceOwner(tx, tenantId, maintenanceId);
            const createdAttachments: Array<{ id: string; file: Express.Multer.File }> = [];
            for (const upload of uploads) {
              const created = await tx.vehicleMaintenanceAttachment.create({
                data: {
                  tenantId,
                  maintenanceId,
                  filePath: upload.key,
                  fileName: upload.file.originalname || upload.file.filename,
                  mimeType: upload.file.mimetype,
                  sizeBytes: upload.file.size,
                  invoiceTotalAmount: null
                },
                select: { id: true }
              });
              createdAttachments.push({ id: created.id, file: upload.file });
            }
            return createdAttachments;
          }
        });
        const createdAttachments = persisted.result;

        await auditFileEvent({
          tenantId,
          userId: req.auth?.userId,
          action: "DOCUMENT_UPLOAD",
          resource: "VehicleMaintenanceAttachment",
          resourceId: maintenanceId,
          details: { count: files.length, category: "maintenance_attachment", invoiceAnalyzableFiles }
        });

        backgroundOwnsStaging = true;
        void (async () => {
          try {
            const extractedTotals: number[] = [];

            for (const entry of createdAttachments) {
              if (!isInvoiceAnalyzableFile(entry.file)) continue;
              const total = await extractInvoiceTotalFromPdf(entry.file.path, entry.file.mimetype);
              if (typeof total === "number" && Number.isFinite(total) && total > 0) {
                const rounded = roundMoney(total);
                extractedTotals.push(rounded);
                await prisma.$transaction(async (tx) => {
                  await lockMaintenanceOwner(tx, tenantId, maintenanceId);
                  await tx.vehicleMaintenanceAttachment.updateMany({
                    where: { id: entry.id, tenantId, maintenanceId }, data: { invoiceTotalAmount: rounded }
                  });
                });
              }
            }

            if (extractedTotals.length > 0) {
              await prisma.$transaction(async (tx) => {
                await lockMaintenanceOwner(tx, tenantId, maintenanceId);
                const totals = await tx.vehicleMaintenanceAttachment.findMany({
                  where: { tenantId, maintenanceId }, select: { invoiceTotalAmount: true }
                });
                const maintenanceTotal = roundMoney(
                  totals.reduce((acc, row) => acc + (typeof row.invoiceTotalAmount === "number" ? row.invoiceTotalAmount : 0), 0)
                );
                if (maintenanceTotal > 0) {
                  await tx.vehicleMaintenance.updateMany({
                    where: { id: maintenanceId, tenantId, deletedAt: null }, data: { cost: maintenanceTotal }
                  });
                }
              });
            }
          } catch (error) {
            logger.error({ error, maintenanceId, tenantId }, "Background invoice analysis failed");
          } finally {
            await cleanupRequestUploads(req);
          }
        })();

        // Rispondiamo subito: l'analisi OCR/PDF avviene in background per evitare attese lunghe in UI.
        res.status(201).json({
          uploaded: files.length,
          invoiceAnalyzableFiles,
          invoiceAnalysisQueued: invoiceAnalyzableFiles
        });
      } finally {
        if (!backgroundOwnsStaging) {
          await cleanupRequestUploads(req);
        }
      }
    })
  );

  router.get(
    "/vehicle-maintenance-attachments/:attachmentId/file",
    requirePermissions("vehicles:read"),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const attachment = await prisma.vehicleMaintenanceAttachment.findFirst({
        where: { id: req.params.attachmentId, tenantId,
          maintenance: { tenantId, vehicle: ownedVehicleWhere(tenantId, true) } },
        select: { filePath: true, mimeType: true, fileName: true }
      });
      if (!attachment) throw new AppError("Allegato non trovato", 404, "NOT_FOUND");

      res.setHeader("Content-Disposition", `inline; filename="${attachment.fileName.replace(/"/g, "")}"`);
      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_DOWNLOAD",
        resource: "VehicleMaintenanceAttachment",
        resourceId: req.params.attachmentId,
        details: { category: "maintenance_attachment", mimeType: attachment.mimeType }
      });
      await sendStoredFile(res, attachment);
    })
  );

  router.delete(
    "/vehicle-maintenance-attachments/:attachmentId",
    requirePermissions("vehicles:write"),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const attachment = await prisma.vehicleMaintenanceAttachment.findFirst({
        where: { id: req.params.attachmentId, tenantId,
          maintenance: { tenantId, vehicle: ownedVehicleWhere(tenantId, true) } },
        select: { id: true, maintenanceId: true, filePath: true }
      });
      if (!attachment) throw new AppError("Allegato non trovato", 404, "NOT_FOUND");

      await prisma.$transaction(async (tx) => {
        await lockMaintenanceOwner(tx, tenantId, attachment.maintenanceId, true);
        await tx.vehicleMaintenanceAttachment.delete({ where: { id: attachment.id } });
        await markStoredFileDeleted(tx, tenantId, attachment.filePath);
      }, { isolationLevel: "Serializable" });
      await deleteRetiredPhysicalObject({
        key: attachment.filePath,
        resourceType: "VehicleMaintenanceAttachment"
      });
      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_DELETE",
        resource: "VehicleMaintenanceAttachment",
        resourceId: attachment.id,
        details: { category: "maintenance_attachment" }
      });
      res.status(204).send();
    })
  );

  router.post(
    "/rental-customers/:customerId/attachments",
    requirePermissions("vehicles:write"),
    requireOwnedCustomer,
    cleanupOnUploadFailure(uploadRentalCustomerAttachments.array("files", 10)),
    uploadedHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const customerId = req.params.customerId;
      const bookingIdRaw = String(req.body?.bookingId ?? "").trim();
      const categoryRaw = String(req.body?.category ?? "").trim();
      const bookingId = bookingIdRaw || null;
      const category = categoryRaw || null;

      if (bookingId) {
        const booking = await prisma.rentalBooking.findFirst({
          where: { id: bookingId, tenantId, deletedAt: null },
          select: { id: true, customerId: true }
        });
        if (!booking) throw new AppError("Prenotazione non trovata", 404, "BOOKING_NOT_FOUND");
        if (booking.customerId && booking.customerId !== customerId) {
          throw new AppError("La prenotazione selezionata appartiene a un altro cliente", 400, "BOOKING_CUSTOMER_MISMATCH");
        }
      }

      const files = (req.files ?? []) as Express.Multer.File[];
      await secureFiles(files);
      await persistNewUploadedFiles({
        tenantId,
        category: "customer-attachments",
        resourceType: "RentalCustomerAttachment",
        resourceId: customerId,
        files,
        commit: async (tx, uploads) => tx.rentalCustomerAttachment.createMany({
          data: uploads.map((upload) => ({
            tenantId,
            customerId,
            bookingId,
            category,
            filePath: upload.key,
            fileName: upload.file.originalname || upload.file.filename,
            mimeType: upload.file.mimetype,
            sizeBytes: upload.file.size
          }))
        })
      });

      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_UPLOAD",
        resource: "RentalCustomerAttachment",
        resourceId: customerId,
        details: { count: files.length, category: category ?? "customer_attachment", linkedBooking: Boolean(bookingId) }
      });

      res.status(201).json({ uploaded: files.length });
    })
  );

  router.get(
    "/rental-customer-attachments/:attachmentId/file",
    requirePermissions("vehicles:read"),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const attachment = await prisma.rentalCustomerAttachment.findFirst({
        where: { id: req.params.attachmentId, tenantId },
        select: { filePath: true, mimeType: true, fileName: true }
      });
      if (!attachment) throw new AppError("Allegato cliente non trovato", 404, "NOT_FOUND");

      res.setHeader("Content-Disposition", `inline; filename="${attachment.fileName.replace(/"/g, "")}"`);
      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_DOWNLOAD",
        resource: "RentalCustomerAttachment",
        resourceId: req.params.attachmentId,
        details: { category: "customer_attachment", mimeType: attachment.mimeType }
      });
      await sendStoredFile(res, attachment);
    })
  );

  router.delete(
    "/rental-customer-attachments/:attachmentId",
    requirePermissions("vehicles:write"),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const attachment = await prisma.rentalCustomerAttachment.findFirst({
        where: { id: req.params.attachmentId, tenantId },
        select: { id: true, filePath: true }
      });
      if (!attachment) throw new AppError("Allegato cliente non trovato", 404, "NOT_FOUND");

      await prisma.$transaction(async (tx) => {
        await tx.rentalCustomerAttachment.delete({ where: { id: attachment.id } });
        await markStoredFileDeleted(tx, tenantId, attachment.filePath);
      }, { isolationLevel: "Serializable" });
      await deleteRetiredPhysicalObject({
        key: attachment.filePath,
        resourceType: "RentalCustomerAttachment"
      });
      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_DELETE",
        resource: "RentalCustomerAttachment",
        resourceId: attachment.id,
        details: { category: "customer_attachment" }
      });
      res.status(204).send();
    })
  );

  return router;
};
