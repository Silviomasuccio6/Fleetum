import multer from "multer";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { createStagingFileName, getRequestUploadStagingDirectory } from "./upload-lifecycle.js";

const mb = (value: number) => value * 1024 * 1024;

const createDiskUpload = (allowedMime: Set<string>, limits: { fileSizeMb: number; files: number }) =>
  multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        void getRequestUploadStagingDirectory(req).then(
          (directory) => cb(null, directory),
          (error) => cb(error as Error, "")
        );
      },
      filename: (_req, file, cb) => cb(null, createStagingFileName(file.mimetype))
    }),
    limits: { fileSize: mb(limits.fileSizeMb), files: limits.files },
    fileFilter: (_req, file, cb) => {
      if (!allowedMime.has(file.mimetype)) {
        cb(new AppError("Tipo file non supportato", 400));
        return;
      }
      cb(null, true);
    }
  });

const allowedImageMime = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedMaintenanceAttachmentMime = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const allowedVehicleBookletMime = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
]);
const allowedCompanyVerificationDocumentMime = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf"
]);
const allowedRentalCustomerAttachmentMime = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
]);

export const upload = createDiskUpload(allowedImageMime, { fileSizeMb: env.FILE_MAX_IMAGE_MB, files: 8 });
export const uploadMaintenanceAttachments = createDiskUpload(allowedMaintenanceAttachmentMime, {
  fileSizeMb: env.FILE_MAX_DOCUMENT_MB,
  files: 10
});
export const uploadVehicleBooklet = createDiskUpload(allowedVehicleBookletMime, {
  fileSizeMb: env.FILE_MAX_DOCUMENT_MB,
  files: 1
});
export const uploadRentalCustomerAttachments = createDiskUpload(allowedRentalCustomerAttachmentMime, {
  fileSizeMb: env.FILE_MAX_DOCUMENT_MB,
  files: 10
});

export const uploadContractLogo = createDiskUpload(allowedImageMime, {
  fileSizeMb: env.FILE_MAX_LOGO_MB,
  files: 1
});
export const uploadCompanyVerificationDocument = createDiskUpload(allowedCompanyVerificationDocumentMime, {
  fileSizeMb: env.FILE_MAX_DOCUMENT_MB,
  files: 1
});
