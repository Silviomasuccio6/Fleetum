import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";

// Opt in before importing configuration or opening any database connection.
const assertSyntheticDatabase = () => {
  assert.equal(process.env.RUN_TENANT_ISOLATION_TESTS, "1", "temporary database runner opt-in is required");
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.DOTENV_CONFIG_PATH, "/dev/null", "real env files must not be loaded");
  const url = new URL(process.env.DATABASE_URL ?? "invalid://missing");
  assert.ok(url.protocol === "postgresql:" || url.protocol === "postgres:");
  assert.ok(url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  assert.ok(url.pathname === "/fleetum_ci" || url.pathname === "/fleetum_rehearsal", "only the temporary synthetic database is allowed");
  assert.equal(process.env.STORAGE_PROVIDER ?? "local", "local", "this suite must never use a remote storage provider");
};

let prisma: typeof import("../../src/infrastructure/database/prisma/client.js").prisma;
let persist: typeof import("../../src/infrastructure/storage/upload-persistence.js");
let storage: typeof import("../../src/infrastructure/storage/storage-provider.js").storageProvider;
let savedTransaction: typeof prisma.$transaction;
let directory: string | undefined;
const originalUploadDir = process.env.UPLOAD_DIR;
const tenantIds: string[] = [];
const runId = `upload-commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sequence = 0;

const fixture = async () => {
  const marker = `${runId}-${sequence++}`;
  const tenant = await prisma.tenant.create({ data: { name: `Synthetic ${marker}` } });
  tenantIds.push(tenant.id);
  const site = await prisma.site.create({ data: {
    tenantId: tenant.id, name: marker, address: "Synthetic", city: "Synthetic"
  } });
  const vehicle = await prisma.vehicle.create({ data: {
    tenantId: tenant.id, siteId: site.id, plate: `SYN-${marker}`, brand: "Synthetic", model: "Upload recovery"
  } });
  return { tenant, site, vehicle };
};

const createFile = async (name: string): Promise<Express.Multer.File> => {
  assert.ok(directory);
  const buffer = Buffer.from(`Synthetic upload ${name}`);
  const filePath = path.join(directory, name);
  await fs.writeFile(filePath, buffer);
  return {
    fieldname: "files", originalname: name, encoding: "7bit", mimetype: "image/png",
    destination: directory, filename: name, path: filePath, size: buffer.length,
    buffer, stream: Readable.from(buffer)
  };
};

const withLostCommitAcknowledgement = async <T>(work: () => Promise<T>) => {
  let committedTransactions = 0;
  (prisma as any).$transaction = async (input: any, options?: any) => {
    // This is the only injected fault: the real database transaction has already
    // committed successfully. Recovery queries and local storage remain real.
    await (savedTransaction as any).call(prisma, input, options);
    committedTransactions += 1;
    throw new Error("Synthetic lost COMMIT acknowledgement after real PostgreSQL success");
  };
  try {
    const result = await work();
    assert.equal(committedTransactions, 1);
    return result;
  } finally {
    (prisma as any).$transaction = savedTransaction;
  }
};

describe("upload commit recovery with real PostgreSQL metadata and private local storage", { concurrency: false }, () => {
  before(async () => {
    assertSyntheticDatabase();
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-upload-commit-pg-")));
    process.env.UPLOAD_DIR = path.join(directory, "objects");
    ({ prisma } = await import("../../src/infrastructure/database/prisma/client.js"));
    persist = await import("../../src/infrastructure/storage/upload-persistence.js");
    ({ storageProvider: storage } = await import("../../src/infrastructure/storage/storage-provider.js"));
    assert.equal(storage.name, "local");
    savedTransaction = prisma.$transaction;
    await prisma.$connect();
    const versions = await prisma.$queryRaw<Array<{ version: number }>>`SELECT current_setting('server_version_num')::integer AS version`;
    assert.ok(versions[0]!.version >= 160000 && versions[0]!.version < 170000, "the synthetic runner must provide PostgreSQL 16");
  });

  after(async () => {
    try {
      if (prisma) {
        if (savedTransaction) (prisma as any).$transaction = savedTransaction;
        try {
          const own = { in: tenantIds };
          await prisma.vehiclePhoto.deleteMany({ where: { vehicle: { tenantId: own } } });
          await prisma.storedFileObject.deleteMany({ where: { tenantId: own } });
          await prisma.vehicle.deleteMany({ where: { tenantId: own } });
          await prisma.site.deleteMany({ where: { tenantId: own } });
          await prisma.tenant.deleteMany({ where: { id: own } });
        } finally {
          await prisma.$disconnect();
        }
      }
    } finally {
      if (directory) await fs.rm(directory, { recursive: true, force: true });
      if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
      else process.env.UPLOAD_DIR = originalUploadDir;
    }
  });

  it("recovers a committed batch and its domain links after acknowledgement loss without repeating the callback", async () => {
    const { tenant, vehicle } = await fixture();
    const files = await Promise.all([createFile("first.png"), createFile("second.png")]);
    let callbacks = 0;
    const recovered = await withLostCommitAcknowledgement(() => persist.persistNewUploadedFiles({
      tenantId: tenant.id, category: "vehicle-photos", resourceType: "VehiclePhoto", resourceId: vehicle.id, files,
      commit: async (tx, uploads) => {
        callbacks += 1;
        const photoIds: string[] = [];
        for (const upload of uploads) {
          const photo = await tx.vehiclePhoto.create({ data: {
            vehicleId: vehicle.id, filePath: upload.key, fileName: upload.file.originalname,
            mimeType: upload.file.mimetype, sizeBytes: upload.file.size
          } });
          await tx.storedFileObject.update({ where: { id: upload.storedFileObject.id }, data: { resourceId: photo.id } });
          photoIds.push(photo.id);
        }
        return { vehicleId: vehicle.id, photoIds };
      }
    }));
    assert.equal(callbacks, 1);
    const photos = await prisma.vehiclePhoto.findMany({ where: { vehicleId: vehicle.id } });
    assert.equal(photos.length, 2);
    assert.deepEqual(photos.map((photo) => photo.id).sort(), recovered.result.photoIds.slice().sort());
    const objects = await prisma.storedFileObject.findMany({ where: { tenantId: tenant.id } });
    assert.equal(objects.length, 2);
    for (const upload of recovered.uploads) {
      const row = objects.find((object) => object.id === upload.storedFileObject.id);
      assert.ok(row);
      assert.equal(row.deletedAt, null);
      assert.equal(row.storageKey, upload.key);
      assert.equal(row.checksumSha256, upload.checksumSha256);
      assert.ok(photos.some((photo) => photo.id === row.resourceId && photo.filePath === row.storageKey));
      assert.equal(await storage.exists(upload.key), true);
      assert.deepEqual(await storage.read(upload.key), upload.file.buffer);
    }
  });

  it("recovers a buffer from its real committed metadata while preserving its physical bytes", async () => {
    const { tenant, vehicle } = await fixture();
    const buffer = Buffer.from("Synthetic committed document");
    const recovered = await withLostCommitAcknowledgement(() => persist.persistNewBuffer({
      tenantId: tenant.id, category: "synthetic-documents", resourceType: "SyntheticUploadRecovery", resourceId: vehicle.id,
      originalName: "synthetic.pdf", mimeType: "application/pdf", buffer
    }));
    const row = await prisma.storedFileObject.findUniqueOrThrow({ where: { id: recovered.storedFileObjectId } });
    assert.equal(row.tenantId, tenant.id);
    assert.equal(row.deletedAt, null);
    assert.equal(row.storageKey, recovered.key);
    assert.equal(row.checksumSha256, recovered.checksumSha256);
    assert.equal(await storage.exists(recovered.key), true);
    assert.deepEqual(await storage.read(recovered.key), buffer);
  });

  it("a real callback rollback removes new objects and rolls back both metadata and domain links", async () => {
    const { tenant, vehicle } = await fixture();
    const files = [await createFile("rollback.png")];
    const keys: string[] = [];
    let callbacks = 0;
    await assert.rejects(() => persist.persistNewUploadedFiles({
      tenantId: tenant.id, category: "vehicle-photos", resourceType: "VehiclePhoto", resourceId: vehicle.id, files,
      commit: async (tx, uploads) => {
        callbacks += 1;
        for (const upload of uploads) {
          keys.push(upload.key);
          assert.equal(await storage.exists(upload.key), true);
          await tx.vehiclePhoto.create({ data: {
            vehicleId: vehicle.id, filePath: upload.key, fileName: upload.file.originalname,
            mimeType: upload.file.mimetype, sizeBytes: upload.file.size
          } });
        }
        throw new Error("Synthetic callback rollback after metadata and domain writes");
      }
    }), /Synthetic callback rollback/);
    assert.equal(callbacks, 1);
    assert.equal(keys.length, 1);
    assert.equal(await prisma.vehiclePhoto.count({ where: { vehicleId: vehicle.id } }), 0);
    assert.equal(await prisma.storedFileObject.count({ where: { tenantId: tenant.id } }), 0);
    for (const key of keys) assert.equal(await storage.exists(key), false);
  });
});
