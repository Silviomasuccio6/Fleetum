import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { metrics } from "../../infrastructure/observability/metrics.js";
import { storageProvider } from "../../infrastructure/storage/storage-provider.js";
import { env } from "../../shared/config/env.js";

type StorageResourceSummary = {
  resourceType: string;
  files: number;
  bytes: number;
};

type RecentStorageEvent = {
  id: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  tenantId: string;
  createdAt: string;
};

type LastRetentionRun = {
  at: string;
  tenantId: string;
  deletedStoredFileObjects: number;
} | null;

const toCount = (value: number | bigint | null | undefined) => Number(value ?? 0);
const toBytes = (value: number | bigint | null | undefined) => Number(value ?? 0);

const asRecord = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const deletedStoredFilesFromAudit = (details: Prisma.JsonValue | null | undefined) => {
  const payload = asRecord(details);
  const deleted = asRecord(payload?.deleted as Prisma.JsonValue | null | undefined);
  return toCount(deleted?.deletedStoredFileObjects as number | null | undefined);
};

export class StorageObservabilityService {
  private readonly currentBucket = storageProvider.name === "s3" ? env.S3_BUCKET ?? "s3" : "local";

  private currentProviderWhere(): Prisma.StoredFileObjectWhereInput {
    const bucketFilter =
      storageProvider.name === "local"
        ? { OR: [{ bucket: this.currentBucket }, { bucket: null }] }
        : { bucket: this.currentBucket };

    return {
      provider: storageProvider.name,
      ...bucketFilter
    };
  }

  async platformSummary() {
    const providerWhere = this.currentProviderWhere();
    const activeWhere: Prisma.StoredFileObjectWhereInput = { ...providerWhere, deletedAt: null };
    const deletedWhere: Prisma.StoredFileObjectWhereInput = { ...providerWhere, deletedAt: { not: null } };

    const [
      activeAggregate,
      deletedAggregate,
      resourceGroups,
      latestRetention,
      recentEvents
    ] = await Promise.all([
      prisma.storedFileObject.aggregate({
        where: activeWhere,
        _count: { _all: true },
        _sum: { sizeBytes: true }
      }),
      prisma.storedFileObject.aggregate({
        where: deletedWhere,
        _count: { _all: true },
        _sum: { sizeBytes: true }
      }),
      prisma.storedFileObject.groupBy({
        by: ["resourceType"],
        where: activeWhere,
        _count: { _all: true },
        _sum: { sizeBytes: true }
      }),
      prisma.auditLog.findFirst({
        where: { action: "DATA_RETENTION_EXECUTED", resource: "PrivacyRetention" },
        orderBy: { createdAt: "desc" },
        select: { tenantId: true, createdAt: true, details: true }
      }),
      prisma.auditLog.findMany({
        where: {
          action: {
            in: [
              "DOCUMENT_UPLOAD",
              "DOCUMENT_DOWNLOAD",
              "DATA_RETENTION_EXECUTED",
              "TENANT_COMPANY_VERIFICATION_DOCUMENT_UPLOADED"
            ]
          }
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          tenantId: true,
          action: true,
          resource: true,
          resourceId: true,
          createdAt: true
        }
      })
    ]);

    const activeFiles = toCount(activeAggregate._count._all);
    const activeBytes = toBytes(activeAggregate._sum.sizeBytes);
    const deletedFilesPendingRetention = toCount(deletedAggregate._count._all);
    const deletedBytesPendingRetention = toBytes(deletedAggregate._sum.sizeBytes);

    const resourceTypes: StorageResourceSummary[] = resourceGroups
      .map((row) => ({
        resourceType: row.resourceType ?? "unknown",
        files: toCount(row._count._all),
        bytes: toBytes(row._sum.sizeBytes)
      }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8);

    const lastRetentionRun: LastRetentionRun = latestRetention
      ? {
          at: latestRetention.createdAt.toISOString(),
          tenantId: latestRetention.tenantId,
          deletedStoredFileObjects: deletedStoredFilesFromAudit(latestRetention.details)
        }
      : null;

    metrics.setStorageSummary({
      provider: storageProvider.name,
      bucket: this.currentBucket,
      activeFiles,
      activeBytes,
      deletedFilesPendingRetention,
      deletedBytesPendingRetention,
      retentionGraceDays: env.PRIVACY_RETENTION_DELETED_FILE_GRACE_DAYS
    });

    return {
      status: storageProvider.name === "s3" ? "S3" : "LOCAL",
      provider: storageProvider.name,
      bucket: this.currentBucket,
      uploadDir: env.UPLOAD_DIR,
      activeFiles,
      activeBytes,
      deletedFilesPendingRetention,
      deletedBytesPendingRetention,
      retentionGraceDays: env.PRIVACY_RETENTION_DELETED_FILE_GRACE_DAYS,
      lastRetentionRun,
      resourceTypes,
      recentEvents: recentEvents.map<RecentStorageEvent>((event) => ({
        id: event.id,
        action: event.action,
        resource: event.resource,
        resourceId: event.resourceId,
        tenantId: event.tenantId,
        createdAt: event.createdAt.toISOString()
      }))
    };
  }
}
