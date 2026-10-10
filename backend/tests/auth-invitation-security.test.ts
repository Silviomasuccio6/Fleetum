import assert from "node:assert/strict";
import test, { TestContext } from "node:test";
import bcrypt from "bcryptjs";
import { AcceptInviteUseCase } from "../src/application/usecases/auth/accept-invite-usecase.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { hashToken } from "../src/infrastructure/email/email-queue-service.js";

const rawToken = "synthetic-invitation-token";
const password = "Synthetic-New-Password1!";
type Status = "INVITED" | "ACTIVE" | "SUSPENDED";

// This transactional double models conditional writes and rollback only. It
// never connects to PostgreSQL; real row-lock interleavings need the DB suite.
const installStore = (t: TestContext, status: Status = "INVITED", deletedAt: Date | null = null) => {
  let state = {
    user: {
      id: "synthetic-invited-user", email: "invite@example.invalid", status,
      deletedAt, passwordHash: "synthetic-placeholder-hash", firstName: "Original", lastName: "Name"
    },
    invites: [
      { id: "current-invite", userId: "synthetic-invited-user", tokenHash: hashToken(rawToken), usedAt: null as Date | null, expiresAt: new Date(Date.now() + 60_000) },
      { id: "other-pending-invite", userId: "synthetic-invited-user", tokenHash: "synthetic-other-hash", usedAt: null as Date | null, expiresAt: new Date(Date.now() + 60_000) },
      { id: "foreign-invite", userId: "synthetic-other-user", tokenHash: "synthetic-foreign-hash", usedAt: null as Date | null, expiresAt: new Date(Date.now() + 60_000) }
    ],
    resets: [
      { id: "historical-reset", userId: "synthetic-invited-user", usedAt: null as Date | null },
      { id: "foreign-reset", userId: "synthetic-other-user", usedAt: null as Date | null }
    ],
    sessions: [
      { userId: "synthetic-invited-user", revokedAt: null as Date | null },
      { userId: "synthetic-other-user", revokedAt: null as Date | null }
    ]
  };
  type State = typeof state;
  type Operation = { run: (draft: State) => unknown };
  let queue = Promise.resolve();
  let beforeTransaction: (() => void) | undefined;
  let failRevocation = false;
  let transactions = 0;
  const originalFindFirst = prisma.invitationToken.findFirst;
  const originalUserUpdate = prisma.user.update;
  const originalInviteUpdate = prisma.invitationToken.update;
  const originalTransaction = prisma.$transaction;
  t.after(() => {
    (prisma.invitationToken as any).findFirst = originalFindFirst;
    (prisma.user as any).update = originalUserUpdate;
    (prisma.invitationToken as any).update = originalInviteUpdate;
    (prisma as any).$transaction = originalTransaction;
  });

  const matchesInvite = (row: State["invites"][number], where: any) =>
    (where.id === undefined || (typeof where.id === "string" ? row.id === where.id : row.id !== where.id.not)) &&
    (where.userId === undefined || row.userId === where.userId) &&
    (where.tokenHash === undefined || row.tokenHash === where.tokenHash) &&
    (where.usedAt === undefined || row.usedAt === where.usedAt) &&
    (where.expiresAt === undefined || row.expiresAt > where.expiresAt.gt);

  (prisma.invitationToken as any).findFirst = async ({ where }: any) => {
    const record = state.invites.find((row) => matchesInvite(row, where));
    const eligible = where.user?.is;
    if (!record || (eligible && (state.user.status !== eligible.status || state.user.deletedAt !== eligible.deletedAt))) return null;
    return { ...structuredClone(record), user: structuredClone(state.user) };
  };
  // Support the pre-fix array transaction so RED reports behavioral failures,
  // rather than failing just because a transaction signature changed.
  (prisma.user as any).update = ({ data }: any): Operation => ({ run: (draft) => Object.assign(draft.user, data) });
  (prisma.invitationToken as any).update = ({ where, data }: any): Operation => ({
    run: (draft) => Object.assign(draft.invites.find((row) => row.id === where.id)!, data)
  });
  (prisma as any).$transaction = async (input: any) => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    transactions += 1;
    const hook = beforeTransaction;
    beforeTransaction = undefined;
    hook?.();
    const draft = structuredClone(state);
    const tx = {
      $queryRaw: async () => [{ id: draft.user.id }],
      invitationToken: {
        updateMany: async ({ where, data }: any) => {
          const rows = draft.invites.filter((row) => matchesInvite(row, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        }
      },
      passwordResetToken: {
        updateMany: async ({ where, data }: any) => {
          const rows = draft.resets.filter((row) => row.userId === where.userId && row.usedAt === where.usedAt);
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        }
      },
      user: {
        updateMany: async ({ where, data }: any) => {
          if (draft.user.id !== where.id || draft.user.status !== where.status || draft.user.deletedAt !== where.deletedAt) return { count: 0 };
          Object.assign(draft.user, data);
          return { count: 1 };
        }
      },
      refreshSession: {
        updateMany: async ({ where, data }: any) => {
          if (failRevocation) throw new Error("SYNTHETIC_REVOCATION_FAILURE");
          const rows = draft.sessions.filter((row) => row.userId === where.userId && row.revokedAt === where.revokedAt);
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        }
      }
    };
    try {
      const result = typeof input === "function" ? await input(tx) : input.map((operation: Operation) => operation.run(draft));
      state = draft;
      return result;
    } finally { release(); }
  };
  return {
    get state() { return state; },
    get transactions() { return transactions; },
    beforeTransaction(hook: () => void) { beforeTransaction = hook; },
    failRevocation() { failRevocation = true; }
  };
};

const accept = (newPassword = password) => new AcceptInviteUseCase().execute({ token: rawToken, password: newPassword });
const invalidInvite = (error: any) => error?.code === "INVALID_INVITE" && error?.statusCode === 400;

for (const status of ["SUSPENDED", "ACTIVE"] as const) {
  test(`invitation cannot reactivate or reset credentials for an ${status} user`, async (t) => {
    const store = installStore(t, status);
    const before = structuredClone(store.state);
    await assert.rejects(accept(), invalidInvite);
    assert.deepEqual(store.state, before);
  });
}

test("invitation cannot modify a deleted invited user", async (t) => {
  const store = installStore(t, "INVITED", new Date(0));
  const before = structuredClone(store.state);
  await assert.rejects(accept(), invalidInvite);
  assert.deepEqual(store.state, before);
});

test("legitimate invitation activates only its user, consumes pending invites and revokes old sessions", async (t) => {
  const store = installStore(t);
  assert.deepEqual(await accept(), { success: true, email: "invite@example.invalid" });
  assert.equal(store.transactions, 1);
  assert.equal(store.state.user.status, "ACTIVE");
  assert.equal(await bcrypt.compare(password, store.state.user.passwordHash), true);
  assert.ok(store.state.invites[0].usedAt);
  assert.ok(store.state.invites[1].usedAt);
  assert.equal(store.state.invites[2].usedAt, null);
  assert.ok(store.state.sessions[0].revokedAt);
  assert.equal(store.state.sessions[1].revokedAt, null);
  const accepted = structuredClone(store.state);
  await assert.rejects(accept("Synthetic-Replay-Password2!"), invalidInvite);
  assert.deepEqual(store.state, accepted);
});

test("invitation activation cannot resurrect an earlier password-reset link", async (t) => {
  const store = installStore(t);
  // A historical ACTIVE account can have been returned to INVITED by an
  // administrator, while an earlier reset token is still pending.
  const foreignReset = structuredClone(store.state.resets[1]);
  await accept();
  assert.equal(store.state.user.status, "ACTIVE");
  assert.ok(store.state.resets[0].usedAt, "The historical reset must be consumed before this account becomes active");
  assert.deepEqual(store.state.resets[1], foreignReset);
});

test("suspension after invite preflight rolls back token consumption and credential writes", async (t) => {
  const store = installStore(t);
  store.beforeTransaction(() => { store.state.user.status = "SUSPENDED"; });
  await assert.rejects(accept(), invalidInvite);
  assert.equal(store.state.user.status, "SUSPENDED");
  assert.equal(store.state.user.passwordHash, "synthetic-placeholder-hash");
  assert.equal(store.state.invites[0].usedAt, null);
  assert.equal(store.state.invites[1].usedAt, null);
  assert.equal(store.state.sessions[0].revokedAt, null);
});

test("invitation expiry during hashing cannot activate the user", async (t) => {
  const store = installStore(t);
  store.beforeTransaction(() => { store.state.invites[0].expiresAt = new Date(0); });
  await assert.rejects(accept(), invalidInvite);
  assert.equal(store.state.user.status, "INVITED");
  assert.equal(store.state.user.passwordHash, "synthetic-placeholder-hash");
  assert.equal(store.state.invites[0].usedAt, null);
});

test("concurrent consumption of one invitation produces one activation and one rejected replay", async (t) => {
  const store = installStore(t);
  const passwords = [password, "Synthetic-Other-Password2!"];
  const results = await Promise.allSettled(passwords.map(accept));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && invalidInvite(result.reason)).length, 1);
  const winner = results.findIndex((result) => result.status === "fulfilled");
  assert.equal(await bcrypt.compare(passwords[winner], store.state.user.passwordHash), true);
  assert.equal(store.state.user.status, "ACTIVE");
});

test("failed session revocation rolls back the activation and all invitation claims", async (t) => {
  const store = installStore(t);
  const before = structuredClone(store.state);
  store.failRevocation();
  await assert.rejects(accept(), /SYNTHETIC_REVOCATION_FAILURE/);
  assert.deepEqual(store.state, before);
});
