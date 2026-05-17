import { Response, Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { extractInvoiceTotalFromPdf } from "../../../application/services/invoice-pdf-parser-service.js";
import { extractRegistrationDateFromBooklet } from "../../../application/services/vehicle-booklet-parser-service.js";
import { computeVehicleRevisionDueAt } from "../../../application/services/vehicle-revision-schedule-service.js";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { logger } from "../../../infrastructure/logging/logger.js";
import { validateUploadedFile } from "../../../infrastructure/storage/file-security.js";
import {
  upload,
  uploadMaintenanceAttachments,
  uploadRentalCustomerAttachments,
  uploadVehicleBooklet
} from "../../../infrastructure/storage/multer.js";
import { PrismaAuditLogRepository } from "../../../infrastructure/repositories/prisma-audit-log-repository.js";
import { env } from "../../../shared/config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { requirePermissions } from "../middlewares/permissions.js";
import { asyncHandler } from "./async-handler.js";

const uploadRootDir = path.resolve(process.cwd(), env.UPLOAD_DIR);
const auditRepository = new PrismaAuditLogRepository();
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const isInvoiceAnalyzableFile = (file: Express.Multer.File) =>
  file.mimetype === "application/pdf" ||
  file.mimetype.startsWith("image/") ||
  [".pdf", ".jpg", ".jpeg", ".png", ".webp"].some((ext) => file.originalname.toLowerCase().endsWith(ext));

const resolveStoredFile = (filePath: string) => {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (fullPath !== uploadRootDir && !fullPath.startsWith(`${uploadRootDir}${path.sep}`)) {
    throw new AppError("Percorso file non valido", 400, "INVALID_FILE_PATH");
  }
  return fullPath;
};

const sendStoredFile = async (
  res: Response,
  input: {
    filePath: string;
    mimeType: string;
  }
) => {
  const fullPath = resolveStoredFile(input.filePath);
  try {
    await fs.access(fullPath);
  } catch {
    throw new AppError("File non trovato", 404, "NOT_FOUND");
  }

  res.setHeader("Cache-Control", "private, max-age=60");
  res.type(input.mimeType || "application/octet-stream");
  res.sendFile(fullPath);
};

export const uploadsRoutes = () => {
  const router = Router();

  const secureFiles = async (files: Express.Multer.File[]) => {
    for (const file of files) {
      try {
        await validateUploadedFile(file.path, file.mimetype);
      } catch (error) {
        await fs.unlink(file.path).catch(() => undefined);
        throw error;
      }
    }
  };

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

  const unlinkStoredFile = async (filePath: string) => {
    const fullPath = resolveStoredFile(filePath);
    await fs.unlink(fullPath).catch(() => undefined);
  };

  router.post(
    "/stoppages/:id/photos",
    requirePermissions("stoppages:write"),
    upload.array("files", 8),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const stoppage = await prisma.stoppage.findFirst({
        where: { id: req.params.id, tenantId, deletedAt: null },
        select: { id: true }
      });
      if (!stoppage) throw new AppError("Fermo non trovato", 404, "NOT_FOUND");

      const files = (req.files ?? []) as Express.Multer.File[];
      await secureFiles(files);

      await prisma.stoppagePhoto.createMany({
        data: files.map((file) => ({
          stoppageId: req.params.id,
          filePath: `${env.UPLOAD_DIR}/${file.filename}`,
          fileName: file.filename,
          mimeType: file.mimetype,
          sizeBytes: file.size
        }))
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
        where: { id: req.params.photoId, stoppage: { tenantId } },
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
        where: { id: req.params.photoId, stoppage: { tenantId } },
        select: { id: true, filePath: true }
      });
      if (!photo) throw new AppError("Foto non trovata", 404, "NOT_FOUND");

      await prisma.stoppagePhoto.delete({ where: { id: photo.id } });
      await unlinkStoredFile(photo.filePath);
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
    upload.array("files", 8),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const vehicle = await prisma.vehicle.findFirst({
        where: { id: req.params.id, tenantId, deletedAt: null },
        select: { id: true }
      });
      if (!vehicle) throw new AppError("Veicolo non trovato", 404, "NOT_FOUND");

      const files = (req.files ?? []) as Express.Multer.File[];
      await secureFiles(files);

      await prisma.vehiclePhoto.createMany({
        data: files.map((file) => ({
          vehicleId: req.params.id,
          filePath: `${env.UPLOAD_DIR}/${file.filename}`,
          fileName: file.filename,
          mimeType: file.mimetype,
          sizeBytes: file.size
        }))
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
        where: { id: req.params.photoId, vehicle: { tenantId } },
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
        where: { id: req.params.photoId, vehicle: { tenantId } },
        select: { id: true, filePath: true }
      });
      if (!photo) throw new AppError("Foto non trovata", 404, "NOT_FOUND");

      await prisma.vehiclePhoto.delete({ where: { id: photo.id } });
      await unlinkStoredFile(photo.filePath);
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
    uploadVehicleBooklet.single("file"),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const vehicle = await prisma.vehicle.findFirst({
        where: { id: req.params.id, tenantId, deletedAt: null },
        select: { id: true, registrationDate: true, lastRevisionAt: true, revisionDueAt: true }
      });
      if (!vehicle) throw new AppError("Veicolo non trovato", 404, "NOT_FOUND");

      const file = req.file as Express.Multer.File | undefined;
      if (!file) throw new AppError("File libretto mancante", 400, "MISSING_FILE");
      await secureFiles([file]);

      const storedFilePath = `${env.UPLOAD_DIR}/${file.filename}`;
      const detectedRegistrationDate = await extractRegistrationDateFromBooklet(storedFilePath, file.mimetype);
      const nextRegistrationDate = detectedRegistrationDate ?? vehicle.registrationDate ?? null;
      const nextRevisionDueAt = computeVehicleRevisionDueAt({
        registrationDate: nextRegistrationDate,
        lastRevisionAt: vehicle.lastRevisionAt,
        manualRevisionDueAt: vehicle.revisionDueAt
      });

      const existingBooklet = await prisma.vehicleBooklet.findFirst({
        where: { tenantId, vehicleId: req.params.id },
        select: { id: true, filePath: true }
      });

      let booklet: {
        id: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        extractedRegistrationDate: Date | null;
      };

      if (existingBooklet) {
        booklet = await prisma.vehicleBooklet.update({
          where: { id: existingBooklet.id },
          data: {
            filePath: storedFilePath,
            fileName: file.originalname || file.filename,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            extractedRegistrationDate: detectedRegistrationDate
          },
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            extractedRegistrationDate: true
          }
        });
        await unlinkStoredFile(existingBooklet.filePath);
      } else {
        booklet = await prisma.vehicleBooklet.create({
          data: {
            tenantId,
            vehicleId: req.params.id,
            filePath: storedFilePath,
            fileName: file.originalname || file.filename,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            extractedRegistrationDate: detectedRegistrationDate
          },
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            extractedRegistrationDate: true
          }
        });
      }

      if (detectedRegistrationDate) {
        await prisma.vehicle.updateMany({
          where: { id: req.params.id, tenantId, deletedAt: null },
          data: {
            registrationDate: detectedRegistrationDate,
            revisionDueAt: nextRevisionDueAt
          }
        });
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
        revisionDueAt: nextRevisionDueAt ? nextRevisionDueAt.toISOString() : null
      });
    })
  );

  router.get(
    "/vehicle-booklets/:bookletId/file",
    requirePermissions("vehicles:read"),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const booklet = await prisma.vehicleBooklet.findFirst({
        where: { id: req.params.bookletId, tenantId },
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
        where: { id: req.params.bookletId, tenantId },
        select: { id: true, filePath: true }
      });
      if (!booklet) throw new AppError("Libretto non trovato", 404, "NOT_FOUND");
      await prisma.vehicleBooklet.delete({ where: { id: booklet.id } });
      await unlinkStoredFile(booklet.filePath);
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
    uploadMaintenanceAttachments.array("files", 10),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const maintenance = await prisma.vehicleMaintenance.findFirst({
        where: { id: req.params.id, tenantId, deletedAt: null },
        select: { id: true }
      });
      if (!maintenance) throw new AppError("Manutenzione non trovata", 404, "NOT_FOUND");

      const files = (req.files ?? []) as Express.Multer.File[];
      await secureFiles(files);
      const invoiceAnalyzableFiles = files.filter((file) => isInvoiceAnalyzableFile(file)).length;

      const createdAttachments = await Promise.all(
        files.map(async (file) => {
          const created = await prisma.vehicleMaintenanceAttachment.create({
            data: {
              tenantId,
              maintenanceId: req.params.id,
              filePath: `${env.UPLOAD_DIR}/${file.filename}`,
              fileName: file.originalname || file.filename,
              mimeType: file.mimetype,
              sizeBytes: file.size,
              invoiceTotalAmount: null
            },
            select: { id: true }
          });
          return { id: created.id, file };
        })
      );

      await auditFileEvent({
        tenantId,
        userId: req.auth?.userId,
        action: "DOCUMENT_UPLOAD",
        resource: "VehicleMaintenanceAttachment",
        resourceId: req.params.id,
        details: { count: files.length, category: "maintenance_attachment", invoiceAnalyzableFiles }
      });

      // Rispondiamo subito: l'analisi OCR/PDF avviene in background per evitare attese lunghe in UI.
      res.status(201).json({
        uploaded: files.length,
        invoiceAnalyzableFiles,
        invoiceAnalysisQueued: invoiceAnalyzableFiles
      });

      void (async () => {
        try {
          const extractedTotals: number[] = [];

          for (const entry of createdAttachments) {
            if (!isInvoiceAnalyzableFile(entry.file)) continue;
            const total = await extractInvoiceTotalFromPdf(entry.file.path, entry.file.mimetype);
            if (typeof total === "number" && Number.isFinite(total) && total > 0) {
              const rounded = roundMoney(total);
              extractedTotals.push(rounded);
              await prisma.vehicleMaintenanceAttachment.update({
                where: { id: entry.id },
                data: { invoiceTotalAmount: rounded }
              });
            }
          }

          if (extractedTotals.length > 0) {
            const totals = await prisma.vehicleMaintenanceAttachment.findMany({
              where: { tenantId, maintenanceId: req.params.id },
              select: { invoiceTotalAmount: true }
            });
            const maintenanceTotal = roundMoney(
              totals.reduce((acc, row) => acc + (typeof row.invoiceTotalAmount === "number" ? row.invoiceTotalAmount : 0), 0)
            );
            if (maintenanceTotal > 0) {
              await prisma.vehicleMaintenance.updateMany({
                where: { id: req.params.id, tenantId, deletedAt: null },
                data: { cost: maintenanceTotal }
              });
            }
          }
        } catch (error) {
          logger.error({ error, maintenanceId: req.params.id, tenantId }, "Background invoice analysis failed");
        }
      })();
    })
  );

  router.get(
    "/vehicle-maintenance-attachments/:attachmentId/file",
    requirePermissions("vehicles:read"),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const attachment = await prisma.vehicleMaintenanceAttachment.findFirst({
        where: { id: req.params.attachmentId, tenantId },
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
        where: { id: req.params.attachmentId, tenantId },
        select: { id: true, filePath: true }
      });
      if (!attachment) throw new AppError("Allegato non trovato", 404, "NOT_FOUND");

      await prisma.vehicleMaintenanceAttachment.delete({ where: { id: attachment.id } });
      await unlinkStoredFile(attachment.filePath);
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
    uploadRentalCustomerAttachments.array("files", 10),
    asyncHandler(async (req, res) => {
      const tenantId = req.auth!.tenantId;
      const customerId = req.params.customerId;
      const bookingIdRaw = String(req.body?.bookingId ?? "").trim();
      const categoryRaw = String(req.body?.category ?? "").trim();
      const bookingId = bookingIdRaw || null;
      const category = categoryRaw || null;

      const customer = await prisma.rentalCustomer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
        select: { id: true }
      });
      if (!customer) throw new AppError("Cliente non trovato", 404, "CUSTOMER_NOT_FOUND");

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

      await prisma.rentalCustomerAttachment.createMany({
        data: files.map((file) => ({
          tenantId,
          customerId,
          bookingId,
          category,
          filePath: `${env.UPLOAD_DIR}/${file.filename}`,
          fileName: file.originalname || file.filename,
          mimeType: file.mimetype,
          sizeBytes: file.size
        }))
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

      await prisma.rentalCustomerAttachment.delete({ where: { id: attachment.id } });
      await unlinkStoredFile(attachment.filePath);
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
