import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test, { afterEach, beforeEach } from "node:test";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { persistNewBuffer, persistNewUploadedFiles } from "../src/infrastructure/storage/upload-persistence.js";
import { storageProvider } from "../src/infrastructure/storage/storage-provider.js";
import { AppError } from "../src/shared/errors/app-error.js";

const original = {
  transaction: prisma.$transaction,
  storedFileObjectCreateMany: prisma.storedFileObject.createMany,
  storedFileObjectFindMany: prisma.storedFileObject.findMany,
  writeNew: storageProvider.writeNew,
  writeNewFromFile: storageProvider.writeNewFromFile,
  delete: storageProvider.delete
};

beforeEach(() => {
  // An empty committed snapshot also keeps rollback tests independent of a database.
  (prisma.storedFileObject as any).findMany = async () => [];
});

afterEach(() => {
  (prisma as any).$transaction = original.transaction;
  (prisma.storedFileObject as any).createMany = original.storedFileObjectCreateMany;
  (prisma.storedFileObject as any).findMany = original.storedFileObjectFindMany;
  (storageProvider as any).writeNew = original.writeNew;
  (storageProvider as any).writeNewFromFile = original.writeNewFromFile;
  (storageProvider as any).delete = original.delete;
});

const installTransactionOutcome = (input: {
  acknowledgementError?: Error;
  lookupError?: Error;
  committed?: boolean;
  visibleReceipts?: (rows: any[]) => any[];
  reverseFileWrites?: boolean;
}) => {
  const pending: any[] = [];
  let committed: any[] = [];
  let lookupCount = 0;
  let tombstoneCount = 0;
  const deleted: string[] = [];
  const written: string[] = [];
  let releaseFirstWrite!: () => void;
  const secondWriteCompleted = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
  const recordWrite = async (key: string, _source?: unknown, metadata?: { originalName?: string | null }) => {
    if (input.reverseFileWrites && metadata?.originalName === "first.png") await secondWriteCompleted;
    written.push(key);
    if (input.reverseFileWrites && metadata?.originalName === "second.png") releaseFirstWrite();
  };
  (storageProvider as any).writeNew = recordWrite;
  (storageProvider as any).writeNewFromFile = recordWrite;
  (storageProvider as any).delete = async (key: string) => { deleted.push(key); };
  (prisma.storedFileObject as any).createMany = async () => {
    tombstoneCount += 1;
    return { count: 0 };
  };
  (prisma.storedFileObject as any).findMany = async ({ where }: any) => {
    lookupCount += 1;
    assert.equal(where.tenantId, "tenant_a");
    assert.equal(where.provider, storageProvider.name);
    assert.equal(where.bucket, "local");
    assert.equal(where.deletedAt, null);
    assert.equal(where.resourceType, pending[0].resourceType);
    assert.deepEqual([...where.id.in].sort(), pending.map((row) => row.id).sort());
    const keys = typeof where.storageKey === "string" ? [where.storageKey] : where.storageKey.in;
    assert.deepEqual([...keys].sort(), [...written].sort());
    if (input.lookupError) throw input.lookupError;
    return input.visibleReceipts ? input.visibleReceipts(committed) : committed;
  };
  (prisma as any).$transaction = async (callback: any) => {
    const result = await callback({
      storedFileObject: {
        create: async ({ data }: any) => {
          const stored = {
            ...data,
            id: `stored_${pending.length + 1}`,
            createdAt: new Date("2026-10-09T10:00:00.000Z"),
            deletedAt: null
          };
          pending.push(stored);
          return stored;
        },
        aggregate: async () => ({ _sum: { sizeBytes: pending.reduce((sum, row) => sum + row.sizeBytes, 0) } })
      }
    });
    // COMMIT can succeed even when its acknowledgement never reaches Prisma.
    if (input.committed !== false) committed = [...pending];
    if (input.acknowledgementError) throw input.acknowledgementError;
    return result;
  };
  return { written, deleted, get committed() { return committed; }, get lookupCount() { return lookupCount; }, get tombstoneCount() { return tombstoneCount; } };
};

test("a lost COMMIT acknowledgement preserves input order after out-of-order writes without deleting files or repeating the callback", { timeout: 10_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-upload-test-"));
  try {
    const files = await Promise.all([createFile(directory, "first.png"), createFile(directory, "second.png")]);
    const state = installTransactionOutcome({ acknowledgementError: new Error("synthetic lost COMMIT acknowledgement"), reverseFileWrites: true });
    const result = { resourceId: "vehicle_1", photoIds: ["photo_1", "photo_2"] };
    let callbacks = 0;
    const recovered = await persistNewUploadedFiles({
      tenantId: "tenant_a", category: "vehicle-photos", resourceType: "VehiclePhoto", resourceId: "vehicle_1", files,
      commit: async () => { callbacks += 1; return result; }
    });

    assert.equal(callbacks, 1);
    assert.deepEqual(recovered.result, result);
    assert.equal(recovered.uploads.length, 2);
    assert.deepEqual(recovered.uploads.map((upload) => upload.file.originalname), files.map((file) => file.originalname));
    assert.deepEqual(recovered.uploads.map((upload) => upload.key), [...state.written].reverse());
    assert.deepEqual(recovered.uploads.map((upload) => upload.storedFileObject.id), state.committed.map((row) => row.id));
    assert.ok(recovered.uploads.every((upload) => /^[a-f0-9]{64}$/.test(upload.checksumSha256)));
    assert.ok(state.lookupCount > 0);
    assert.deepEqual(state.deleted, []);
    assert.equal(state.tombstoneCount, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("an unreadable committed batch preserves physical objects and reports an uncertain upload", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-upload-test-"));
  try {
    const file = await createFile(directory, "uncertain.png");
    const state = installTransactionOutcome({
      acknowledgementError: new Error("synthetic lost COMMIT acknowledgement"),
      lookupError: new Error("synthetic metadata read outage")
    });
    await assert.rejects(() => persistNewUploadedFiles({
      tenantId: "tenant_a", category: "vehicle-photos", resourceType: "VehiclePhoto", resourceId: "vehicle_1", files: [file],
      commit: async () => ({ resourceId: "vehicle_1" })
    }), (error: unknown) => error instanceof AppError && error.statusCode === 503 && error.code === "UPLOAD_COMMIT_UNCERTAIN");
    assert.equal(state.committed.length, 1);
    assert.ok(state.lookupCount > 0);
    assert.deepEqual(state.deleted, []);
    assert.equal(state.tombstoneCount, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a lost COMMIT acknowledgement also recovers a committed buffer", async () => {
  const state = installTransactionOutcome({ acknowledgementError: new Error("synthetic lost COMMIT acknowledgement") });
  const buffer = Buffer.from("synthetic contract PDF");
  const result = await persistNewBuffer({
    tenantId: "tenant_a", category: "contracts", resourceType: "BookingContract", resourceId: "contract_1",
    originalName: "contract.pdf", mimeType: "application/pdf", buffer
  });
  assert.equal(result.key, state.written[0]);
  assert.equal(result.storedFileObjectId, state.committed[0].id);
  assert.equal(result.checksumSha256, state.committed[0].checksumSha256);
  assert.ok(state.lookupCount > 0);
  assert.deepEqual(state.deleted, []);
  assert.equal(state.tombstoneCount, 0);
});

test("an unreadable buffer commit preserves its object and reports an uncertain upload", async () => {
  const state = installTransactionOutcome({
    acknowledgementError: new Error("synthetic lost COMMIT acknowledgement"),
    lookupError: new Error("synthetic metadata read outage")
  });
  await assert.rejects(() => persistNewBuffer({
    tenantId: "tenant_a", category: "contracts", resourceType: "BookingContract", resourceId: "contract_1",
    originalName: "contract.pdf", mimeType: "application/pdf", buffer: Buffer.from("synthetic contract PDF")
  }), (error: unknown) => error instanceof AppError && error.statusCode === 503 && error.code === "UPLOAD_COMMIT_UNCERTAIN");
  assert.equal(state.committed.length, 1);
  assert.ok(state.lookupCount > 0);
  assert.deepEqual(state.deleted, []);
  assert.equal(state.tombstoneCount, 0);
});

test("an empty receipt after a completed callback preserves the batch because rollback remains unconfirmed", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-upload-test-"));
  try {
    const file = await createFile(directory, "no-receipt.png");
    const state = installTransactionOutcome({ acknowledgementError: new Error("synthetic lost COMMIT acknowledgement"), committed: false });
    let callbacks = 0;
    await assert.rejects(() => persistNewUploadedFiles({
      tenantId: "tenant_a", category: "vehicle-photos", resourceType: "VehiclePhoto", resourceId: "vehicle_1", files: [file],
      commit: async () => { callbacks += 1; return { resourceId: "vehicle_1" }; }
    }), (error: unknown) => error instanceof AppError && error.statusCode === 503 && error.code === "UPLOAD_COMMIT_UNCERTAIN");
    assert.equal(callbacks, 1);
    assert.ok(state.lookupCount > 0);
    assert.deepEqual(state.deleted, []);
    assert.equal(state.tombstoneCount, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a partial committed receipt cannot authorize success or deletion for a batch", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-upload-test-"));
  try {
    const files = await Promise.all([createFile(directory, "visible.png"), createFile(directory, "not-visible.png")]);
    const state = installTransactionOutcome({
      acknowledgementError: new Error("synthetic lost COMMIT acknowledgement"),
      visibleReceipts: (rows) => rows.slice(0, 1)
    });
    await assert.rejects(() => persistNewUploadedFiles({
      tenantId: "tenant_a", category: "vehicle-photos", resourceType: "VehiclePhoto", resourceId: "vehicle_1", files,
      commit: async () => ({ resourceId: "vehicle_1" })
    }), (error: unknown) => error instanceof AppError && error.statusCode === 503 && error.code === "UPLOAD_COMMIT_UNCERTAIN");
    assert.equal(state.committed.length, 2);
    assert.ok(state.lookupCount > 0);
    assert.deepEqual(state.deleted, []);
    assert.equal(state.tombstoneCount, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a receipt for a different metadata identity or checksum preserves the buffer and reports uncertainty", async () => {
  for (const corruptReceipt of [
    (row: any) => ({ ...row, id: "different_stored_object" }),
    (row: any) => ({ ...row, checksumSha256: "0".repeat(64) })
  ]) {
    const state = installTransactionOutcome({
      acknowledgementError: new Error("synthetic lost COMMIT acknowledgement"),
      visibleReceipts: (rows) => rows.map(corruptReceipt)
    });
    await assert.rejects(() => persistNewBuffer({
      tenantId: "tenant_a", category: "contracts", resourceType: "BookingContract", resourceId: "contract_1",
      originalName: "contract.pdf", mimeType: "application/pdf", buffer: Buffer.from("synthetic contract PDF")
    }), (error: unknown) => error instanceof AppError && error.statusCode === 503 && error.code === "UPLOAD_COMMIT_UNCERTAIN");
    assert.ok(state.lookupCount > 0);
    assert.deepEqual(state.deleted, []);
    assert.equal(state.tombstoneCount, 0);
  }
});

test("a callback rollback still compensates the uploaded object", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-upload-test-"));
  try {
    const file = await createFile(directory, "rollback.png");
    const state = installTransactionOutcome({});
    await assert.rejects(() => persistNewUploadedFiles({
      tenantId: "tenant_a", category: "vehicle-photos", resourceType: "VehiclePhoto", resourceId: "vehicle_1", files: [file],
      commit: async () => { throw new AppError("synthetic callback rejection", 409, "SYNTHETIC_CALLBACK_REJECTION"); }
    }), (error: unknown) => error instanceof AppError && error.code === "SYNTHETIC_CALLBACK_REJECTION");
    assert.deepEqual(state.committed, []);
    assert.deepEqual(state.deleted, state.written);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a serialization rollback after callback completion still compensates the uploaded object", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-upload-test-"));
  try {
    const file = await createFile(directory, "serialization.png");
    const serializationError = Object.assign(new Error("synthetic serialization rollback"), { code: "P2034" });
    const state = installTransactionOutcome({ acknowledgementError: serializationError, committed: false });
    await assert.rejects(() => persistNewUploadedFiles({
      tenantId: "tenant_a", category: "vehicle-photos", resourceType: "VehiclePhoto", resourceId: "vehicle_1", files: [file],
      commit: async () => ({ resourceId: "vehicle_1" })
    }), /synthetic serialization rollback/);
    assert.deepEqual(state.committed, []);
    assert.deepEqual(state.deleted, state.written);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

const createFile = async (directory: string, name: string): Promise<Express.Multer.File> => {
  const filePath = path.join(directory, name);
  const buffer = Buffer.from(`synthetic-${name}`);
  await fs.writeFile(filePath, buffer);
  return {
    fieldname: "files",
    originalname: name,
    encoding: "7bit",
    mimetype: "image/png",
    destination: directory,
    filename: name,
    path: filePath,
    size: buffer.length,
    buffer,
    stream: Readable.from(buffer)
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
