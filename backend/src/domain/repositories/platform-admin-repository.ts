export type PlatformTenantRow = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  tenantProfile?: {
    legalName: string;
    tradeName: string | null;
    vatNumber: string | null;
    email: string | null;
    phone: string | null;
    profileCompletedAt: Date | null;
  } | null;
  tenantBranding?: { logoFilePath: string | null } | null;
  users: Array<{ id: string; firstName: string; lastName: string; email: string; status: string; roles: Array<{ role: { key: string } }> }>;
  _count: { users: number; vehicles: number; stoppages: number };
};

export type PlatformLicenseStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";

export type PlatformLicense = {
  plan: string;
  seats: number;
  status: PlatformLicenseStatus;
  expiresAt: string | null;
  updatedAt?: string;
  priceMonthly?: number | null;
  billingCycle?: "monthly" | "yearly";
};

export type PlatformAuditEvent = {
  id: string;
  tenantId: string;
  tenantName: string;
  action: string;
  resource: string;
  resourceId: string | null;
  userId: string | null;
  details: unknown;
  createdAt: string;
};

export interface PlatformAdminRepository {
  listTenants(): Promise<PlatformTenantRow[]>;
  getTenantById(tenantId: string): Promise<{ id: string; name: string; isActive: boolean } | null>;
  getTenantCompanyProfile(tenantId: string): Promise<unknown | null>;
  setTenantActive(tenantId: string, isActive: boolean): Promise<void>;
  getLatestLicense(tenantId: string): Promise<PlatformLicense | null>;
  getLatestLicenseAtOrBefore(tenantId: string, at: Date): Promise<PlatformLicense | null>;
  setLicense(tenantId: string, userId: string, details: PlatformLicense): Promise<void>;
  listUsersGlobal(): Promise<Array<{ id: string; email: string; firstName: string; lastName: string; status: string; tenant: { id: string; name: string } }>>;
  appendPlatformAudit(input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    resource: string;
    resourceId?: string | null;
    details: Record<string, unknown>;
  }): Promise<void>;
  listRecentPlatformEvents(limit: number): Promise<PlatformAuditEvent[]>;
}
