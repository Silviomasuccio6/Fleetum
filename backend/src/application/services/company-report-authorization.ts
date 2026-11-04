import type { Prisma } from "@prisma/client";
import { AuthorizationPolicyService } from "./authorization-policy-service.js";

export type CompanyReportAuthorization = { version: 1; kind: "company"; userId: string };

export const parseCompanyReportAuthorization = (value: unknown): CompanyReportAuthorization | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  return input.version === 1 && input.kind === "company" && typeof input.userId === "string" && input.userId.length > 0
    ? { version: 1, kind: "company", userId: input.userId } : null;
};

// A company schedule is a server-side command, not a branch report with a
// missing filter. Re-read the configurator's current authority on generation
// and dispatch; do not inherit HTTP AsyncLocalStorage or JWT permissions.
export const companyReportAuthorizationReason = async (
  db: Pick<Prisma.TransactionClient, "user">, tenantId: string, input: unknown
): Promise<string | null> => {
  const authorization = parseCompanyReportAuthorization(input);
  if (!authorization) return "REPORT_AUTHORIZATION_INVALID";
  const user = await db.user.findFirst({
    where: { id: authorization.userId, tenantId, status: "ACTIVE", deletedAt: null },
    select: { roles: { select: { role: { select: {
      key: true, permissions: { select: { permission: { select: { key: true } } } }
    } } } } }
  });
  if (!user) return "REPORT_REQUESTER_NOT_ACTIVE";
  const roles = user.roles.map(({ role }) => role.key);
  if (!roles.some(role => role === "ADMIN" || role === "MANAGER")) return "REPORT_COMPANY_SCOPE_REVOKED";
  const permissions = user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key));
  try { new AuthorizationPolicyService().assertPermissions({ roles, permissions }, ["users:write", "stats:read"]); }
  catch { return "REPORT_PERMISSION_REVOKED"; }
  return null;
};
