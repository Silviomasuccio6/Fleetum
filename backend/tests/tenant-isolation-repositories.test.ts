import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { PrismaAuditLogRepository } from "../src/infrastructure/repositories/prisma-audit-log-repository.js";
import { PrismaSiteRepository } from "../src/infrastructure/repositories/prisma-site-repository.js";
import { PrismaUserRepository } from "../src/infrastructure/repositories/prisma-user-repository.js";
import { PrismaVehicleRepository } from "../src/infrastructure/repositories/prisma-vehicle-repository.js";

const withPrismaModel = async <T>(
  modelName: string,
  fakeModel: Record<string, unknown>,
  run: () => Promise<T>
): Promise<T> => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(prisma, modelName);
  Object.defineProperty(prisma, modelName, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: fakeModel
  });

  try {
    return await run();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(prisma, modelName, originalDescriptor);
    } else {
      delete (prisma as unknown as Record<string, unknown>)[modelName];
    }
  }
};

test("vehicle repository scopes list/read/update/delete by tenantId", async () => {
  const calls: Array<{ method: string; args: unknown }> = [];
  const vehicle = {
    count: async (args: unknown) => {
      calls.push({ method: "count", args });
      return 0;
    },
    findMany: async (args: unknown) => {
      calls.push({ method: "findMany", args });
      return [];
    },
    findFirst: async (args: unknown) => {
      calls.push({ method: "findFirst", args });
      return { id: "vehicle-1" };
    },
    create: async (args: unknown) => {
      calls.push({ method: "create", args });
      return args;
    },
    updateMany: async (args: unknown) => {
      calls.push({ method: "updateMany", args });
      return { count: 1 };
    }
  };

  await withPrismaModel("vehicle", vehicle, async () => {
    const repository = new PrismaVehicleRepository();
    await repository.list("tenant-a", { skip: 0, take: 20 });
    await repository.findById("tenant-a", "vehicle-1");
    await repository.findByPlate("tenant-a", "AA000AA");
    await repository.create("tenant-a", { plate: "AA000AA" });
    await repository.update("tenant-a", "vehicle-1", { model: "Demo" });
    await repository.delete("tenant-a", "vehicle-1");
  });

  assert.deepEqual((calls[0]!.args as any).where, { tenantId: "tenant-a", deletedAt: null });
  assert.equal((calls[1]!.args as any).where.tenantId, "tenant-a");
  assert.deepEqual((calls[2]!.args as any).where, { id: "vehicle-1", tenantId: "tenant-a", deletedAt: null });
  assert.equal((calls[3]!.args as any).where.tenantId, "tenant-a");
  assert.equal((calls[4]!.args as any).data.tenantId, "tenant-a");
  assert.deepEqual((calls[5]!.args as any).where, { id: "vehicle-1", tenantId: "tenant-a", deletedAt: null });
  assert.deepEqual((calls[7]!.args as any).where, { id: "vehicle-1", tenantId: "tenant-a", deletedAt: null });
});

test("site repository scopes list/read/update/delete by tenantId", async () => {
  const calls: Array<{ method: string; args: unknown }> = [];
  const site = {
    count: async (args: unknown) => {
      calls.push({ method: "count", args });
      return 0;
    },
    findMany: async (args: unknown) => {
      calls.push({ method: "findMany", args });
      return [];
    },
    create: async (args: unknown) => {
      calls.push({ method: "create", args });
      return args;
    },
    updateMany: async (args: unknown) => {
      calls.push({ method: "updateMany", args });
      return { count: 1 };
    },
    findFirst: async (args: unknown) => {
      calls.push({ method: "findFirst", args });
      return { id: "site-1" };
    }
  };

  await withPrismaModel("site", site, async () => {
    const repository = new PrismaSiteRepository();
    await repository.list("tenant-a", { skip: 0, take: 20 });
    await repository.create("tenant-a", { name: "Roma" });
    await repository.update("tenant-a", "site-1", { city: "Roma" });
    await repository.delete("tenant-a", "site-1");
  });

  assert.deepEqual((calls[0]!.args as any).where, { tenantId: "tenant-a", deletedAt: null });
  assert.equal((calls[1]!.args as any).where.tenantId, "tenant-a");
  assert.equal((calls[2]!.args as any).data.tenantId, "tenant-a");
  assert.deepEqual((calls[3]!.args as any).where, { id: "site-1", tenantId: "tenant-a", deletedAt: null });
  assert.deepEqual((calls[5]!.args as any).where, { id: "site-1", tenantId: "tenant-a", deletedAt: null });
});

test("user repository tenant-scopes user management and blocks cross-tenant role updates", async () => {
  const calls: Array<{ model: string; method: string; args: unknown }> = [];
  const user = {
    findMany: async (args: unknown) => {
      calls.push({ model: "user", method: "findMany", args });
      return [];
    },
    updateMany: async (args: unknown) => {
      calls.push({ model: "user", method: "updateMany", args });
      return { count: 1 };
    },
    findFirst: async (args: unknown) => {
      calls.push({ model: "user", method: "findFirst", args });
      return null;
    }
  };
  const role = {
    findUniqueOrThrow: async (args: unknown) => {
      calls.push({ model: "role", method: "findUniqueOrThrow", args });
      return { id: "role-admin" };
    }
  };
  const userRole = {
    deleteMany: async (args: unknown) => {
      calls.push({ model: "userRole", method: "deleteMany", args });
      return { count: 1 };
    },
    create: async (args: unknown) => {
      calls.push({ model: "userRole", method: "create", args });
      return args;
    }
  };

  await withPrismaModel("user", user, async () =>
    withPrismaModel("role", role, async () =>
      withPrismaModel("userRole", userRole, async () => {
        const repository = new PrismaUserRepository();
        await repository.list("tenant-a");
        await repository.updateProfile("tenant-a", "user-1", { firstName: "Mario" });
        await repository.softDelete("tenant-a", "user-1");
        const result = await repository.setRole("tenant-a", "user-from-other-tenant", "ADMIN");
        assert.equal(result, null);
      })
    )
  );

  assert.deepEqual((calls[0]!.args as any).where, { tenantId: "tenant-a", deletedAt: null });
  assert.deepEqual((calls[1]!.args as any).where, { id: "user-1", tenantId: "tenant-a", deletedAt: null });
  assert.deepEqual((calls[3]!.args as any).where, { id: "user-1", tenantId: "tenant-a", deletedAt: null });
  assert.deepEqual((calls[4]!.args as any).where, {
    id: "user-from-other-tenant",
    tenantId: "tenant-a",
    deletedAt: null
  });
  assert.equal(calls.some((call) => call.model === "userRole"), false);
});

test("audit log repository reads and writes inside the requested tenant", async () => {
  const calls: Array<{ method: string; args: unknown }> = [];
  const auditLog = {
    count: async (args: unknown) => {
      calls.push({ method: "count", args });
      return 0;
    },
    findMany: async (args: unknown) => {
      calls.push({ method: "findMany", args });
      return [];
    },
    findFirst: async (args: unknown) => {
      calls.push({ method: "findFirst", args });
      return null;
    },
    create: async (args: unknown) => {
      calls.push({ method: "create", args });
      return args;
    }
  };

  await withPrismaModel("auditLog", auditLog, async () => {
    const repository = new PrismaAuditLogRepository();
    await repository.countByTenant("tenant-a");
    await repository.listByTenant("tenant-a", { skip: 0, take: 20 });
    await repository.listLatestByTenant("tenant-a", 10);
    await repository.getLatestByAction("tenant-a", "vehicle", "UPDATED");
    await repository.create({ tenantId: "tenant-a", action: "UPDATED", resource: "vehicle", resourceId: "vehicle-1" });
  });

  assert.deepEqual((calls[0]!.args as any).where, { tenantId: "tenant-a" });
  assert.deepEqual((calls[1]!.args as any).where, { tenantId: "tenant-a" });
  assert.deepEqual((calls[2]!.args as any).where, { tenantId: "tenant-a" });
  assert.deepEqual((calls[3]!.args as any).where, { tenantId: "tenant-a", resource: "vehicle", action: "UPDATED" });
  assert.deepEqual((calls[4]!.args as any).where, { tenantId: "tenant-a" });
  assert.equal((calls[5]!.args as any).data.tenantId, "tenant-a");
});
