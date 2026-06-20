import jwt from "jsonwebtoken";
import { env } from "../../src/shared/config/env.js";
import { JwtPayload } from "../../src/shared/types/auth.js";

export const tenantIsolationPermissions = [
  "vehicles:read",
  "vehicles:write",
  "stats:read",
  "users:read",
  "users:write",
  "billing:read",
  "billing:manage",
  "privacy:export",
  "privacy:manage",
  "reports:export",
  "vehicle:economics:read",
  "sites:read",
  "sites:write",
  "workshops:read",
  "workshops:write",
  "stoppages:read",
  "stoppages:write"
];

export const signTenantAccessToken = (input: {
  userId: string;
  tenantId: string;
  permissions?: string[];
  roles?: string[];
}) => {
  const payload: JwtPayload = {
    userId: input.userId,
    tenantId: input.tenantId,
    roles: input.roles ?? ["ADMIN"],
    permissions: input.permissions ?? tenantIsolationPermissions,
    tokenType: "access"
  };

  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "15m" });
};
