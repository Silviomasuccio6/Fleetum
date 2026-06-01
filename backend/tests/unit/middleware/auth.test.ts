import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";
import { requireAuth } from "../../../src/interfaces/http/middlewares/auth.js";
import { env } from "../../../src/shared/config/env.js";
import { AppError } from "../../../src/shared/errors/app-error.js";

const createToken = (input: Record<string, unknown> = {}, options: jwt.SignOptions = {}) =>
  jwt.sign(
    {
      userId: "user_auth_test",
      tenantId: "tenant_auth_a",
      roles: ["ADMIN"],
      permissions: ["vehicles:read"],
      sessionId: "session_auth_test",
      tokenType: "access",
      ...input
    },
    env.JWT_SECRET,
    { expiresIn: "15m", ...options }
  );

const req = (token?: string, params: Record<string, string> = {}) => ({
  headers: token ? { authorization: `Bearer ${token}` } : {},
  params
}) as any;

const res = {} as any;

describe("requireAuth middleware", () => {
  it("calls next and populates req.auth for a valid access token", () => {
    const request = req(createToken());
    const next = vi.fn();

    requireAuth(request, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(request.auth).toMatchObject({
      userId: "user_auth_test",
      tenantId: "tenant_auth_a",
      tokenType: "access"
    });
  });

  it("throws 401 when the token is missing", () => {
    expect(() => requireAuth(req(), res, vi.fn())).toThrow(AppError);

    try {
      requireAuth(req(), res, vi.fn());
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 401, code: "UNAUTHORIZED" });
    }
  });

  it("throws 401 when the token is expired", () => {
    const expired = createToken({}, { expiresIn: "-1s" });

    try {
      requireAuth(req(expired), res, vi.fn());
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 401, code: "UNAUTHORIZED" });
      return;
    }

    throw new Error("Expected expired token to be rejected");
  });

  it("throws 403 when route tenantId does not match token tenantId", () => {
    const token = createToken({ tenantId: "tenant_auth_a" });

    try {
      requireAuth(req(token, { tenantId: "tenant_auth_b" }), res, vi.fn());
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 403, code: "TENANT_FORBIDDEN" });
      return;
    }

    throw new Error("Expected tenant mismatch to be rejected");
  });
});
