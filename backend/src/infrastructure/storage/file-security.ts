import fs from "node:fs/promises";
import { AppError } from "../../shared/errors/app-error.js";

const jpeg = [0xff, 0xd8, 0xff];
const png = [0x89, 0x50, 0x4e, 0x47];
const riff = [0x52, 0x49, 0x46, 0x46];
const webp = [0x57, 0x45, 0x42, 0x50];
const pdf = [0x25, 0x50, 0x44, 0x46];
const zip = [0x50, 0x4b, 0x03, 0x04];
const zipEmpty = [0x50, 0x4b, 0x05, 0x06];
const zipSpanned = [0x50, 0x4b, 0x07, 0x08];
const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const startsWith = (bytes: Buffer, signature: number[]) => signature.every((v, i) => bytes[i] === v);
const eicarPattern = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR";

const imageMimeSet = new Set(["image/jpeg", "image/png", "image/webp"]);
const pdfMimeSet = new Set(["application/pdf"]);
const officeZipMimeSet = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const officeOleMimeSet = new Set([
  "application/msword",
  "application/vnd.ms-excel"
]);
const textMimeSet = new Set(["text/plain", "text/csv"]);

const readHead = async (filePath: string, bytes = 512) => {
  const fd = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const result = await fd.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await fd.close();
  }
};

const isZipLike = (bytes: Buffer) => startsWith(bytes, zip) || startsWith(bytes, zipEmpty) || startsWith(bytes, zipSpanned);

export const validateImageMagic = async (filePath: string, mimeType: string) => {
  const buffer = await readHead(filePath, 16);

  if (mimeType === "image/jpeg" && startsWith(buffer, jpeg)) return true;
  if (mimeType === "image/png" && startsWith(buffer, png)) return true;
  if (mimeType === "image/webp" && startsWith(buffer, riff) && buffer.slice(8, 12).every((v, i) => v === webp[i])) return true;

  throw new AppError("Contenuto file non valido", 400, "INVALID_FILE_MAGIC");
};

export const validateFileMagic = async (filePath: string, mimeType: string) => {
  const buffer = await readHead(filePath, 512);

  if (imageMimeSet.has(mimeType)) return validateImageMagic(filePath, mimeType);
  if (pdfMimeSet.has(mimeType) && startsWith(buffer, pdf)) return true;
  if (officeZipMimeSet.has(mimeType) && isZipLike(buffer)) return true;
  if (officeOleMimeSet.has(mimeType) && startsWith(buffer, ole)) return true;
  if (textMimeSet.has(mimeType) && !buffer.includes(0x00)) return true;

  throw new AppError("Contenuto file non coerente con il tipo dichiarato", 400, "INVALID_FILE_MAGIC");
};

export const scanFileForThreats = async (filePath: string) => {
  const sample = await readHead(filePath, 4096);
  if (sample.toString("ascii").includes(eicarPattern)) {
    throw new AppError("File bloccato dai controlli di sicurezza", 400, "MALWARE_SIGNATURE_DETECTED");
  }
  return true;
};

export const validateUploadedFile = async (filePath: string, mimeType: string) => {
  await validateFileMagic(filePath, mimeType);
  await scanFileForThreats(filePath);
  if (imageMimeSet.has(mimeType)) await sanitizeImageMetadata(filePath);
  return true;
};

export const sanitizeImageMetadata = async (_filePath: string) => {
  // Hook per futura sanitizzazione EXIF/metadata (es. re-encode server-side con libreria imaging).
  return;
};
