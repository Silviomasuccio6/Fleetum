import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { createMockNext, createMockReq, createMockRes } from "./helpers/mock-req-res.js";
import { signExpiredToken, signTestToken } from "./helpers/jwt.js";
import { AppError } from "../src/shared/errors/app-error.js";

const JWT_SECRET = "test-jwt-secret-for-ci-only-0000000000000000";

before(() => {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.PLATFORM_JWT_SECRET = "test-platform-jwt-secret-for-ci-only-000000000000000000000000000000000000000000";
  process.env.PLATFORM_ADMIN_PASSWORD = "ci-platform-admin-password-0000";
});

const loadMiddleware = async () => {
  const module = await import("../src/interfaces/http/middlewares/auth.js");
  return module.requireAuth;
};

const assertAppError = (error: unknown, statusCode: number, code: string) => {
  assert.ok(error instanceof AppError);
  assert.equal(error.statusCode, statusCode);
  assert.equal(error.code, code);
};

describe("requireAuth", () => {
  it("rejects requests without bearer header or access cookie", async () => {
    const requireAuth = await loadMiddleware();
    const req = createMockReq();

    assert.throws(() => requireAuth(req, createMockRes(), createMockNext()), (error) => {
      assertAppError(error, 401, "UNAUTHORIZED");
      return true;
    });
  });

  it("accepts a valid Bearer token and populates req.auth", async () => {
    const requireAuth = await loadMiddleware();
    const token = signTestToken({ userId: "user_a", tenantId: "tenant_a", roles: ["MANAGER"] }, JWT_SECRET);
    const req = createMockReq({ headers: { authorization: `Bearer ${token}` } }) as Request;
    const next = createMockNext();

    requireAuth(req, createMockRes(), next);

    assert.equal(next.calls.length, 1);
    assert.equal(next.calls[0], undefined);
    assert.equal(req.auth?.tenantId, "tenant_a");
    assert.equal(req.auth?.userId, "user_a");
    assert.deepEqual(req.auth?.roles, ["MANAGER"]);
  });

  it("accepts a valid access cookie and populates req.auth", async () => {
    const requireAuth = await loadMiddleware();
    const token = signTestToken({ userId: "user_cookie", tenantId: "tenant_cookie" }, JWT_SECRET);
    const req = createMockReq({ headers: { cookie: `fermi_access=${encodeURIComponent(token)}` } }) as Request;
    const next = createMockNext();

    requireAuth(req, createMockRes(), next);

    assert.equal(next.calls.length, 1);
    assert.equal(req.auth?.tenantId, "tenant_cookie");
    assert.equal(req.auth?.userId, "user_cookie");
  });

  it("rejects expired JWTs", async () => {
    const requireAuth = await loadMiddleware();
    const token = signExpiredToken({}, JWT_SECRET);
    const req = createMockReq({ headers: { authorization: `Bearer ${token}` } });

    assert.throws(() => requireAuth(req, createMockRes(), createMockNext()), (error) => {
      assertAppError(error, 401, "UNAUTHORIZED");
      return true;
    });
  });

  it("rejects JWTs with an altered signature", async () => {
    const requireAuth = await loadMiddleware();
    const token = `${signTestToken({}, JWT_SECRET).slice(0, -4)}abcd`;
    const req = createMockReq({ headers: { authorization: `Bearer ${token}` } });

    assert.throws(() => requireAuth(req, createMockRes(), createMockNext()), (error) => {
      assertAppError(error, 401, "UNAUTHORIZED");
      return true;
    });
  });

  it("rejects platform tokens on tenant routes", async () => {
    const requireAuth = await loadMiddleware();
    const token = signTestToken({ tokenType: "platform", platformAdmin: true }, JWT_SECRET);
    const req = createMockReq({ headers: { authorization: `Bearer ${token}` } });

    assert.throws(() => requireAuth(req, createMockRes(), createMockNext()), (error) => {
      assertAppError(error, 401, "UNAUTHORIZED");
      return true;
    });
  });
});
