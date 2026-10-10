import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Request, RequestHandler } from "express";
import { logger } from "../logging/logger.js";
import { metrics } from "../observability/metrics.js";
import { AppError } from "../../shared/errors/app-error.js";
import { storageProvider } from "./storage-provider.js";

const stagingRoot = path.join(os.tmpdir(), "fleetum-upload-staging");
const requestStagingDirectories = new WeakMap<object, Promise<string>>();

const mimeExtensions = new Map<string, string>([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["application/pdf", ".pdf"],
  ["text/plain", ".txt"],
  ["text/csv", ".csv"],
  ["application/msword", ".doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["application/vnd.ms-excel", ".xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"]
]);

export const trustedExtensionForMime = (mimeType: string) => mimeExtensions.get(mimeType) ?? ".bin";

export const getRequestUploadStagingDirectory = async (req: Request) => {
  const existing = requestStagingDirectories.get(req);
  if (existing) return existing;

  const pending = (async () => {
    const directory = path.join(stagingRoot, crypto.randomUUID());
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  })();
  requestStagingDirectories.set(req, pending);
  try {
    return await pending;
  } catch (error) {
    requestStagingDirectories.delete(req);
    throw error;
  }
};

export const createStagingFileName = (mimeType: string) =>
  `${crypto.randomUUID()}${trustedExtensionForMime(mimeType)}`;

export const requestUploadedFiles = (req: Request): Express.Multer.File[] => {
  const files: Express.Multer.File[] = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  else if (req.files && typeof req.files === "object") {
    for (const bucket of Object.values(req.files)) files.push(...bucket);
  }
  return Array.from(new Map(files.map((file) => [file.path, file])).values());
};

export const cleanupUploadedFiles = async (files: Express.Multer.File[]) => {
  const uniquePaths = Array.from(new Set(files.map((file) => path.resolve(file.path)))).filter((filePath) => {
    const relative = path.relative(stagingRoot, filePath);
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
  const uniqueDirectories = Array.from(new Set(uniquePaths.map((filePath) => path.dirname(filePath))));
  const results = await Promise.allSettled(
    uniqueDirectories.map(async (directory) => {
      const relative = path.relative(stagingRoot, directory);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return;
      await fs.rm(directory, { recursive: true, force: true });
    })
  );
  const failures = results.filter((result) => result.status === "rejected").length;
  if (uniqueDirectories.length > failures) {
    metrics.observeStorageCleanup({
      status: "success",
      provider: "staging",
      resourceType: "RequestUploadStaging",
      objects: uniqueDirectories.length - failures
    });
  }
  if (failures > 0) {
    metrics.observeStorageCleanup({
      status: "failure",
      provider: "staging",
      resourceType: "RequestUploadStaging",
      objects: failures
    });
    logger.error(
      { failedDirectories: failures, directoryCount: uniqueDirectories.length },
      "Upload staging cleanup could not remove every request directory"
    );
  }
};

export const cleanupRequestUploads = async (req: Request) => {
  await cleanupUploadedFiles(requestUploadedFiles(req));
  const pendingDirectory = requestStagingDirectories.get(req);
  if (pendingDirectory) {
    const directory = await pendingDirectory.catch(() => undefined);
    if (directory) {
      try {
        await fs.rm(directory, { recursive: true, force: true });
      } catch (error) {
        metrics.observeStorageCleanup({
          status: "failure",
          provider: "staging",
          resourceType: "RequestUploadStaging",
          objects: 1
        });
        logger.error({ error }, "Upload request staging directory cleanup failed");
      }
    }
    requestStagingDirectories.delete(req);
  }
};

export const withRequestUploadCleanup = async <T>(req: Request, action: () => Promise<T>) => {
  try {
    return await action();
  } finally {
    await cleanupRequestUploads(req);
  }
};

export const cleanupOnUploadFailure = (middleware: RequestHandler): RequestHandler =>
  (req, res, next) => {
    middleware(req, res, (error?: unknown) => {
      if (!error) {
        next();
        return;
      }
      void cleanupRequestUploads(req).then(
        () => next(error),
        () => next(error)
      );
    });
  };

export const buildTenantStorageKey = (input: {
  tenantId: string;
  category: string;
  mimeType: string;
}) => {
  if (!/^[A-Za-z0-9_-]+$/.test(input.tenantId)) {
    throw new AppError("Tenant storage non valido", 500, "INVALID_STORAGE_TENANT");
  }
  if (!/^[a-z0-9-]+$/.test(input.category)) {
    throw new AppError("Categoria storage non valida", 500, "INVALID_STORAGE_CATEGORY");
  }
  return storageProvider.buildKey(
    "tenants",
    input.tenantId,
    input.category,
    `${crypto.randomUUID()}${trustedExtensionForMime(input.mimeType)}`
  );
};

export const uploadStagingRootForTests = () => stagingRoot;
