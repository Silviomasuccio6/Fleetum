import type { User } from "../entities/models";

export type LicenseStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";
export type BillingProvider = "stripe" | "local";
export type BillingCycle = "monthly" | "yearly";

export const isTenantAdministrator = (user?: Pick<User, "roles"> | null) => user?.roles.includes("ADMIN") ?? false;

export const canManageTenantBilling = (user?: Pick<User, "roles" | "permissions"> | null) =>
  isTenantAdministrator(user) || (user?.permissions.includes("billing:manage") ?? false);

export const canReadTenantBilling = (user?: Pick<User, "roles" | "permissions"> | null) =>
  isTenantAdministrator(user) || (user?.permissions.includes("billing:read") ?? false);

export const isOperativeLicenseStatus = (status?: LicenseStatus | null) => status === "ACTIVE" || status === "TRIAL";

export const canUseStripeSelfService = (provider?: BillingProvider | null, status?: LicenseStatus | null) =>
  provider === "stripe" && ["ACTIVE", "TRIAL", "PAST_DUE", "SUSPENDED"].includes(status ?? "");
