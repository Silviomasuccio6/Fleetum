import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { StorageObservabilityService } from "../src/application/services/storage-observability-service.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { metrics } from "../src/infrastructure/observability/metrics.js";
import { storageProvider } from "../src/infrastructure/storage/storage-provider.js";

const original = {
  aggregate: prisma.storedFileObject.aggregate,
  groupBy: prisma.storedFileObject.groupBy,
  auditFindFirst: prisma.auditLog.findFirst,
  auditFindMany: prisma.auditLog.findMany
};

afterEach(() => {
  (prisma.storedFileObject as any).aggregate = original.aggregate;
  (prisma.storedFileObject as any).groupBy = original.groupBy;
  (prisma.auditLog as any).findFirst = original.auditFindFirst;
  (prisma.auditLog as any).findMany = original.auditFindMany;
});

test("storage observability summarizes active files, pending retention and safe recent events", async () => {
  (prisma.storedFileObject as any).aggregate = async (input: any) => {
    assert.equal(input.where.provider, storageProvider.name);
    if (input.where.deletedAt === null) {
      return { _count: { _all: 12 }, _sum: { sizeBytes: 2048 } };
    }
    assert.deepEqual(input.where.deletedAt, { not: null });
    return { _count: { _all: 3 }, _sum: { sizeBytes: 512 } };
  };

  (prisma.storedFileObject as any).groupBy = async () => [
    { resourceType: "VehiclePhoto", _count: { _all: 8 }, _sum: { sizeBytes: 1600 } },
    { resourceType: "RentalCustomerAttachment", _count: { _all: 4 }, _sum: { sizeBytes: 448 } }
  ];

  (prisma.auditLog as any).findFirst = async () => ({
    tenantId: "tenant_a",
    createdAt: new Date("2026-07-01T10:00:00.000Z"),
    details: {
      deleted: {
        deletedStoredFileObjects: 2
      }
    }
  });

  (prisma.auditLog as any).findMany = async () => [
    {
      id: "audit_1",
      tenantId: "tenant_a",
      action: "DOCUMENT_UPLOAD",
      resource: "VehiclePhoto",
      resourceId: "vehicle_1",
      createdAt: new Date("2026-07-01T11:00:00.000Z")
    }
  ];

  const result = await new StorageObservabilityService().platformSummary();

  assert.equal(result.provider, storageProvider.name);
  assert.equal(result.activeFiles, 12);
  assert.equal(result.activeBytes, 2048);
  assert.equal(result.deletedFilesPendingRetention, 3);
  assert.equal(result.deletedBytesPendingRetention, 512);
  assert.equal(result.lastRetentionRun?.deletedStoredFileObjects, 2);
  assert.deepEqual(result.resourceTypes.map((row) => row.resourceType), ["VehiclePhoto", "RentalCustomerAttachment"]);
  assert.equal(result.recentEvents[0]?.action, "DOCUMENT_UPLOAD");

  const rendered = metrics.renderPrometheus();
  assert.match(rendered, /fleetum_storage_active_files/);
  assert.match(rendered, /fleetum_storage_deleted_files_pending_retention/);
});
