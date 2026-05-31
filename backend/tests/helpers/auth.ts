import jwt from "jsonwebtoken";
import type { JwtPayload } from "../../src/shared/types/auth.js";

export const TEST_JWT_SECRET = "test-jwt-secret-for-ci-only-0000000000000000";
export const TEST_PLATFORM_JWT_SECRET =
  "test-platform-jwt-secret-for-ci-only-000000000000000000000000000000000000000000";

export const tenantA = {
  tenantId: "tenant_security_a",
  userId: "user_security_a"
} as const;

export const tenantB = {
  tenantId: "tenant_security_b",
  userId: "user_security_b"
} as const;

export const securityPermissions = [
  "vehicles:read",
  "vehicles:write",
  "sites:read",
  "sites:write",
  "workshops:read",
  "workshops:write",
  "reports:read",
  "reports:export"
] as const;

export const createTenantAccessToken = (
  input: Partial<JwtPayload> & { tenantId: string; userId?: string },
  options: jwt.SignOptions = {}
) => {
  const payload: JwtPayload = {
    userId: input.userId ?? `user_${input.tenantId}`,
    tenantId: input.tenantId,
    roles: input.roles ?? ["ADMIN"],
    permissions: input.permissions ?? [...securityPermissions],
    sessionId: input.sessionId ?? `session_${input.tenantId}`,
    tokenType: input.tokenType ?? "access"
  };

  return jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: "15m", ...options });
};

export const createExpiredTenantAccessToken = (tenantId = tenantA.tenantId) =>
  createTenantAccessToken({ tenantId }, { expiresIn: "-1s" });

export const createTamperedTenantAccessToken = (tenantId = tenantA.tenantId) => {
  const token = createTenantAccessToken({ tenantId });
  return `${token.slice(0, -8)}tampered`;
};

export const createPlatformToken = (input: Partial<JwtPayload> = {}, options: jwt.SignOptions = {}) => {
  const payload: JwtPayload = {
    userId: input.userId ?? "platform_admin_user",
    tenantId: input.tenantId ?? "platform",
    roles: input.roles ?? ["PLATFORM_ADMIN"],
    permissions: input.permissions ?? ["platform:*"],
    sessionId: input.sessionId ?? "platform_session",
    tokenType: "platform",
    platformAdmin: true
  };

  return jwt.sign(payload, TEST_PLATFORM_JWT_SECRET, { expiresIn: "15m", ...options });
};

export const bearer = (token: string) => `Bearer ${token}`;
