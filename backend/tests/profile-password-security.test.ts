import assert from "node:assert/strict";
import test, { TestContext } from "node:test";
import bcrypt from "bcryptjs";
import { ManageProfileUseCase } from "../src/application/usecases/auth/manage-profile-usecase.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";

const tenantId = "synthetic-profile-tenant";
const userId = "synthetic-profile-user";
const currentPassword = "Synthetic-Current1!";
const newPassword = "Synthetic-New1!";
const hashed = (value: string) => `synthetic-hash:${value}`;
type Status = "ACTIVE" | "INVITED" | "SUSPENDED";

// This double checks credential-transition behavior and transaction rollback.
// It does not connect to PostgreSQL or prove real row-lock interleavings.
const installStore = (t: TestContext, status: Status = "ACTIVE") => {
  let state = {
    user: { id: userId, tenantId, status, deletedAt: null as Date | null, passwordHash: hashed(currentPassword) },
    resets: [
      { userId, usedAt: null as Date | null },
      { userId, usedAt: new Date(1) as Date | null },
      { userId: "synthetic-foreign-user", usedAt: null as Date | null }
    ],
    sessions: [
      { userId, tenantId, revokedAt: null as Date | null },
      { userId, tenantId, revokedAt: new Date(1) as Date | null },
      { userId: "synthetic-foreign-user", tenantId: "synthetic-foreign-tenant", revokedAt: null as Date | null }
    ],
    audits: [] as any[]
  };
  type State = typeof state;
  const events: string[] = [];
  let beforeMutation: (() => void) | undefined;
  let failure: "reset" | "revocation" | "audit" | undefined;
  let queue = Promise.resolve();
  let inTransaction = false;
  let legacyRevocations = 0;
  let userExists = true;
  const originals = {
    findFirst: prisma.user.findFirst, update: prisma.user.update, transaction: prisma.$transaction,
    compare: bcrypt.compare, hash: bcrypt.hash
  };
  t.after(() => {
    (prisma.user as any).findFirst = originals.findFirst;
    (prisma.user as any).update = originals.update;
    (prisma as any).$transaction = originals.transaction;
    (bcrypt as any).compare = originals.compare;
    (bcrypt as any).hash = originals.hash;
  });
  const matchesUser = (user: State["user"], where: any) =>
    ["id", "tenantId", "status", "deletedAt", "passwordHash"].every((key) =>
      where[key] === undefined || (user as any)[key] === where[key]);
  const matchesSession = (session: State["sessions"][number], where: any) =>
    session.userId === where.userId && (where.tenantId === undefined || session.tenantId === where.tenantId)
    && session.revokedAt === where.revokedAt;
  const fireHook = () => {
    const hook = beforeMutation;
    beforeMutation = undefined;
    hook?.();
  };
  (prisma.user as any).findFirst = async ({ where }: any) => {
    events.push("preflight");
    return userExists && matchesUser(state.user, where) ? structuredClone(state.user) : null;
  };
  (bcrypt as any).compare = async (value: string, hash: string) => hashed(value) === hash;
  (bcrypt as any).hash = async (value: string) => {
    assert.equal(inTransaction, false, "expensive hashing must finish before taking the database lock");
    events.push("hash");
    await Promise.resolve();
    return hashed(value);
  };
  // Support the old implementation so RED reports actual stale writes and
  // partial credential changes, rather than an unsupported mock method.
  (prisma.user as any).update = async ({ data }: any) => {
    fireHook();
    events.push("unconditional-password-write");
    Object.assign(state.user, data);
    return structuredClone(state.user);
  };
  (prisma as any).$transaction = async (callback: any) => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    fireHook();
    const draft = structuredClone(state);
    let locked = false;
    inTransaction = true;
    events.push("transaction");
    const assertLocked = () => assert.equal(locked, true, "credential mutations require the shared auth user lock");
    const tx = {
      $queryRaw: async (_sql: unknown, lockId: string) => {
        assert.equal(lockId, userId);
        locked = true;
        events.push("lock-user");
        return userExists ? [{ id: userId }] : [];
      },
      user: {
        updateMany: async ({ where, data }: any) => {
          assertLocked();
          events.push("password-cas");
          assert.deepEqual(where, { id: userId, tenantId, status: "ACTIVE", deletedAt: null, passwordHash: hashed(currentPassword) });
          if (!matchesUser(draft.user, where)) return { count: 0 };
          assert.deepEqual(Object.keys(data), ["passwordHash"]);
          Object.assign(draft.user, data);
          return { count: 1 };
        }
      },
      passwordResetToken: {
        updateMany: async ({ where, data }: any) => {
          assertLocked();
          events.push("invalidate-resets");
          if (failure === "reset") throw new Error("SYNTHETIC_RESET_INVALIDATION_FAILURE");
          const rows = draft.resets.filter((row) => row.userId === where.userId && row.usedAt === where.usedAt);
          rows.forEach((row) => Object.assign(row, data));
          return { count: rows.length };
        }
      },
      refreshSession: {
        updateMany: async ({ where, data }: any) => {
          assertLocked();
          events.push("revoke-sessions");
          if (failure === "revocation") throw new Error("SYNTHETIC_REVOCATION_FAILURE");
          const rows = draft.sessions.filter((row) => matchesSession(row, where));
          rows.forEach((row) => Object.assign(row, data));
          return { count: rows.length };
        }
      },
      auditLog: {
        create: async ({ data }: any) => {
          assertLocked();
          events.push("audit-revocation");
          if (failure === "audit") throw new Error("SYNTHETIC_AUDIT_FAILURE");
          draft.audits.push(structuredClone(data));
          return data;
        }
      }
    };
    try {
      const result = await callback(tx);
      state = draft;
      return result;
    } finally { inTransaction = false; release(); }
  };
  const service = {
    revokeAll: async () => {
      legacyRevocations += 1;
      if (failure === "revocation") throw new Error("SYNTHETIC_REVOCATION_FAILURE");
      state.sessions.filter((row) => row.userId === userId && row.revokedAt === null)
        .forEach((row) => { row.revokedAt = new Date(); });
      if (failure === "audit") throw new Error("SYNTHETIC_AUDIT_FAILURE");
      return { revoked: true };
    }
  };
  return {
    get state() { return state; }, get events() { return events; }, get legacyRevocations() { return legacyRevocations; },
    beforeMutation(hook: () => void) { beforeMutation = hook; },
    fail(stage: typeof failure) { failure = stage; },
    removeUser() { userExists = false; },
    useCase: new ManageProfileUseCase({} as any, service as any)
  };
};

const change = (store: ReturnType<typeof installStore>, logoutAllDevices?: boolean, password = newPassword) =>
  store.useCase.changePassword(tenantId, userId, { currentPassword, newPassword: password, logoutAllDevices });
const conflict = (error: any) => error?.statusCode === 409 && error?.code === "CONFLICT";

test("password change keeps sessions by default, consumes old reset links and leaves foreign records untouched", async (t) => {
  const store = installStore(t);
  const sessions = structuredClone(store.state.sessions);
  const result = await change(store);
  assert.deepEqual(result, { updated: true, sessionsRevoked: false });
  assert.equal(store.state.user.passwordHash, hashed(newPassword));
  assert.deepEqual(store.state.sessions, sessions);
  assert.ok(store.state.resets[0].usedAt instanceof Date);
  assert.equal(store.state.resets[1].usedAt?.getTime(), 1);
  assert.equal(store.state.resets[2].usedAt, null);
  assert.equal(store.state.audits.length, 0);
  assert.equal(store.legacyRevocations, 0);
});

test("logoutAllDevices changes the password and revokes sessions with audit in one locked transaction", async (t) => {
  const store = installStore(t);
  assert.deepEqual(await change(store, true), { updated: true, sessionsRevoked: true });
  assert.ok(store.state.sessions[0].revokedAt instanceof Date);
  assert.equal(store.state.sessions[1].revokedAt?.getTime(), 1);
  assert.equal(store.state.sessions[2].revokedAt, null);
  assert.deepEqual(store.state.audits, [{ tenantId, userId, action: "AUTH_SESSIONS_REVOKED_ALL", resource: "auth_session", details: { count: 1 } }]);
  assert.equal(store.legacyRevocations, 0);
  assert.deepEqual(store.events, ["preflight", "hash", "transaction", "lock-user", "password-cas", "invalidate-resets", "revoke-sessions", "audit-revocation"]);
});

for (const stage of ["reset", "revocation", "audit"] as const) {
  test(`failure in ${stage} rolls back the password, reset tokens, sessions and audit`, async (t) => {
    const store = installStore(t);
    store.fail(stage);
    const before = structuredClone(store.state);
    await assert.rejects(change(store, true), (error: any) => error?.message.startsWith("SYNTHETIC_"));
    assert.deepEqual(store.state, before);
  });
}

test("an in-flight password change cannot overwrite a reset completed after old-password verification", async (t) => {
  const store = installStore(t);
  let afterReset: typeof store.state;
  store.beforeMutation(() => {
    store.state.user.passwordHash = hashed("Synthetic-Reset-Winner1!");
    store.state.resets[0].usedAt = new Date(2);
    store.state.sessions[0].revokedAt = new Date(2);
    afterReset = structuredClone(store.state);
  });
  await assert.rejects(change(store, true), conflict);
  assert.deepEqual(store.state, afterReset!);
});

for (const race of ["suspension", "deletion", "tenant-change", "missing-user"] as const) {
  test(`password change rejects a concurrent ${race} without writing credentials or sessions`, async (t) => {
    const store = installStore(t);
    let afterRace: typeof store.state;
    store.beforeMutation(() => {
      if (race === "suspension") store.state.user.status = "SUSPENDED";
      if (race === "deletion") store.state.user.deletedAt = new Date(2);
      if (race === "tenant-change") store.state.user.tenantId = "synthetic-other-tenant";
      if (race === "missing-user") store.removeUser();
      afterRace = structuredClone(store.state);
    });
    await assert.rejects(change(store, true), conflict);
    assert.deepEqual(store.state, afterRace!);
  });
}

test("two requests verified against one old password allow only one credential transition", async (t) => {
  const store = installStore(t);
  const outcomes = await Promise.allSettled([change(store, false), change(store, false, "Synthetic-Other-New1!")]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  const loser = outcomes.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(conflict(loser.reason));
  assert.ok([hashed(newPassword), hashed("Synthetic-Other-New1!")].includes(store.state.user.passwordHash));
  assert.equal(store.state.sessions[0].revokedAt, null);
});

for (const status of ["SUSPENDED", "INVITED"] as const) {
  test(`a ${status} account cannot change its password or receive a state transition`, async (t) => {
    const store = installStore(t, status);
    const before = structuredClone(store.state);
    await assert.rejects(change(store, true), (error: any) => error?.statusCode === 404 && error?.code === "NOT_FOUND");
    assert.deepEqual(store.state, before);
    assert.deepEqual(store.events, ["preflight"]);
  });
}

test("wrong current password and identical new password keep the existing validation behavior", async (t) => {
  const store = installStore(t);
  const before = structuredClone(store.state);
  await assert.rejects(store.useCase.changePassword(tenantId, userId, { currentPassword: "Synthetic-Wrong1!", newPassword }),
    (error: any) => error?.statusCode === 400 && error?.code === "VALIDATION_ERROR");
  await assert.rejects(change(store, true, currentPassword),
    (error: any) => error?.statusCode === 400 && error?.code === "VALIDATION_ERROR");
  assert.deepEqual(store.state, before);
  assert.deepEqual(store.events, ["preflight", "preflight"]);
});
