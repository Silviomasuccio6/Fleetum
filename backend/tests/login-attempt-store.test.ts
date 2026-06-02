import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { LoginAttemptStoreService } from "../src/application/services/login-attempt-store-service.js";

type LoginState = {
  scope: string;
  identifier: string;
  attempts: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
};

const keyOf = (scope: string, identifier: string) => `${scope}:${identifier}`;

const createLoginRateLimitStateStub = () => {
  const states = new Map<string, LoginState>();

  return {
    states,
    async findUnique(input: { where: { scope_identifier: { scope: string; identifier: string } }; select?: Record<string, boolean> }) {
      const { scope, identifier } = input.where.scope_identifier;
      return states.get(keyOf(scope, identifier)) ?? null;
    },
    async update(input: { where: { scope_identifier: { scope: string; identifier: string } }; data: Partial<LoginState>; select?: Record<string, boolean> }) {
      const { scope, identifier } = input.where.scope_identifier;
      const current = states.get(keyOf(scope, identifier));
      if (!current) throw new Error("State not found");
      const next = { ...current, ...input.data } as LoginState;
      states.set(keyOf(scope, identifier), next);
      return next;
    },
    async upsert(input: {
      where: { scope_identifier: { scope: string; identifier: string } };
      create: LoginState;
      update: Partial<LoginState>;
      select?: Record<string, boolean>;
    }) {
      const { scope, identifier } = input.where.scope_identifier;
      const key = keyOf(scope, identifier);
      const next = states.has(key) ? { ...states.get(key)!, ...input.update } as LoginState : input.create;
      states.set(key, next);
      return next;
    },
    async deleteMany(input: { where: { scope: string; identifier: string } }) {
      const deleted = states.delete(keyOf(input.where.scope, input.where.identifier));
      return { count: deleted ? 1 : 0 };
    }
  };
};

let originalLoginRateLimitState: unknown;
let stub: ReturnType<typeof createLoginRateLimitStateStub>;

beforeEach(() => {
  originalLoginRateLimitState = (prisma as unknown as { loginRateLimitState?: unknown }).loginRateLimitState;
  stub = createLoginRateLimitStateStub();
  Object.defineProperty(prisma, "loginRateLimitState", {
    value: stub,
    configurable: true
  });
});

afterEach(() => {
  Object.defineProperty(prisma, "loginRateLimitState", {
    value: originalLoginRateLimitState,
    configurable: true
  });
});

describe("LoginAttemptStoreService", () => {
  it("does not block on the first assertAllowed call", async () => {
    const service = new LoginAttemptStoreService();

    const result = await service.assertAllowed("login", "user@example.test");

    assert.deepEqual(result, {});
  });

  it("locks the identifier after MAX_ATTEMPTS failures", async () => {
    const service = new LoginAttemptStoreService();
    const options = { windowMs: 15 * 60 * 1000, maxAttempts: 8, lockMs: 30 * 60 * 1000 };

    let result = { locked: false, failures: 0, blockedUntil: undefined as string | undefined };
    for (let index = 0; index < options.maxAttempts; index += 1) {
      result = await service.registerAttempt("login", "blocked@example.test", options);
    }

    assert.equal(result.locked, true);
    assert.equal(result.failures, 8);
    assert.ok(result.blockedUntil);

    const allowed = await service.assertAllowed("login", "blocked@example.test");
    assert.ok(allowed.blockedUntil);
  });

  it("clear removes a blocked state", async () => {
    const service = new LoginAttemptStoreService();
    const options = { windowMs: 15 * 60 * 1000, maxAttempts: 2, lockMs: 30 * 60 * 1000 };

    await service.registerAttempt("login", "clear@example.test", options);
    await service.registerAttempt("login", "clear@example.test", options);
    assert.ok((await service.assertAllowed("login", "clear@example.test")).blockedUntil);

    await service.clear("login", "clear@example.test");

    assert.deepEqual(await service.assertAllowed("login", "clear@example.test"), {});
  });

  it("resets attempts when the window has expired", async () => {
    const service = new LoginAttemptStoreService();
    const identifier = "expired-window@example.test";
    const options = { windowMs: 1000, maxAttempts: 8, lockMs: 30 * 60 * 1000 };
    const oldWindow = new Date(Date.now() - 60_000);
    stub.states.set(keyOf("login", identifier), {
      scope: "login",
      identifier,
      attempts: 7,
      windowStartedAt: oldWindow,
      blockedUntil: null
    });

    const result = await service.registerAttempt("login", identifier, options);

    assert.equal(result.locked, false);
    assert.equal(result.failures, 1);
    assert.equal(stub.states.get(keyOf("login", identifier))?.attempts, 1);
  });
});
