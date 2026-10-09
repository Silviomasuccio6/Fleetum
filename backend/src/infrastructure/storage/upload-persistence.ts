import crypto from "node:crypto";
import fs from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import { prisma } from "../database/prisma/client.js";
import { logger } from "../logging/logger.js";
import { metrics } from "../observability/metrics.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { buildTenantStorageKey } from "./upload-lifecycle.js";
import { storageProvider, type StoredFileMetadata } from "./storage-provider.js";

export type PersistedUpload = {
  file: Express.Multer.File;
  key: string;
  checksumSha256: string;
  storedFileObject: {
    id: string;
    originalName: string | null;
    mimeType: string | null;
    sizeBytes: number;
    createdAt: Date;
    visibility: string;
  };
};

const storageBucket = () => (storageProvider.name === "s3" ? env.S3_BUCKET ?? "s3" : "local");
const tenantQuotaBytes = () => env.UPLOAD_TENANT_QUOTA_MB * 1024 * 1024;

const checksumFile = async (filePath: string) =>
  crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");

const assertTenantStorageQuota = async (
  tx: Prisma.TransactionClient,
  tenantId: string
) => {
  const current = await tx.storedFileObject.aggregate({
    where: { tenantId, deletedAt: null },
    _sum: { sizeBytes: true }
  });
  const currentBytes = current._sum.sizeBytes ?? 0;
  if (currentBytes > tenantQuotaBytes()) {
    throw new AppError(
      "Quota documenti tenant superata",
      413,
      "TENANT_STORAGE_QUOTA_EXCEEDED",
      { quotaBytes: tenantQuotaBytes(), currentBytes }
    );
  }
};

const cleanupPhysicalObjects = async (keys: string[], resourceType: string) => {
  const results = await Promise.allSettled(keys.map((key) => storageProvider.delete(key)));
  const removedKeys = keys.filter((_key, index) => results[index]?.status === "fulfilled");
  const failedKeys = keys.filter((_key, index) => results[index]?.status === "rejected");
  if (removedKeys.length > 0) {
    metrics.observeStorageCleanup({
      status: "success",
      provider: storageProvider.name,
      resourceType,
      objects: removedKeys.length
    });
  }
  if (failedKeys.length > 0) {
    metrics.observeStorageCleanup({
      status: "failure",
      provider: storageProvider.name,
      resourceType,
      objects: failedKeys.length
    });
    logger.error(
      { failedObjects: failedKeys.length, objectCount: keys.length, resourceType },
      "Storage cleanup could not remove every object"
    );
  }
  return { removedKeys, failedKeys };
};

type CompensationCandidate = {
  key: string;
  checksumSha256: string;
  originalName: string | null;
  mimeType: string | null;
  sizeBytes: number;
};

type UploadCommitProof = {
  id: string;
  storageKey: string;
  checksumSha256: string;
  sizeBytes: number;
};

const isSerializationRollback = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "P2034";

const recoverCompletedUploadCommit = async (input: {
  tenantId: string;
  resourceType: string;
  objects: UploadCommitProof[];
}) => {
  // A rejected COMMIT response is not proof of rollback. These unique metadata
  // IDs were created in the same transaction as the domain links and quota check.
  // Only a complete matching durable receipt can acknowledge that transaction.
  try {
    if (input.objects.length > 0) {
      const committed = await prisma.storedFileObject.findMany({
        where: {
          tenantId: input.tenantId,
          provider: storageProvider.name,
          bucket: storageBucket(),
          resourceType: input.resourceType,
          id: { in: input.objects.map((object) => object.id) },
          storageKey: { in: input.objects.map((object) => object.storageKey) },
          deletedAt: null
        },
        select: { id: true, storageKey: true, checksumSha256: true, sizeBytes: true }
      });
      if (committed.length === input.objects.length && input.objects.every((object) =>
        committed.some((row) => row.id === object.id && row.storageKey === object.storageKey &&
          row.checksumSha256 === object.checksumSha256 && row.sizeBytes === object.sizeBytes)
      )) {
        logger.warn(
          { objectCount: input.objects.length, resourceType: input.resourceType },
          "Upload commit recovered from durable metadata"
        );
        return;
      }
    }
  } catch {
    // An unavailable or incomplete receipt must never authorize deletion.
  }
  logger.error(
    { objectCount: input.objects.length, resourceType: input.resourceType },
    "Upload commit outcome unknown; physical objects retained for reconciliation"
  );
  throw new AppError("Esito upload da verificare; i file sono stati conservati", 503, "UPLOAD_COMMIT_UNCERTAIN");
};

const recordFailedCompensationObjects = async (input: {
  tenantId: string;
  resourceType: string;
  resourceId?: string | null;
  failedKeys: string[];
  candidates: CompensationCandidate[];
}) => {
  if (input.failedKeys.length === 0) return;
  const failed = new Set(input.failedKeys);
  const deletedAt = new Date();
  try {
    await prisma.storedFileObject.createMany({
      data: input.candidates
        .filter((candidate) => failed.has(candidate.key))
        .map((candidate) => ({
          tenantId: input.tenantId,
          provider: storageProvider.name,
          bucket: storageBucket(),
          storageKey: candidate.key,
          originalName: candidate.originalName,
          mimeType: candidate.mimeType,
          sizeBytes: candidate.sizeBytes,
          checksumSha256: candidate.checksumSha256,
          resourceType: input.resourceType,
          resourceId: input.resourceId ?? null,
          visibility: "private",
          deletedAt
        })),
      skipDuplicates: true
    });
  } catch (error) {
    logger.error(
      { error, failedObjects: input.failedKeys.length, resourceType: input.resourceType },
      "Upload compensation tombstones could not be recorded"
    );
  }
};

const writeNewFileWithRetry = async (input: {
  tenantId: string;
  category: string;
  resourceType: string;
  resourceId?: string | null;
  file: Express.Multer.File;
}) => {
  const checksumSha256 = await checksumFile(input.file.path);
  const metadata: StoredFileMetadata = {
    tenantId: input.tenantId,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    originalName: input.file.originalname,
    mimeType: input.file.mimetype
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const key = buildTenantStorageKey({
      tenantId: input.tenantId,
      category: input.category,
      mimeType: input.file.mimetype
    });
    try {
      await storageProvider.writeNewFromFile(key, input.file.path, metadata);
      return { file: input.file, key, checksumSha256 };
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "STORAGE_OBJECT_EXISTS" || attempt === 2) throw error;
    }
  }

  throw new AppError("Impossibile allocare una chiave storage", 500, "STORAGE_KEY_ALLOCATION_FAILED");
};

export const persistNewUploadedFiles = async <T>(input: {
  tenantId: string;
  category: string;
  resourceType: string;
  resourceId?: string | null;
  files: Express.Multer.File[];
  commit: (
    tx: Prisma.TransactionClient,
    uploads: PersistedUpload[]
  ) => Promise<T>;
}) => {
  const writeResults = await Promise.allSettled(
    input.files.map((file) => writeNewFileWithRetry({
      tenantId: input.tenantId,
      category: input.category,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      file
    }))
  );
  const written = writeResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failed = writeResults.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    const cleanup = await cleanupPhysicalObjects(written.map((upload) => upload.key), input.resourceType);
    await recordFailedCompensationObjects({
      tenantId: input.tenantId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      failedKeys: cleanup.failedKeys,
      candidates: written.map((upload) => ({
        key: upload.key,
        checksumSha256: upload.checksumSha256,
        originalName: upload.file.originalname,
        mimeType: upload.file.mimetype,
        sizeBytes: upload.file.size
      }))
    });
    throw failed.reason;
  }

  const completed: { value?: { result: T; uploads: PersistedUpload[] } } = {};
  try {
    const transactionResult = await prisma.$transaction(async (tx) => {
      const uploads: PersistedUpload[] = [];
      for (const upload of written) {
        const stored = await tx.storedFileObject.create({
          data: {
            tenantId: input.tenantId,
            provider: storageProvider.name,
            bucket: storageBucket(),
            storageKey: upload.key,
            originalName: upload.file.originalname,
            mimeType: upload.file.mimetype,
            sizeBytes: upload.file.size,
            checksumSha256: upload.checksumSha256,
            resourceType: input.resourceType,
            resourceId: input.resourceId ?? null,
            visibility: "private"
          },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
            visibility: true
          }
        });
        uploads.push({ ...upload, storedFileObject: stored });
      }
      const result = await input.commit(tx, uploads);
      await assertTenantStorageQuota(tx, input.tenantId);
      completed.value = { result, uploads };
      return completed.value;
    }, { isolationLevel: "Serializable" });
    return transactionResult;
  } catch (error) {
    if (completed.value && !isSerializationRollback(error)) {
      await recoverCompletedUploadCommit({
        tenantId: input.tenantId,
        resourceType: input.resourceType,
        objects: completed.value.uploads.map((upload) => ({
          id: upload.storedFileObject.id, storageKey: upload.key,
          checksumSha256: upload.checksumSha256, sizeBytes: upload.file.size
        }))
      });
      return completed.value;
    }
    const cleanup = await cleanupPhysicalObjects(written.map((upload) => upload.key), input.resourceType);
    await recordFailedCompensationObjects({
      tenantId: input.tenantId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      failedKeys: cleanup.failedKeys,
      candidates: written.map((upload) => ({
        key: upload.key,
        checksumSha256: upload.checksumSha256,
        originalName: upload.file.originalname,
        mimeType: upload.file.mimetype,
        sizeBytes: upload.file.size
      }))
    });
    throw error;
  }
};

export const persistNewBuffer = async (input: {
  tenantId: string;
  category: string;
  resourceType: string;
  resourceId?: string | null;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}) => {
  const metadata: StoredFileMetadata = {
    tenantId: input.tenantId,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    originalName: input.originalName,
    mimeType: input.mimeType
  };
  let key = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    key = buildTenantStorageKey({ tenantId: input.tenantId, category: input.category, mimeType: input.mimeType });
    try {
      await storageProvider.writeNew(key, input.buffer, metadata);
      break;
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "STORAGE_OBJECT_EXISTS" || attempt === 2) throw error;
    }
  }

  const checksumSha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const completed: { value?: { id: string } } = {};
  try {
    const storedFileObject = await prisma.$transaction(async (tx) => {
      const stored = await tx.storedFileObject.create({
        data: {
          tenantId: input.tenantId,
          provider: storageProvider.name,
          bucket: storageBucket(),
          storageKey: key,
          originalName: input.originalName,
          mimeType: input.mimeType,
          sizeBytes: input.buffer.length,
          checksumSha256,
          resourceType: input.resourceType,
          resourceId: input.resourceId ?? null,
          visibility: "private"
        },
        select: { id: true }
      });
      await assertTenantStorageQuota(tx, input.tenantId);
      completed.value = stored;
      return stored;
    }, { isolationLevel: "Serializable" });
    return { key, checksumSha256, storedFileObjectId: storedFileObject.id };
  } catch (error) {
    if (completed.value && !isSerializationRollback(error)) {
      await recoverCompletedUploadCommit({
        tenantId: input.tenantId,
        resourceType: input.resourceType,
        objects: [{ id: completed.value.id, storageKey: key, checksumSha256, sizeBytes: input.buffer.length }]
      });
      return { key, checksumSha256, storedFileObjectId: completed.value.id };
    }
    const cleanup = await cleanupPhysicalObjects([key], input.resourceType);
    await recordFailedCompensationObjects({
      tenantId: input.tenantId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      failedKeys: cleanup.failedKeys,
      candidates: [{
        key,
        checksumSha256,
        originalName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length
      }]
    });
    throw error;
  }
};

export const deleteRetiredPhysicalObject = async (input: { key: string; resourceType: string }) => {
  const cleanup = await cleanupPhysicalObjects([input.key], input.resourceType);
  return cleanup.failedKeys.length === 0;
};

export const compensateCommittedUpload = async (input: {
  tenantId: string;
  key: string;
  resourceType: string;
}) => {
  try {
    await prisma.storedFileObject.updateMany({
      where: {
        tenantId: input.tenantId,
        provider: storageProvider.name,
        bucket: storageBucket(),
        storageKey: input.key,
        deletedAt: null
      },
      data: { deletedAt: new Date() }
    });
  } catch (error) {
    logger.error(
      { error, resourceType: input.resourceType },
      "Committed upload compensation could not mark metadata for retention"
    );
    return false;
  }
  const cleanup = await cleanupPhysicalObjects([input.key], input.resourceType);
  return cleanup.failedKeys.length === 0;
};
