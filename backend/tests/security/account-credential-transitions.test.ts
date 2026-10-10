import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { after, before, describe, it } from "node:test";
import { AcceptInviteUseCase } from "../../src/application/usecases/auth/accept-invite-usecase.js";
import { ManageProfileUseCase } from "../../src/application/usecases/auth/manage-profile-usecase.js";
import { ResetPasswordUseCase } from "../../src/application/usecases/auth/reset-password-usecase.js";
import { AuthSessionService } from "../../src/application/services/auth-session-service.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";

const rawPassword = "Synthetic-original-password-20261006";
const replacement = "Synthetic-replacement-password-20261006";
const resetPassword = "Synthetic-reset-password-20261006";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const tenants: string[] = [];
let oldHash: string;
const invites = new AcceptInviteUseCase();
const profile = new ManageProfileUseCase({} as any, {
  revokeAll: async () => { throw new Error("Revocation must be inside the credential transaction"); }
} as any);

async function fixture(status: "INVITED" | "ACTIVE" | "SUSPENDED" = "INVITED", deleted = false) {
  const tenant = await prisma.tenant.create({ data: { name: `Synthetic credential transition ${randomUUID()}` } });
  tenants.push(tenant.id);
  const user = await prisma.user.create({ data: {
    tenantId: tenant.id, email: `${randomUUID()}@example.invalid`, firstName: "Synthetic", lastName: "Credential",
    status, deletedAt: deleted ? new Date() : null, passwordHash: oldHash
  } });
  const token = randomUUID();
  const invitation = await prisma.invitationToken.create({ data: { userId: user.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + 60000) } });
  const sibling = await prisma.invitationToken.create({ data: { userId: user.id, tokenHash: hash(randomUUID()), expiresAt: new Date(Date.now() + 60000) } });
  const reset = await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hash(randomUUID()), expiresAt: new Date(Date.now() + 60000) } });
  const refresh = await prisma.refreshSession.create({ data: { userId: user.id, tenantId: tenant.id, tokenHash: hash(randomUUID()), expiresAt: new Date(Date.now() + 60000) } });
  return { tenantId: tenant.id, userId: user.id, token, invitationId: invitation.id, siblingId: sibling.id, resetId: reset.id, refreshId: refresh.id };
}
async function state(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    user: await prisma.user.findUniqueOrThrow({ where: { id: f.userId } }),
    invitations: await prisma.invitationToken.findMany({ where: { userId: f.userId }, orderBy: { id: "asc" } }),
    resets: await prisma.passwordResetToken.findMany({ where: { userId: f.userId }, orderBy: { id: "asc" } }),
    sessions: await prisma.refreshSession.findMany({ where: { userId: f.userId }, orderBy: { id: "asc" } })
  };
}
async function failRevocation(run: () => Promise<unknown>) {
  const original = prisma.$transaction;
  (prisma as any).$transaction = async (callback: any, options: any) => original.call(prisma, async (tx: any) => callback(new Proxy(tx, {
    get(target, key) {
      if (key === "refreshSession") return { ...target.refreshSession, updateMany: async () => { throw new Error("Synthetic revocation failure"); } };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    }
  })), options);
  try { await assert.rejects(run, /Synthetic revocation failure/); }
  finally { (prisma as any).$transaction = original; }
}
async function afterLookup(delegate: "user" | "invitationToken", run: () => Promise<unknown>, change: () => Promise<unknown>) {
  const target = prisma[delegate] as any; const original = target.findFirst; let changed = false;
  target.findFirst = async (...args: any[]) => {
    const found = await original.apply(target, args);
    if (found && !changed) { changed = true; await change(); }
    return found;
  };
  try { await run(); assert(changed, "Race injection must execute after a real database lookup"); }
  finally { target.findFirst = original; }
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
async function waitFor<T>(promise: Promise<T>, label: string, timeout = 3000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out coordinating ${label}`)), timeout);
      })
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

// Both queries are real PostgreSQL reads. Neither operation may proceed to
// hashing/mutation until both have observed the initial credential state.
async function pairedPreflight(
  delegate: "user" | "invitationToken",
  matches: (args: any) => boolean,
  assertInitial: (found: any) => void,
  operations: Array<() => Promise<unknown>>
) {
  const target = prisma[delegate] as any;
  const original = target.findFirst;
  const bothRead = deferred();
  let reads = 0;
  target.findFirst = async (...args: any[]) => {
    const found = await original.apply(target, args);
    if (matches(args[0])) {
      try { assertInitial(found); }
      catch (error) { bothRead.resolve(); throw error; }
      reads += 1;
      if (reads === operations.length) bothRead.resolve();
      await waitFor(bothRead.promise, "both real credential preflight reads");
    }
    return found;
  };
  try {
    const results = await Promise.allSettled(operations.map((operation) => operation()));
    assert.equal(reads, operations.length, "Every competing request must have read the initial state");
    return results;
  } finally { bothRead.resolve(); target.findFirst = original; }
}

// Instrument only scheduling: the first real User FOR UPDATE remains held
// while the second transaction is proven blocked on that PostgreSQL backend.
async function orderedUserLocks(userId: string, first: () => Promise<unknown>, second: () => Promise<unknown>) {
  const originalTransaction = prisma.$transaction;
  const firstLocked = deferred();
  const secondAttempted = deferred();
  const releaseFirst = deferred();
  let transactions = 0;
  let firstPid = 0;
  let secondPid = 0;
  let observedWaiter = false;
  (prisma as any).$transaction = async (callback: any, options: any) => {
    if (typeof callback !== "function") return (originalTransaction as any).call(prisma, callback, options);
    const ordinal = ++transactions;
    return (originalTransaction as any).call(prisma, async (tx: any) => callback(new Proxy(tx, {
      get(target, key) {
        if (key !== "$queryRaw") {
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (...args: any[]) => {
          const sql = Array.isArray(args[0]) ? args[0].join(" ") : String(args[0]?.sql ?? "");
          const authLock = /FROM\s+"User"/.test(sql) && /FOR\s+UPDATE/.test(sql) && args.includes(userId);
          const queryRaw = target.$queryRaw.bind(target);
          if (authLock && ordinal === 2) {
            const pids = await queryRaw`SELECT pg_backend_pid()::integer AS pid`;
            secondPid = pids[0].pid;
            secondAttempted.resolve();
          }
          const rows = await queryRaw(...args);
          if (authLock && ordinal === 1) {
            assert.equal(rows.length, 1, "The first operation must actually acquire its user row lock");
            const pids = await queryRaw`SELECT pg_backend_pid()::integer AS pid`;
            firstPid = pids[0].pid;
            firstLocked.resolve();
            await waitFor(releaseFirst.promise, "release of the first real user lock", 6000);
          }
          return rows;
        };
      }
    })), { ...options, timeout: 7000 });
  };
  // Observe rejections immediately so coordination failures cannot create an
  // unhandled promise while finally releases locks and restores instrumentation.
  const settle = (operation: () => Promise<unknown>) => operation().then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason) => ({ status: "rejected" as const, reason })
  );
  let firstResult: ReturnType<typeof settle> | undefined;
  let secondResult: ReturnType<typeof settle> | undefined;
  try {
    firstResult = settle(first);
    await waitFor(firstLocked.promise, "the first credential operation holding User FOR UPDATE");
    secondResult = settle(second);
    await waitFor(secondAttempted.promise, "the second credential operation attempting User FOR UPDATE");
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      const waiters = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity AS activity
          WHERE activity.datname = current_database()
            AND activity.pid = ${secondPid}::integer
            AND activity.wait_event_type = 'Lock'
            AND activity.query LIKE '%"User"%'
            AND ${firstPid}::integer = ANY(pg_blocking_pids(activity.pid))
        ) AS waiting
      `;
      if (waiters[0]?.waiting) { observedWaiter = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(observedWaiter, true, "The second PostgreSQL operation must wait on the first user's real row lock");
    releaseFirst.resolve();
    return await waitFor(Promise.all([firstResult, secondResult]), "both credential transactions completing", 8000);
  } finally {
    releaseFirst.resolve();
    (prisma as any).$transaction = originalTransaction;
    const pending = [firstResult, secondResult].filter((result) => result !== undefined);
    if (pending.length) await waitFor(Promise.all(pending), "credential coordination cleanup", 8000);
  }
}

describe("atomic invitation and profile credential transitions on synthetic PostgreSQL", () => {
  before(async () => {
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(process.env.DOTENV_CONFIG_PATH, "/dev/null");
    assert.equal(process.env.RUN_TENANT_ISOLATION_TESTS, "1");
    const url = new URL(process.env.DATABASE_URL!);
    assert(url.hostname === "127.0.0.1" && url.pathname === "/fleetum_ci" && url.username === "fleetum" && url.port);
    await prisma.$connect(); oldHash = await bcrypt.hash(rawPassword, 12);
  });
  after(async () => {
    for (const tenantId of tenants) {
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      const users = await prisma.user.findMany({ where: { tenantId }, select: { id: true } });
      const userId = { in: users.map((user) => user.id) };
      await prisma.refreshSession.deleteMany({ where: { tenantId } });
      await prisma.invitationToken.deleteMany({ where: { userId } });
      await prisma.passwordResetToken.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  for (const status of ["SUSPENDED", "ACTIVE"] as const) it(`invitation cannot change ${status} credentials or sessions`, async () => {
    const f = await fixture(status); const before = await state(f);
    await assert.rejects(invites.execute({ token: f.token, password: replacement }), (error: any) => error.code === "INVALID_INVITE");
    assert.deepEqual(await state(f), before);
  });
  it("deleted invited account cannot consume invitation", async () => {
    const f = await fixture("INVITED", true); const before = await state(f);
    await assert.rejects(invites.execute({ token: f.token, password: replacement }), (error: any) => error.code === "INVALID_INVITE");
    assert.deepEqual(await state(f), before);
  });
  it("legitimate invitation activates once, revokes old sessions and recovery links, and preserves another tenant", async () => {
    const f = await fixture(); const other = await fixture(); const otherBefore = await state(other);
    await invites.execute({ token: f.token, password: replacement, firstName: "Activated" });
    const result = await state(f); assert.equal(result.user.status, "ACTIVE"); assert.equal(result.user.firstName, "Activated");
    assert(await bcrypt.compare(replacement, result.user.passwordHash));
    assert(result.invitations.every((token) => token.usedAt)); assert(result.resets.every((token) => token.usedAt)); assert(result.sessions.every((session) => session.revokedAt));
    await assert.rejects(invites.execute({ token: f.token, password: resetPassword }), (error: any) => error.code === "INVALID_INVITE");
    assert.deepEqual(await state(f), result); assert.deepEqual(await state(other), otherBefore);
  });
  for (const sameToken of [true, false]) it(`concurrent ${sameToken ? "same" : "different"} invitation tokens permit only one activation`, async () => {
    const f = await fixture(); let secondToken = f.token;
    if (!sameToken) { secondToken = randomUUID(); await prisma.invitationToken.update({ where: { id: f.siblingId }, data: { tokenHash: hash(secondToken) } }); }
    const passwords = [replacement, resetPassword];
    const tokenHashes = [hash(f.token), hash(secondToken)];
    const results = await pairedPreflight("invitationToken", (args) => tokenHashes.includes(args.where.tokenHash), (found) => {
      assert(found, "Both invitation tokens must pass a real preflight before either activation");
      assert.equal(found.user.id, f.userId); assert.equal(found.user.status, "INVITED"); assert.equal(found.usedAt, null);
    }, [
      () => invites.execute({ token: f.token, password: passwords[0] }),
      () => invites.execute({ token: secondToken, password: passwords[1] })
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const winner = results.findIndex((result) => result.status === "fulfilled"); const loser = results.find((result) => result.status === "rejected");
    assert(loser?.status === "rejected" && loser.reason.code === "INVALID_INVITE");
    const final = await state(f); assert(await bcrypt.compare(passwords[winner], final.user.passwordHash)); assert(final.invitations.every((token) => token.usedAt)); assert(final.resets.every((token) => token.usedAt)); assert(final.sessions.every((session) => session.revokedAt));
  });
  it("suspension committed after invitation lookup prevents activation and token consumption", async () => {
    const f = await fixture();
    await afterLookup("invitationToken", async () => { await assert.rejects(invites.execute({ token: f.token, password: replacement }), (error: any) => error.code === "INVALID_INVITE"); }, async () => prisma.user.update({ where: { id: f.userId }, data: { status: "SUSPENDED" } }));
    const final = await state(f); assert.equal(final.user.status, "SUSPENDED"); assert.equal(final.user.passwordHash, oldHash); assert(final.invitations.every((token) => !token.usedAt)); assert(final.sessions.every((session) => !session.revokedAt));
  });
  it("expiration committed after invitation lookup prevents claim", async () => {
    const f = await fixture();
    await afterLookup("invitationToken", async () => { await assert.rejects(invites.execute({ token: f.token, password: replacement }), (error: any) => error.code === "INVALID_INVITE"); }, async () => prisma.invitationToken.update({ where: { id: f.invitationId }, data: { expiresAt: new Date(0) } }));
    const final = await state(f); assert.equal(final.user.status, "INVITED"); assert.equal(final.user.passwordHash, oldHash); assert(final.invitations.every((token) => !token.usedAt));
  });
  it("failed invitation session revocation rolls back activation and every token", async () => {
    const f = await fixture(); const before = await state(f);
    await failRevocation(() => invites.execute({ token: f.token, password: replacement })); assert.deepEqual(await state(f), before);
  });

  for (const revoke of [false, true]) it(`profile change keeps the explicit logoutAllDevices=${revoke} contract and other tenant state`, async () => {
    const f = await fixture("ACTIVE"); const other = await fixture("ACTIVE"); const otherBefore = await state(other);
    const result = await profile.changePassword(f.tenantId, f.userId, { currentPassword: rawPassword, newPassword: replacement, logoutAllDevices: revoke });
    assert.deepEqual(result, { updated: true, sessionsRevoked: revoke });
    const final = await state(f); assert(await bcrypt.compare(replacement, final.user.passwordHash)); assert(final.resets.every((token) => token.usedAt));
    assert(final.sessions.every((session) => Boolean(session.revokedAt) === revoke)); assert.deepEqual(await state(other), otherBefore);
  });
  it("failed profile session revocation rolls back password and pending resets", async () => {
    const f = await fixture("ACTIVE"); const before = await state(f);
    await failRevocation(() => profile.changePassword(f.tenantId, f.userId, { currentPassword: rawPassword, newPassword: replacement, logoutAllDevices: true })); assert.deepEqual(await state(f), before);
  });
  it("profile update cannot cross tenant", async () => {
    const f = await fixture("ACTIVE"); const other = await fixture("ACTIVE"); const before = await state(f);
    await assert.rejects(profile.changePassword(other.tenantId, f.userId, { currentPassword: rawPassword, newPassword: replacement })); assert.deepEqual(await state(f), before);
  });
  it("profile cannot overwrite a reset completed after its password lookup", async () => {
    const f = await fixture("ACTIVE"); const rawReset = randomUUID(); await prisma.passwordResetToken.update({ where: { id: f.resetId }, data: { tokenHash: hash(rawReset) } });
    await afterLookup("user", async () => { await assert.rejects(profile.changePassword(f.tenantId, f.userId, { currentPassword: rawPassword, newPassword: replacement, logoutAllDevices: true })); }, async () => new ResetPasswordUseCase().execute({ token: rawReset, newPassword: resetPassword }));
    const final = await state(f); assert(await bcrypt.compare(resetPassword, final.user.passwordHash)); assert(final.sessions.every((session) => session.revokedAt));
  });
  it("suspension committed after profile lookup prevents password and reset mutations", async () => {
    const f = await fixture("ACTIVE");
    await afterLookup("user", async () => { await assert.rejects(profile.changePassword(f.tenantId, f.userId, { currentPassword: rawPassword, newPassword: replacement })); }, async () => prisma.user.update({ where: { id: f.userId }, data: { status: "SUSPENDED" } }));
    const final = await state(f); assert.equal(final.user.status, "SUSPENDED"); assert.equal(final.user.passwordHash, oldHash); assert(final.resets.every((token) => !token.usedAt));
  });
  it("concurrent profile changes verified against the same password permit only one update", async () => {
    const f = await fixture("ACTIVE"); const results = await pairedPreflight("user", (args) => args.where.id === f.userId, (found) => {
      assert(found, "Both profile changes must pass a real preflight before either credential write");
      assert.equal(found.passwordHash, oldHash);
    }, [
      () => profile.changePassword(f.tenantId, f.userId, { currentPassword: rawPassword, newPassword: replacement, logoutAllDevices: true }),
      () => profile.changePassword(f.tenantId, f.userId, { currentPassword: rawPassword, newPassword: resetPassword, logoutAllDevices: true })
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const loser = results.find((result) => result.status === "rejected");
    assert(loser?.status === "rejected" && loser.reason.code === "CONFLICT");
    const winner = results.findIndex((result) => result.status === "fulfilled"); const final = await state(f);
    assert(await bcrypt.compare([replacement, resetPassword][winner], final.user.passwordHash)); assert(final.sessions.every((session) => session.revokedAt));
  });
  for (const refreshFirst of [false, true]) it(`profile logout-all and refresh preserve revocation when ${refreshFirst ? "refresh" : "profile"} holds the user lock first`, async () => {
    const f = await fixture("ACTIVE"); const other = await fixture("ACTIVE"); const otherBefore = await state(other);
    const rawRefresh = randomUUID();
    await prisma.refreshSession.update({ where: { id: f.refreshId }, data: { tokenHash: hash(rawRefresh) } });
    // Only JWT signing is stubbed; refresh reads real User/roles and writes real
    // RefreshSession/AuditLog rows. This does not test JWT verification or HTTP.
    const sessions = new AuthSessionService({ signAccess: () => "synthetic-access-token" } as any, {} as any);
    const change = () => profile.changePassword(f.tenantId, f.userId, { currentPassword: rawPassword, newPassword: replacement, logoutAllDevices: true });
    const refresh = () => sessions.refresh(rawRefresh, "synthetic-credential-race", "127.0.0.1");
    const results = await orderedUserLocks(f.userId, refreshFirst ? refresh : change, refreshFirst ? change : refresh);
    const profileResult = results[refreshFirst ? 1 : 0];
    const refreshResult = results[refreshFirst ? 0 : 1];
    assert.equal(profileResult.status, "fulfilled", "Password change must complete and revoke all devices");
    assert.equal(refreshResult.status, refreshFirst ? "fulfilled" : "rejected");
    if (refreshResult.status === "rejected") assert.equal(refreshResult.reason.code, "UNAUTHORIZED");
    const final = await state(f);
    assert(await bcrypt.compare(replacement, final.user.passwordHash));
    assert(final.resets.every((token) => token.usedAt));
    assert(final.sessions.every((session) => session.revokedAt));
    assert.equal(final.sessions.length, refreshFirst ? 2 : 1, "Only the refresh that obtained the lock first may create a successor");
    assert.equal(await prisma.refreshSession.count({ where: { userId: f.userId, revokedAt: null } }), 0);
    await assert.rejects(sessions.refresh(rawRefresh), (error: any) => error.code === "UNAUTHORIZED");
    if (refreshResult.status === "fulfilled") {
      await assert.rejects(sessions.refresh((refreshResult.value as any).refreshToken), (error: any) => error.code === "UNAUTHORIZED");
    }
    assert.deepEqual(await state(other), otherBefore);
  });
});
