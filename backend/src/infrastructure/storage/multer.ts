import fs from "node:fs";
import multer from "multer";
import { AppError } from "../../shared/errors/app-error.js";
import { localStorageProvider } from "./storage-provider.js";

const uploadDir = localStorageProvider.getRootDir();
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const createDiskUpload = (allowedMime: Set<string>, limits: { fileSize: number; files: number }) =>
  multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename: (_req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
        cb(null, `${Date.now()}-${safeName}`);
      }
    }),
    limits,
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
const allowedRentalCustomerAttachmentMime = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
]);

export const upload = createDiskUpload(allowedImageMime, { fileSize: 5 * 1024 * 1024, files: 8 });
export const uploadMaintenanceAttachments = createDiskUpload(allowedMaintenanceAttachmentMime, {
  fileSize: 12 * 1024 * 1024,
  files: 10
});
export const uploadVehicleBooklet = createDiskUpload(allowedVehicleBookletMime, {
  fileSize: 12 * 1024 * 1024,
  files: 1
});
export const uploadRentalCustomerAttachments = createDiskUpload(allowedRentalCustomerAttachmentMime, {
  fileSize: 12 * 1024 * 1024,
  files: 10
});

export const uploadContractLogo = createDiskUpload(allowedImageMime, {
  fileSize: 8 * 1024 * 1024,
  files: 1
});
