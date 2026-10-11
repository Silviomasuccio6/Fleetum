import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, RoleKey } from "@prisma/client";
import { assertStagingIsolation } from "../shared/config/staging-safety.js";

export class StagingBootstrapError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StagingBootstrapError";
  }
}

export type StagingBootstrapCredentials = { tenantA: string; tenantB: string };
type Environment = Record<string, string | undefined>;
export const STAGING_BOOTSTRAP_INPUT_MAX_BYTES = 8192;
export const STAGING_BOOTSTRAP_FIXTURE = "fleetum-staging-v1";
export const STAGING_BOOTSTRAP_TENANTS = [
  { key: "a", credential: "tenantA", tenantId: "fleetum-staging-v1-tenant-a", name: "Fleetum staging synthetic A",
    userId: "fleetum-staging-v1-admin-a", email: "tenant-a@fleetum-staging.invalid", siteId: "fleetum-staging-v1-site-a",
    vehicleId: "fleetum-staging-v1-vehicle-a", plate: "STAGEA", markerId: "fleetum-staging-v1-marker-a" },
  { key: "b", credential: "tenantB", tenantId: "fleetum-staging-v1-tenant-b", name: "Fleetum staging synthetic B",
    userId: "fleetum-staging-v1-admin-b", email: "tenant-b@fleetum-staging.invalid", siteId: "fleetum-staging-v1-site-b",
    vehicleId: "fleetum-staging-v1-vehicle-b", plate: "STAGEB", markerId: "fleetum-staging-v1-marker-b" }
] as const;

const permissionKeys = [
  "dashboard:read", "sites:read", "sites:write", "workshops:read", "workshops:write", "vehicles:read", "vehicles:write",
  "stoppages:read", "stoppages:write", "stoppages:delete", "stoppages:remind", "users:read", "users:write", "stats:read",
  "billing:read", "billing:manage", "rental-payments:read", "rental-payments:write", "rental-payments:charge",
  "rental-payments:refund", "privacy:export", "privacy:manage", "reports:export", "vehicle:economics:read"
];
const rolePermissions: Record<RoleKey, string[]> = {
  ADMIN: permissionKeys,
  MANAGER: permissionKeys.filter((key) => ![
    "users:write", "billing:read", "billing:manage", "rental-payments:refund", "privacy:export", "privacy:manage"
  ].includes(key)),
  OPERATOR: ["dashboard:read", "sites:read", "workshops:read", "vehicles:read", "vehicles:write", "stoppages:read",
    "stoppages:write", "stoppages:remind", "rental-payments:read", "rental-payments:write", "stats:read"],
  VIEWER: ["dashboard:read", "sites:read", "workshops:read", "vehicles:read", "stoppages:read", "rental-payments:read", "stats:read"]
};
const roleId = (key: string) => `${STAGING_BOOTSTRAP_FIXTURE}-role-${key.toLowerCase()}`;
// These ten records are created by the two versioned permission migrations on
// an otherwise empty database. Preserve their canonical identity and metadata.
export const STAGING_BOOTSTRAP_MIGRATION_PERMISSIONS = Object.freeze([
  ["billing:read", "View Fleetum subscription invoices and billing documents"],
  ["billing:manage", "Manage Fleetum subscription checkout and payment method"],
  ["privacy:export", "Export rental customer personal data"],
  ["privacy:manage", "Run privacy erasure and retention operations"],
  ["reports:export", "Export operational and financial reports"],
  ["vehicle:economics:read", "View vehicle cost, margin and profitability data"],
  ["rental-payments:read", "View rental customer payment methods, deposits and extra charges"],
  ["rental-payments:write", "Create rental customer card setup sessions and extra charges"],
  ["rental-payments:charge", "Authorize, capture and release rental deposits or approved extra charges"],
  ["rental-payments:refund", "Manage rental payment refunds when supported by the workflow"]
].map(([key, description]) => Object.freeze({ id: `perm_${createHash("md5").update(key).digest("hex")}`, key, description })));
const migrationPermission = (key: string) => STAGING_BOOTSTRAP_MIGRATION_PERMISSIONS.find((permission) => permission.key === key);
const permissionId = (key: string) => migrationPermission(key)?.id ?? `${STAGING_BOOTSTRAP_FIXTURE}-permission-${key.replaceAll(":", "-")}`;
const permissionDescription = (key: string) => migrationPermission(key)?.description ?? key;
function refuse(code = "STAGING_BOOTSTRAP_DATASET_UNRECOGNIZED"): never { throw new StagingBootstrapError(code); }

/** This guard does not load dotenv, instantiate Prisma, or contact a provider. */
export const assertStagingBootstrapEnvironment = (raw: Environment): void => {
  if (raw.FLEETUM_ENVIRONMENT !== "staging" || raw.NODE_ENV !== "production") refuse("STAGING_BOOTSTRAP_ENVIRONMENT_REFUSED");
  for (const name of ["PRIVACY_RETENTION_CRON_ENABLED", "PRIVACY_RETENTION_GLOBAL_ENABLED", "BILLING_DUNNING_CRON_ENABLED"]) {
    if (raw[name] !== "false") refuse("STAGING_BOOTSTRAP_ENVIRONMENT_REFUSED");
  }
  try {
    assertStagingIsolation({
      environment: "staging", appUrl: raw.APP_URL ?? "", backendPublicUrl: raw.BACKEND_PUBLIC_URL ?? "",
      corsOrigin: raw.CORS_ORIGIN ?? "", platformCorsOrigin: raw.PLATFORM_CORS_ORIGIN ?? "",
      databaseUrl: raw.DATABASE_URL ?? "", emailProvider: raw.EMAIL_PROVIDER === "disabled" ? "disabled" : "resend",
      storageProvider: raw.STORAGE_PROVIDER ?? "", privacyRetentionCronEnabled: false,
      privacyRetentionGlobalEnabled: false, billingDunningCronEnabled: false, rawEnv: raw
    });
  } catch { refuse("STAGING_BOOTSTRAP_ENVIRONMENT_REFUSED"); }
};

export const parseStagingBootstrapCredentials = (input: string): StagingBootstrapCredentials => {
  if (Buffer.byteLength(input, "utf8") > STAGING_BOOTSTRAP_INPUT_MAX_BYTES) refuse("STAGING_BOOTSTRAP_INPUT_REFUSED");
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { refuse("STAGING_BOOTSTRAP_INPUT_REFUSED"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) refuse("STAGING_BOOTSTRAP_INPUT_REFUSED");
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "tenantA,tenantB") refuse("STAGING_BOOTSTRAP_INPUT_REFUSED");
  for (const key of ["tenantA", "tenantB"] as const) {
    const password = value[key];
    if (typeof password !== "string" || Buffer.byteLength(password, "utf8") < 16 || Buffer.byteLength(password, "utf8") > 72
      || /[\u0000-\u001f\u007f]/.test(password)) refuse("STAGING_BOOTSTRAP_INPUT_REFUSED");
  }
  if (value.tenantA === value.tenantB) refuse("STAGING_BOOTSTRAP_INPUT_REFUSED");
  return value as StagingBootstrapCredentials;
};

const recognizedCounts: Record<string, number> = {
  Tenant: 2, User: 2, TenantSubscription: 2, Site: 2, Vehicle: 2, AuditLog: 2,
  Role: 4, Permission: permissionKeys.length, UserRole: 2,
  RolePermission: Object.values(rolePermissions).reduce((count, permissions) => count + permissions.length, 0)
};

const countsForEveryModel = async (tx: Prisma.TransactionClient, modelNames: string[]) => {
  const counts: Record<string, number> = {};
  for (const modelName of modelNames) {
    const delegateName = modelName[0].toLowerCase() + modelName.slice(1);
    const delegate = (tx as unknown as Record<string, { count(): Promise<number> }>)[delegateName];
    counts[modelName] = await delegate.count();
  }
  return counts;
};

const assertMigrationCatalog = async (tx: Prisma.TransactionClient) => {
  const rows = await tx.permission.findMany();
  if (rows.length !== STAGING_BOOTSTRAP_MIGRATION_PERMISSIONS.length) refuse();
  for (const row of rows) {
    const expected = migrationPermission(row.key);
    if (!expected || row.id !== expected.id || row.description !== expected.description) refuse();
  }
};

const assertRecognizedDataset = async (tx: Prisma.TransactionClient, credentials: StagingBootstrapCredentials) => {
  const money = await tx.$queryRaw<Array<{ count: number }>>`
    SELECT (
      (SELECT COUNT(*) FROM "TenantSubscription" WHERE "priceMonthlyExact" IS NOT NULL)
      + (SELECT COUNT(*) FROM "Vehicle" WHERE "purchasePriceExact" IS NOT NULL
        OR "residualValueExact" IS NOT NULL OR "monthlyFixedCostExact" IS NOT NULL)
    )::integer AS count
  `;
  if (money[0].count !== 0) refuse();
  const roles = await tx.role.findMany({ include: { permissions: { include: { permission: true } } } });
  for (const role of roles) {
    if (role.id !== roleId(role.key) || role.name !== role.key) refuse();
    const actual = role.permissions.map((entry) => entry.permission.key).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...rolePermissions[role.key]].sort())) refuse();
  }
  const permissions = await tx.permission.findMany();
  for (const permission of permissions) {
    if (!permissionKeys.includes(permission.key) || permission.id !== permissionId(permission.key)
      || permission.description !== permissionDescription(permission.key)) refuse();
  }
  for (const fixture of STAGING_BOOTSTRAP_TENANTS) {
    const tenant = await tx.tenant.findUnique({ where: { id: fixture.tenantId } });
    if (!tenant || tenant.name !== fixture.name || tenant.vatNumber !== null || !tenant.isActive || tenant.deletedAt !== null) refuse();
    const user = await tx.user.findUnique({ where: { id: fixture.userId }, include: { roles: { include: { role: true } } } });
    if (!user || user.tenantId !== fixture.tenantId || user.email !== fixture.email || user.firstName !== "Synthetic"
      || user.lastName !== `Tenant ${fixture.key.toUpperCase()}` || user.status !== "ACTIVE" || user.deletedAt !== null || !user.isEmailVerified
      || user.roles.length !== 1 || user.roles[0].role.key !== "ADMIN" || user.roles[0].roleId !== roleId("ADMIN")) refuse();
    if (!/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(user.passwordHash)
      || !await bcrypt.compare(credentials[fixture.credential], user.passwordHash)) refuse("STAGING_BOOTSTRAP_CREDENTIAL_MISMATCH");
    const subscription = await tx.tenantSubscription.findUnique({ where: { tenantId: fixture.tenantId } });
    if (!subscription || subscription.id !== `${fixture.tenantId}-subscription` || subscription.provider !== "local"
      || subscription.plan !== "ENTERPRISE" || subscription.status !== "ACTIVE" || subscription.billingCycle !== "monthly"
      || subscription.seats !== 3 || subscription.priceMonthly !== null || subscription.stripeCustomerId !== null
      || subscription.stripeSubscriptionId !== null || subscription.currentPeriodEnd !== null || subscription.trialEndsAt !== null
      || subscription.canceledAt !== null) refuse();
    const site = await tx.site.findUnique({ where: { id: fixture.siteId } });
    if (!site || site.tenantId !== fixture.tenantId || site.name !== `Synthetic site ${fixture.key.toUpperCase()}`
      || site.address !== "Synthetic test address" || site.city !== "TestCity" || !site.isActive || site.deletedAt !== null
      || site.contactName !== null || site.email !== null || site.phone !== null || site.notes !== null) refuse();
    const vehicle = await tx.vehicle.findUnique({ where: { id: fixture.vehicleId } });
    if (!vehicle || vehicle.tenantId !== fixture.tenantId || vehicle.siteId !== fixture.siteId || vehicle.plate !== fixture.plate
      || vehicle.brand !== "Synthetic" || vehicle.model !== "Test vehicle" || vehicle.year !== 2026 || vehicle.currentKm !== 0
      || !vehicle.isActive || vehicle.deletedAt !== null || vehicle.purchasePrice !== null || vehicle.residualValue !== null
      || vehicle.monthlyFixedCost !== null || vehicle.notes !== null || vehicle.maintenanceIntervalKm !== null
      || vehicle.registrationDate !== null || vehicle.lastRevisionAt !== null || vehicle.revisionDueAt !== null || vehicle.purchaseDate !== null) refuse();
    const marker = await tx.auditLog.findUnique({ where: { id: fixture.markerId } });
    const details = marker?.details as Record<string, unknown> | null | undefined;
    if (!marker || marker.tenantId !== fixture.tenantId || marker.userId !== fixture.userId || marker.action !== "STAGING_BOOTSTRAP_CREATED"
      || marker.resource !== "tenant" || marker.resourceId !== fixture.tenantId
      || !details || Object.keys(details).sort().join(",") !== "fixture,version"
      || details.fixture !== STAGING_BOOTSTRAP_FIXTURE || details.version !== 1) refuse();
  }
};

const createSyntheticDataset = async (tx: Prisma.TransactionClient, credentials: StagingBootstrapCredentials) => {
  for (const key of permissionKeys) {
    if (!migrationPermission(key)) await tx.permission.create({ data: { id: permissionId(key), key, description: key } });
  }
  for (const key of Object.keys(rolePermissions) as RoleKey[]) {
    await tx.role.create({ data: { id: roleId(key), key, name: key } });
    for (const permission of rolePermissions[key]) {
      await tx.rolePermission.create({ data: { roleId: roleId(key), permissionId: permissionId(permission) } });
    }
  }
  for (const fixture of STAGING_BOOTSTRAP_TENANTS) {
    await tx.tenant.create({ data: { id: fixture.tenantId, name: fixture.name } });
    const passwordHash = await bcrypt.hash(credentials[fixture.credential], 12);
    await tx.user.create({ data: { id: fixture.userId, tenantId: fixture.tenantId, email: fixture.email,
      passwordHash, firstName: "Synthetic", lastName: `Tenant ${fixture.key.toUpperCase()}`, isEmailVerified: true,
      roles: { create: { roleId: roleId("ADMIN") } } } });
    // This capability is reachable only through the staging guard above. The
    // ordinary license middleware and production subscription flows stay intact.
    await tx.tenantSubscription.create({ data: { id: `${fixture.tenantId}-subscription`, tenantId: fixture.tenantId,
      provider: "local", plan: "ENTERPRISE", status: "ACTIVE", seats: 3, billingCycle: "monthly" } });
    await tx.site.create({ data: { id: fixture.siteId, tenantId: fixture.tenantId, name: `Synthetic site ${fixture.key.toUpperCase()}`,
      address: "Synthetic test address", city: "TestCity" } });
    await tx.vehicle.create({ data: { id: fixture.vehicleId, tenantId: fixture.tenantId, siteId: fixture.siteId,
      plate: fixture.plate, brand: "Synthetic", model: "Test vehicle", year: 2026, currentKm: 0 } });
    await tx.auditLog.create({ data: { id: fixture.markerId, tenantId: fixture.tenantId, userId: fixture.userId,
      action: "STAGING_BOOTSTRAP_CREATED", resource: "tenant", resourceId: fixture.tenantId,
      details: { fixture: STAGING_BOOTSTRAP_FIXTURE, version: 1 } } });
  }
};

type ClientFactory = (databaseUrl: string) => PrismaClient | Promise<PrismaClient>;

/** Injection exists for isolated fixtures, never as an environment/CLI bypass. */
export const runStagingBootstrap = async (
  raw: Environment,
  input: StagingBootstrapCredentials,
  clientFactory: ClientFactory = async (databaseUrl) => {
    const { PrismaClient } = await import("@prisma/client");
    return new PrismaClient({ datasourceUrl: databaseUrl, log: [] });
  }
): Promise<"STAGING_BOOTSTRAP_CREATED" | "STAGING_BOOTSTRAP_UNCHANGED"> => {
  assertStagingBootstrapEnvironment(raw);
  const credentials = parseStagingBootstrapCredentials(JSON.stringify(input));
  let client: PrismaClient | undefined;
  try {
    client = await clientFactory(raw.DATABASE_URL!);
    const { Prisma } = await import("@prisma/client");
    return await client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"fleetum:staging-bootstrap:v1"}, 0))::text`;
      const counts = await countsForEveryModel(tx, Prisma.dmmf.datamodel.models.map((model) => model.name));
      const migrationOnly = Object.entries(counts).every(([model, count]) =>
        count === (model === "Permission" ? STAGING_BOOTSTRAP_MIGRATION_PERMISSIONS.length : 0));
      if (migrationOnly) {
        await assertMigrationCatalog(tx);
        await createSyntheticDataset(tx, credentials);
        return "STAGING_BOOTSTRAP_CREATED";
      }
      for (const [model, count] of Object.entries(counts)) {
        if (count !== (recognizedCounts[model] ?? 0)) refuse();
      }
      await assertRecognizedDataset(tx, credentials);
      return "STAGING_BOOTSTRAP_UNCHANGED";
    }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 });
  } catch (error) {
    if (error instanceof StagingBootstrapError) throw error;
    // Prisma failures can contain connection strings, SQL values or hashes.
    throw new StagingBootstrapError("STAGING_BOOTSTRAP_DATABASE_FAILED");
  } finally {
    if (client) await client.$disconnect().catch(() => undefined);
  }
};
