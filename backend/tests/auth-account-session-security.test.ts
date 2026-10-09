import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import jwt from "jsonwebtoken";
import { AuthSessionService } from "../src/application/services/auth-session-service.js";
import { RequestPasswordResetUseCase } from "../src/application/usecases/auth/request-password-reset-usecase.js";
import { ResetPasswordUseCase } from "../src/application/usecases/auth/reset-password-usecase.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { requireAuth } from "../src/interfaces/http/middlewares/auth.js";
import { requireJsonBody } from "../src/interfaces/http/middlewares/require-json-body.js";
import { authRoutes } from "../src/interfaces/http/routes/auth-routes.js";
import { env } from "../src/shared/config/env.js";

const syntheticUser = (status: "ACTIVE" | "INVITED" | "SUSPENDED" = "ACTIVE") => ({
  id: "synthetic-user",
  tenantId: "synthetic-tenant",
  email: "account@example.invalid",
  firstName: "Account",
  lastName: "Security",
  passwordHash: "synthetic-hash",
  status,
  deletedAt: null,
  roles: [
    {
      role: {
        key: "VIEWER",
        permissions: [{ permission: { key: "vehicles:read" } }]
      }
    }
  ]
});

test("cookie-issuing password endpoints reject form posts and are wired to require JSON", () => {
  let receivedError: unknown;
  requireJsonBody(
    { is: () => false } as any,
    {} as any,
    (error?: unknown) => {
      receivedError = error;
    }
  );
  assert.equal((receivedError as any)?.statusCode, 415);
  assert.equal((receivedError as any)?.code, "JSON_CONTENT_TYPE_REQUIRED");

  let jsonNextCalled = false;
  requireJsonBody(
    { is: (type: string) => type === "application/json" } as any,
    {} as any,
    (error?: unknown) => {
      assert.equal(error, undefined);
      jsonNextCalled = true;
    }
  );
  assert.equal(jsonNextCalled, true);

  const controller = new Proxy(
    {},
    {
      get: () => async () => undefined
    }
  );
  const router = authRoutes(controller as any) as any;
  for (const path of ["/signup", "/login", "/refresh"]) {
    const route = router.stack.find((layer: any) => layer.route?.path === path)?.route;
    assert.ok(route, `Missing auth route ${path}`);
    assert.ok(
      route.stack.some((layer: any) => layer.handle === requireJsonBody),
      `${path} must require application/json before issuing cookies`
    );
    assert.equal(
      route.stack[0].handle,
      requireJsonBody,
      `${path} must reject non-JSON forms before consuming authentication rate-limit budget`
    );
  }
  const appleCallback = router.stack.find((layer: any) => layer.route?.path === "/apple/callback")?.route;
  assert.ok(appleCallback, "Missing Apple callback route");
  assert.equal(
    appleCallback.stack.some((layer: any) => layer.handle === requireJsonBody),
    false,
    "Apple form_post callback must remain compatible with application/x-www-form-urlencoded"
  );
});

test("SEC-01: password reset requests ignore suspended and invited users without revealing account state", async (t) => {
  const originalFindMany = prisma.user.findMany;
  const originalCreate = prisma.passwordResetToken.create;
  t.after(() => {
    (prisma.user as any).findMany = originalFindMany;
    (prisma.passwordResetToken as any).create = originalCreate;
  });

  let queued = 0;
  let created = 0;
  (prisma.user as any).findMany = async (args: any) => {
    assert.equal(args.where.status, "ACTIVE");
    return [];
  };
  (prisma.passwordResetToken as any).create = async () => {
    created += 1;
    return { id: "unexpected-reset" };
  };

  const result = await new RequestPasswordResetUseCase({
    enqueue: async () => {
      queued += 1;
    }
  } as any).execute("account@example.invalid");

  assert.deepEqual(result, { accepted: true });
  assert.equal(created, 0);
  assert.equal(queued, 0);
});

test("SEC-01: a reset issued before suspension cannot change the password or reactivate the user", async (t) => {
  const originalFindFirst = prisma.passwordResetToken.findFirst;
  const originalUserUpdate = prisma.user.update;
  const originalTokenUpdate = prisma.passwordResetToken.update;
  const originalTransaction = prisma.$transaction;
  t.after(() => {
    (prisma.passwordResetToken as any).findFirst = originalFindFirst;
    (prisma.user as any).update = originalUserUpdate;
    (prisma.passwordResetToken as any).update = originalTokenUpdate;
    (prisma as any).$transaction = originalTransaction;
  });

  const user = syntheticUser("SUSPENDED");
  const record = {
    id: "synthetic-reset",
    userId: user.id,
    tokenHash: "synthetic-token-hash",
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user
  };
  let userWrites = 0;

  const findRecord = async (args: any) => {
    const requiredStatus = args?.where?.user?.is?.status ?? args?.where?.user?.status;
    if (requiredStatus === "ACTIVE" && user.status !== "ACTIVE") return null;
    return record;
  };
  (prisma.passwordResetToken as any).findFirst = findRecord;
  (prisma.user as any).update = async () => {
    userWrites += 1;
    return user;
  };
  (prisma.passwordResetToken as any).update = async () => record;
  (prisma as any).$transaction = async (input: any) => {
    if (typeof input === "function") {
      return input({
        passwordResetToken: { findFirst: findRecord },
        user: { updateMany: async () => ({ count: 0 }) },
        refreshSession: { updateMany: async () => ({ count: 0 }) }
      });
    }
    return Promise.all(input);
  };

  await assert.rejects(
    new ResetPasswordUseCase().execute({ token: "synthetic-reset-value", newPassword: "synthetic-new-password" }),
    (error: any) => error?.code === "INVALID_TOKEN"
  );
  assert.equal(user.status, "SUSPENDED");
  assert.equal(userWrites, 0);
});

test("SEC-02: reset consumption, password update, pending-token invalidation and session revocation share one transaction", async (t) => {
  const originalFindFirst = prisma.passwordResetToken.findFirst;
  const originalTransaction = prisma.$transaction;
  t.after(() => {
    (prisma.passwordResetToken as any).findFirst = originalFindFirst;
    (prisma as any).$transaction = originalTransaction;
  });

  const user = syntheticUser("ACTIVE");
  const record = {
    id: "current-reset",
    userId: user.id,
    tokenHash: "synthetic-token-hash",
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user
  };
  const operations: Array<{ operation: string; args: any }> = [];

  (prisma.passwordResetToken as any).findFirst = async (args: any) => {
    assert.equal(args.where.user.is.status, "ACTIVE");
    assert.equal(args.where.user.is.deletedAt, null);
    return record;
  };

  const tx = {
    $queryRaw: async () => {
      operations.push({ operation: "lock-user", args: { userId: user.id } });
      return [{ id: user.id }];
    },
    passwordResetToken: {
      updateMany: async (args: any) => {
        operations.push({ operation: args.where.id === record.id ? "consume-reset" : "invalidate-other-resets", args });
        return { count: args.where.id === record.id ? 1 : 2 };
      }
    },
    user: {
      updateMany: async (args: any) => {
        operations.push({ operation: "update-password", args });
        return { count: 1 };
      }
    },
    refreshSession: {
      updateMany: async (args: any) => {
        operations.push({ operation: "revoke-sessions", args });
        return { count: 3 };
      }
    }
  };

  (prisma as any).$transaction = async (input: any) => {
    assert.equal(typeof input, "function");
    return input(tx);
  };

  const result = await new ResetPasswordUseCase().execute({
    token: "synthetic-reset-value",
    newPassword: "synthetic-new-password"
  });

  assert.deepEqual(result, { success: true });
  assert.deepEqual(
    operations.map(({ operation }) => operation),
    ["lock-user", "consume-reset", "update-password", "invalidate-other-resets", "revoke-sessions"]
  );

  const passwordWrite = operations.find(({ operation }) => operation === "update-password")!.args;
  assert.equal(passwordWrite.where.status, "ACTIVE");
  assert.equal(passwordWrite.where.deletedAt, null);
  assert.equal("status" in passwordWrite.data, false);

  const tokenInvalidation = operations.find(({ operation }) => operation === "invalidate-other-resets")!.args;
  assert.equal(tokenInvalidation.where.userId, user.id);
  assert.deepEqual(tokenInvalidation.where.id, { not: record.id });

  const sessionRevocation = operations.find(({ operation }) => operation === "revoke-sessions")!.args;
  assert.deepEqual(sessionRevocation.where, { userId: user.id, revokedAt: null });
});

test("SEC-02: a password login verified before reset cannot create a session with the stale hash", async (t) => {
  const originalTransaction = prisma.$transaction;
  t.after(() => {
    (prisma as any).$transaction = originalTransaction;
  });

  const user = syntheticUser("ACTIVE");
  let sessionWrites = 0;
  const tx = {
    $queryRaw: async () => [{ id: user.id }],
    user: {
      findFirst: async () => ({ passwordHash: "hash-written-by-password-reset" })
    },
    refreshSession: {
      create: async () => {
        sessionWrites += 1;
        return { id: "unexpected-session" };
      }
    },
    auditLog: { create: async () => ({}) }
  };
  (prisma as any).$transaction = async (input: any) => input(tx);

  const service = new AuthSessionService(
    { signAccess: () => "synthetic-access-token" } as any,
    {} as any
  );
  await assert.rejects(
    () =>
      service.createSession({
        userId: user.id,
        tenantId: user.tenantId,
        roles: ["VIEWER"],
        permissions: ["vehicles:read"],
        expectedPasswordHash: "hash-verified-before-password-reset"
      }),
    (error: any) => error?.code === "UNAUTHORIZED"
  );
  assert.equal(sessionWrites, 0);
});

test("SEC-05: concurrent use of one refresh token creates at most one active successor", async (t) => {
  const originalFindUnique = prisma.refreshSession.findUnique;
  const originalUpdate = prisma.refreshSession.update;
  const originalTransaction = prisma.$transaction;
  const originalAuditCreate = prisma.auditLog.create;
  t.after(() => {
    (prisma.refreshSession as any).findUnique = originalFindUnique;
    (prisma.refreshSession as any).update = originalUpdate;
    (prisma as any).$transaction = originalTransaction;
    (prisma.auditLog as any).create = originalAuditCreate;
  });

  const user = syntheticUser("ACTIVE");
  const current: any = {
    id: "old-session",
    userId: user.id,
    tenantId: user.tenantId,
    tokenHash: "synthetic-token-hash",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    replacedById: null
  };
  const successors: Array<{ id: string; revokedAt: Date | null }> = [];
  const auditActions: string[] = [];

  (prisma.refreshSession as any).findUnique = async () => ({ ...current });
  (prisma.refreshSession as any).update = async ({ data }: any) => Object.assign(current, data);
  (prisma.auditLog as any).create = async () => ({});

  const tx = {
    $queryRaw: async () => [{ id: user.id }],
    refreshSession: {
      findUnique: async () => ({ ...current }),
      updateMany: async () => {
        if (current.revokedAt) return { count: 0 };
        current.revokedAt = new Date();
        return { count: 1 };
      },
      create: async () => {
        const successor = { id: `successor-${successors.length + 1}`, revokedAt: null };
        successors.push(successor);
        return successor;
      },
      update: async ({ data }: any) => Object.assign(current, data)
    },
    user: {
      findFirst: async () => user
    },
    auditLog: {
      create: async ({ data }: any) => {
        auditActions.push(data.action);
        return {};
      }
    }
  };
  (prisma as any).$transaction = async (input: any) => {
    assert.equal(typeof input, "function");
    return input(tx);
  };

  const service = new AuthSessionService(
    { signAccess: () => "synthetic-access-token" } as any,
    { findById: async () => ({ ...user, roles: ["VIEWER"], permissions: ["vehicles:read"] }) } as any
  );

  // Force both calls through the vulnerable pre-fix create-before-revoke window.
  let createEntrants = 0;
  let releaseCreates!: () => void;
  const bothCreating = new Promise<void>((resolve) => {
    releaseCreates = resolve;
  });
  (service as any).createSession = async () => {
    createEntrants += 1;
    if (createEntrants === 2) releaseCreates();
    await bothCreating;
    const successor = { id: `legacy-successor-${successors.length + 1}`, revokedAt: null };
    successors.push(successor);
    return {
      sessionId: successor.id,
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      refreshExpiresAt: new Date(Date.now() + 60_000).toISOString()
    };
  };

  const results = await Promise.allSettled([
    service.refresh("synthetic-refresh-token"),
    service.refresh("synthetic-refresh-token")
  ]);

  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  assert.equal(successors.length, 1);
  assert.equal(successors[0]?.revokedAt, null);
  assert.equal(current.replacedById, successors[0]?.id);

  await assert.rejects(service.refresh("synthetic-refresh-token"), (error: any) => error?.code === "UNAUTHORIZED");
  assert.equal(successors[0]?.revokedAt, null);
  assert.ok(auditActions.includes("SECURITY_ALERT_REFRESH_REUSE"));
});

test("SEC-04: logout revokes a successor created by a concurrent refresh", async (t) => {
  const originalTransaction = prisma.$transaction;
  t.after(() => {
    (prisma as any).$transaction = originalTransaction;
  });

  const user = syntheticUser("ACTIVE");
  const chain = new Map<string, {
    id: string;
    tenantId: string;
    replacedById: string | null;
    revokedAt: Date | null;
  }>([
    ["session-old", { id: "session-old", tenantId: user.tenantId, replacedById: "session-new", revokedAt: new Date() }],
    ["session-new", { id: "session-new", tenantId: user.tenantId, replacedById: null, revokedAt: null }]
  ]);
  const auditActions: string[] = [];
  const tx = {
    $queryRaw: async () => [{ id: user.id }],
    refreshSession: {
      findFirst: async ({ where }: any) => chain.get(where.id) ?? null,
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const id of where.id.in as string[]) {
          const session = chain.get(id);
          if (session && !session.revokedAt) {
            session.revokedAt = data.revokedAt;
            count += 1;
          }
        }
        return { count };
      }
    },
    auditLog: {
      create: async ({ data }: any) => {
        auditActions.push(data.action);
        assert.equal(data.details.count, 1);
        return {};
      }
    }
  };
  (prisma as any).$transaction = async (input: any) => input(tx);

  const service = new AuthSessionService({} as any, {} as any);
  await service.revokeCurrent("session-old", user.id);

  assert.ok(chain.get("session-old")?.revokedAt);
  assert.ok(chain.get("session-new")?.revokedAt);
  assert.deepEqual(auditActions, ["AUTH_SESSION_REVOKED_CURRENT"]);
});

test("SEC-04: tenant access uses the active server-side session and current database authorization", async (t) => {
  const originalFindFirst = prisma.refreshSession.findFirst;
  t.after(() => {
    (prisma.refreshSession as any).findFirst = originalFindFirst;
  });

  const user = syntheticUser("ACTIVE");
  let sessionActive = true;
  (prisma.refreshSession as any).findFirst = async (args: any) => {
    assert.equal(args.where.id, "active-session");
    assert.equal(args.where.userId, user.id);
    assert.equal(args.where.tenantId, user.tenantId);
    assert.equal(args.where.user.is.status, "ACTIVE");
    assert.equal(args.where.user.is.deletedAt, null);
    return sessionActive && user.status === "ACTIVE"
      ? { id: "active-session", userId: user.id, tenantId: user.tenantId, user }
      : null;
  };

  const token = jwt.sign(
    {
      userId: user.id,
      tenantId: user.tenantId,
      roles: ["ADMIN"],
      permissions: ["users:write"],
      tokenType: "access",
      sessionId: "active-session"
    },
    env.JWT_SECRET,
    { expiresIn: "15m" }
  );
  const req = { headers: { authorization: `Bearer ${token}` } } as any;
  let nextError: any;

  await requireAuth(req, {} as any, (error?: unknown) => {
    nextError = error;
  });

  assert.equal(nextError, undefined);
  assert.deepEqual(req.auth.roles, ["VIEWER"]);
  assert.deepEqual(req.auth.permissions, ["vehicles:read"]);

  user.status = "SUSPENDED";
  const suspendedReq = { headers: { authorization: `Bearer ${token}` } } as any;
  await requireAuth(suspendedReq, {} as any, (error?: unknown) => {
    nextError = error;
  });
  assert.equal(nextError?.statusCode, 401);
  assert.equal(nextError?.code, "UNAUTHORIZED");

  user.status = "ACTIVE";
  sessionActive = false;
  const revokedReq = { headers: { authorization: `Bearer ${token}` } } as any;
  await requireAuth(revokedReq, {} as any, (error?: unknown) => {
    nextError = error;
  });
  assert.equal(nextError?.statusCode, 401);
  assert.equal(nextError?.code, "UNAUTHORIZED");

  const databaseError = new Error("synthetic database outage");
  (prisma.refreshSession as any).findFirst = async () => {
    throw databaseError;
  };
  const outageReq = { headers: { authorization: `Bearer ${token}` } } as any;
  await requireAuth(outageReq, {} as any, (error?: unknown) => {
    nextError = error;
  });
  assert.equal(nextError, databaseError);

  const legacyToken = jwt.sign(
    {
      userId: user.id,
      tenantId: user.tenantId,
      roles: ["VIEWER"],
      permissions: ["vehicles:read"],
      tokenType: "access"
    },
    env.JWT_SECRET,
    { expiresIn: "15m" }
  );
  const legacyReq = { headers: { authorization: `Bearer ${legacyToken}` } } as any;
  await requireAuth(legacyReq, {} as any, (error?: unknown) => {
    nextError = error;
  });
  assert.equal(nextError?.statusCode, 401);
});

test("SEC-04: session list keeps every active session visible ahead of rotation history", async (t) => {
  const originalTransaction = prisma.$transaction;
  t.after(() => {
    (prisma as any).$transaction = originalTransaction;
  });

  const oldActive = {
    id: "active-session-created-before-many-refreshes",
    userAgent: "older-device",
    ipAddress: "127.0.0.1",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    expiresAt: new Date("2026-10-01T00:00:00.000Z"),
    revokedAt: null
  };
  const recentRevoked = {
    ...oldActive,
    id: "recent-revoked-predecessor",
    createdAt: new Date("2026-09-10T00:00:00.000Z"),
    revokedAt: new Date("2026-09-10T00:01:00.000Z")
  };
  const queries: any[] = [];
  (prisma as any).$transaction = async (operation: any, options: any) => {
    assert.equal(options.isolationLevel, Prisma.TransactionIsolationLevel.RepeatableRead);
    return operation({
      refreshSession: {
        findMany: async (args: any) => {
          queries.push(args);
          return args.where.revokedAt === null ? [oldActive] : [recentRevoked];
        }
      }
    });
  };

  const service = new AuthSessionService({} as any, {} as any);
  const result = await service.list("synthetic-user");

  assert.deepEqual(
    result.data.map(({ id }) => id),
    [oldActive.id, recentRevoked.id]
  );
  assert.equal(queries[0].where.revokedAt, null);
  assert.ok(queries[0].where.expiresAt.gt instanceof Date);
  assert.equal("take" in queries[0], false, "All active sessions must remain individually revocable");
  assert.equal(queries[1].take, 19);
  assert.deepEqual(queries[1].where.OR[0], { revokedAt: { not: null } });
  assert.ok(queries[1].where.OR[1].expiresAt.lte instanceof Date);
});
