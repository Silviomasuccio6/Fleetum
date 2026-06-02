import jwt, { SignOptions } from "jsonwebtoken";

export type TestJwtPayload = {
  userId: string;
  tenantId: string;
  roles: string[];
  permissions: string[];
  sessionId?: string;
  tokenType?: "access" | "platform";
  platformAdmin?: boolean;
};

export const defaultTestJwtPayload = (overrides: Partial<TestJwtPayload> = {}): TestJwtPayload => ({
  userId: "user_test_1",
  tenantId: "tenant_test_1",
  roles: ["ADMIN"],
  permissions: ["*"],
  tokenType: "access",
  ...overrides
});

export const signTestToken = (
  payload: Partial<TestJwtPayload> = {},
  secret = process.env.JWT_SECRET ?? "test-jwt-secret-for-ci-only-0000000000000000",
  expiresIn: SignOptions["expiresIn"] = "15m"
) => jwt.sign(defaultTestJwtPayload(payload), secret, { expiresIn });

export const signExpiredToken = (
  payload: Partial<TestJwtPayload> = {},
  secret = process.env.JWT_SECRET ?? "test-jwt-secret-for-ci-only-0000000000000000"
) => jwt.sign(defaultTestJwtPayload(payload), secret, { expiresIn: "-1s" });
