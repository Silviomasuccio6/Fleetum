import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { persistNewUploadedFiles } from "../src/infrastructure/storage/upload-persistence.js";
import { storageProvider } from "../src/infrastructure/storage/storage-provider.js";
import { AppError } from "../src/shared/errors/app-error.js";

const original = {
  transaction: prisma.$transaction,
  storedFileObjectCreateMany: prisma.storedFileObject.createMany,
  writeNewFromFile: storageProvider.writeNewFromFile,
  delete: storageProvider.delete
};

afterEach(() => {
  (prisma as any).$transaction = original.transaction;
  (prisma.storedFileObject as any).createMany = original.storedFileObjectCreateMany;
  (storageProvider as any).writeNewFromFile = original.writeNewFromFile;
  (storageProvider as any).delete = original.delete;
});

const createFile = async (directory: string, name: string): Promise<Express.Multer.File> => {
  const filePath = path.join(directory, name);
  await fs.writeFile(filePath, `synthetic-${name}`);
  return {
    fieldname: "files",
    originalname: name,
    encoding: "7bit",
    mimetype: "image/png",
    destination: directory,
    filename: name,
    path: filePath,
    size: Buffer.byteLength(`synthetic-${name}`)
  };
};

test("a partial batch write failure removes every object already created", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-upload-test-"));
  try {
    const files = await Promise.all([
      createFile(directory, "valid.png"),
      createFile(directory, "invalid.png")
    ]);
    const written: string[] = [];
    const deleted: string[] = [];
    let transactionCalled = false;

    (storageProvider as any).writeNewFromFile = async (key: string, _filePath: string, metadata: any) => {
      if (metadata.originalName === "invalid.png") throw new Error("synthetic storage failure");
      written.push(key);
    };
    (storageProvider as any).delete = async (key: string) => {
      deleted.push(key);
    };
    (prisma as any).$transaction = async () => {
      transactionCalled = true;
    };

    await assert.rejects(() => persistNewUploadedFiles({
      tenantId: "tenant_a",
      category: "vehicle-photos",
      resourceType: "VehiclePhoto",
      resourceId: "vehicle_1",
      files,
      commit: async () => undefined
    }), /synthetic storage failure/);

    assert.equal(written.length, 1);
    assert.deepEqual(deleted, written);
    assert.equal(transactionCalled, false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a database failure compensates every new tenant object", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-upload-test-"));
  try {
    const file = await createFile(directory, "vehicle.png");
    const written: string[] = [];
    const deleted: string[] = [];

    (storageProvider as any).writeNewFromFile = async (key: string) => {
      written.push(key);
    };
    (storageProvider as any).delete = async (key: string) => {
      deleted.push(key);
    };
    (prisma as any).$transaction = async () => {
      throw new Error("synthetic database failure");
    };

    await assert.rejects(() => persistNewUploadedFiles({
      tenantId: "tenant_a",
      category: "vehicle-photos",
      resourceType: "VehiclePhoto",
      resourceId: "vehicle_1",
      files: [file],
      commit: async () => undefined
    }), /synthetic database failure/);

    assert.equal(written.length, 1);
    assert.match(written[0] ?? "", /(?:^|\/)tenants\/tenant_a\/vehicle-photos\//);
    assert.deepEqual(deleted, written);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a failed physical compensation records a soft-deleted tombstone for retry", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-upload-test-"));
  try {
    const file = await createFile(directory, "retry.png");
    const written: string[] = [];
    let tombstones: any[] = [];

    (storageProvider as any).writeNewFromFile = async (key: string) => written.push(key);
    (storageProvider as any).delete = async () => {
      throw new Error("synthetic storage outage");
    };
    (prisma as any).$transaction = async () => {
      throw new Error("synthetic database failure");
    };
    (prisma.storedFileObject as any).createMany = async (input: any) => {
      tombstones = input.data;
      return { count: tombstones.length };
    };

    await assert.rejects(() => persistNewUploadedFiles({
      tenantId: "tenant_a",
      category: "vehicle-photos",
      resourceType: "VehiclePhoto",
      resourceId: "vehicle_1",
      files: [file],
      commit: async () => undefined
    }), /synthetic database failure/);

    assert.equal(written.length, 1);
    assert.equal(tombstones.length, 1);
    assert.equal(tombstones[0].storageKey, written[0]);
    assert.equal(tombstones[0].tenantId, "tenant_a");
    assert.ok(tombstones[0].deletedAt instanceof Date);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("tenant quota rejection rolls back metadata and compensates the new object", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-upload-test-"));
  try {
    const file = await createFile(directory, "quota.png");
    const written: string[] = [];
    const deleted: string[] = [];

    (storageProvider as any).writeNewFromFile = async (key: string) => written.push(key);
    (storageProvider as any).delete = async (key: string) => deleted.push(key);
    (prisma as any).$transaction = async (callback: any) => callback({
      storedFileObject: {
        create: async () => ({
          id: "stored_1",
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          createdAt: new Date(),
          visibility: "private"
        }),
        aggregate: async () => ({ _sum: { sizeBytes: Number.MAX_SAFE_INTEGER } })
      }
    });

    await assert.rejects(
      () => persistNewUploadedFiles({
        tenantId: "tenant_a",
        category: "vehicle-photos",
        resourceType: "VehiclePhoto",
        resourceId: "vehicle_1",
        files: [file],
        commit: async () => undefined
      }),
      (error: unknown) => error instanceof AppError && error.code === "TENANT_STORAGE_QUOTA_EXCEEDED"
    );

    assert.deepEqual(deleted, written);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
