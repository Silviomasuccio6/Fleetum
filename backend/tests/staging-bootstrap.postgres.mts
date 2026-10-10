import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  runStagingBootstrap, StagingBootstrapError, STAGING_BOOTSTRAP_TENANTS, STAGING_BOOTSTRAP_MIGRATION_PERMISSIONS
} from "../src/scripts/staging-bootstrap-policy.js";

const credentials = () => ({ tenantA: "Synthetic test fixture A 2026", tenantB: "Synthetic test fixture B 2026" });
const canonicalEnvironment = () => ({
  NODE_ENV: "production", FLEETUM_ENVIRONMENT: "staging",
  DATABASE_URL: "postgresql://fleetum_staging:synthetic-fixture@postgres:5432/fleetum_staging?schema=public",
  APP_URL: "https://staging.fleetum.it", BACKEND_PUBLIC_URL: "https://api-staging.fleetum.it",
  CORS_ORIGIN: "https://staging.fleetum.it", PLATFORM_CORS_ORIGIN: "https://platform-staging.fleetum.it",
  EMAIL_PROVIDER: "disabled", STORAGE_PROVIDER: "local", PRIVACY_RETENTION_CRON_ENABLED: "false",
  PRIVACY_RETENTION_GLOBAL_ENABLED: "false", BILLING_DUNNING_CRON_ENABLED: "false"
});
let fixtureDatabaseUrl = "";
let prisma: PrismaClient;
let applicationPrisma: typeof import("../src/infrastructure/database/prisma/client.js").prisma | undefined;
let server: http.Server | undefined;
let fixtureValidated = false;
let firstFixture = true;
const isolatedClient = () => new PrismaClient({ datasourceUrl: fixtureDatabaseUrl, log: [] });
const bootstrap = (input = credentials()) => runStagingBootstrap(canonicalEnvironment(), input, isolatedClient);
const errorWithCode = (code: string) => (error: unknown) => error instanceof StagingBootstrapError && error.code === code;

const counts = async () => {
  const values: Record<string, number> = {};
  for (const model of Prisma.dmmf.datamodel.models) {
    const name = model.name[0].toLowerCase() + model.name.slice(1);
    values[model.name] = await (prisma as unknown as Record<string, { count(): Promise<number> }>)[name].count();
  }
  return values;
};

// Only this explicit, separately provisioned temporary PostgreSQL 16 suite can
// clear its own synthetic fixture database. It never inherits a live env file.
const clearFixture = async () => {
  const tables = Prisma.dmmf.datamodel.models.map((model) => Prisma.raw(`"${model.dbName ?? model.name}"`));
  await prisma.$executeRaw(Prisma.sql`TRUNCATE TABLE ${Prisma.join(tables)} CASCADE`);
  await prisma.permission.createMany({ data: [...STAGING_BOOTSTRAP_MIGRATION_PERMISSIONS] });
};

describe("staging bootstrap on a dedicated temporary PostgreSQL 16 database", { concurrency: false }, () => {
  before(async () => {
    assert.equal(process.env.RUN_STAGING_BOOTSTRAP_TESTS, "1", "dedicated temporary database runner opt-in required");
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(process.env.DOTENV_CONFIG_PATH, "/dev/null");
    const database = new URL(process.env.DATABASE_URL ?? "invalid://missing");
    assert.ok(database.protocol === "postgresql:" || database.protocol === "postgres:");
    assert.equal(database.hostname, "127.0.0.1");
    assert.equal(database.pathname, "/fleetum_ci");
    assert.ok(database.port && Number(database.port) > 1024);
    assert.equal(process.env.STORAGE_PROVIDER ?? "local", "local");
    fixtureDatabaseUrl = database.toString();
    prisma = isolatedClient();
    const versions = await prisma.$queryRaw<Array<{ version: number }>>`SELECT current_setting('server_version_num')::integer AS version`;
    assert.ok(versions[0].version >= 160000 && versions[0].version < 170000);
    assert.ok(Object.entries(await counts()).every(([model, count]) => count === (model === "Permission" ? 10 : 0)),
      "dedicated migrated fixture must contain only the canonical migration catalog");
    const catalog = await prisma.permission.findMany({ orderBy: { key: "asc" } });
    assert.ok(JSON.stringify(catalog.map(({ id, key, description }) => ({ id, key, description })))
      === JSON.stringify([...STAGING_BOOTSTRAP_MIGRATION_PERMISSIONS].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    "dedicated migrated fixture must contain the exact canonical migration catalog");
    fixtureValidated = true;
  });
  beforeEach(async () => {
    if (fixtureValidated) {
      if (firstFixture) firstFixture = false;
      else await clearFixture();
    }
  });
  after(async () => {
    try {
      if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
      if (applicationPrisma) await applicationPrisma.$disconnect();
      if (fixtureValidated) await clearFixture();
    } finally { if (prisma) await prisma.$disconnect(); }
  });

  it("bootstraps the actual freshly migrated catalog without replacing migration records", async () => {
    const migrationRecords = await prisma.permission.findMany({ orderBy: { key: "asc" } });
    assert.equal(await bootstrap(), "STAGING_BOOTSTRAP_CREATED");
    const preserved = await prisma.permission.findMany({ where: { id: { in: migrationRecords.map((record) => record.id) } }, orderBy: { key: "asc" } });
    assert.deepEqual(preserved, migrationRecords);
    assert.equal(await prisma.permission.count(), 24);
  });

  it("a failed fixture preflight never clears an unrecognized database", async () => {
    await prisma.demoLead.create({ data: { fullName: "Synthetic preflight refusal", email: "fixture-refusal@example.invalid",
      companyName: "Synthetic" } });
    const previous = await counts();
    const child = spawnSync(process.execPath,
      ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
      { encoding: "utf8", timeout: 30000, env: { PATH: process.env.PATH, NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null",
        DATABASE_URL: fixtureDatabaseUrl, RUN_STAGING_BOOTSTRAP_TESTS: "1", STORAGE_PROVIDER: "local" } });
    assert.equal(child.status, 1);
    assert.ok(child.stdout.includes("dedicated migrated fixture must contain only the canonical migration catalog"));
    assert.deepEqual(await counts(), previous);
    assert.equal(await prisma.demoLead.count(), 1);
  });

  it("creates two distinct active synthetic admins with RBAC, sites, vehicles and local operational licenses", async () => {
    assert.equal(await bootstrap(), "STAGING_BOOTSTRAP_CREATED");
    for (const fixture of STAGING_BOOTSTRAP_TENANTS) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
      assert.equal(user.tenantId, fixture.tenantId);
      assert.equal(user.status, "ACTIVE");
      assert.equal(user.isEmailVerified, true);
      assert.equal(user.roles[0].role.key, "ADMIN");
      assert.ok(user.roles[0].role.permissions.some((permission) => permission.permission.key === "vehicles:write"));
      const license = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: fixture.tenantId } });
      assert.equal(license.status, "ACTIVE");
      assert.equal(license.provider, "local");
      assert.equal(license.stripeCustomerId, null);
      assert.equal(license.stripeSubscriptionId, null);
      const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: fixture.vehicleId } });
      assert.equal(vehicle.tenantId, fixture.tenantId);
      assert.equal(vehicle.siteId, fixture.siteId);
    }
    assert.equal(await prisma.tenant.count(), 2);
    assert.equal(await prisma.user.count(), 2);
    assert.equal(await prisma.billingEvent.count(), 0);
    assert.equal(await prisma.emailQueue.count(), 0);
  });

  it("refuses an altered migration permission before creating any synthetic tenant", async () => {
    await prisma.permission.update({ where: { key: "billing:read" }, data: { description: "Unknown synthetic capability metadata" } });
    const previous = await counts();
    await assert.rejects(bootstrap(), errorWithCode("STAGING_BOOTSTRAP_DATASET_UNRECOGNIZED"));
    assert.deepEqual(await counts(), previous);
    assert.equal(await prisma.tenant.count(), 0);
    assert.equal((await prisma.permission.findUniqueOrThrow({ where: { key: "billing:read" } })).description, "Unknown synthetic capability metadata");
  });

  it("refuses missing migration permissions rather than adopting an empty or partial catalog", async () => {
    await prisma.permission.delete({ where: { key: "billing:read" } });
    const previous = await counts();
    await assert.rejects(bootstrap(), errorWithCode("STAGING_BOOTSTRAP_DATASET_UNRECOGNIZED"));
    assert.deepEqual(await counts(), previous);
    assert.equal(await prisma.tenant.count(), 0);
  });

  it("reruns without mutating passwords, timestamps, license or RBAC rows", async () => {
    await bootstrap();
    const previousCounts = await counts();
    const previous = await prisma.user.findMany({ orderBy: { id: "asc" } });
    const previousLicenses = await prisma.tenantSubscription.findMany({ orderBy: { id: "asc" } });
    assert.equal(await bootstrap(), "STAGING_BOOTSTRAP_UNCHANGED");
    assert.deepEqual(await counts(), previousCounts);
    assert.ok(JSON.stringify(await prisma.user.findMany({ orderBy: { id: "asc" } })) === JSON.stringify(previous), "admin rows must remain unchanged");
    assert.deepEqual(await prisma.tenantSubscription.findMany({ orderBy: { id: "asc" } }), previousLicenses);
  });

  it("refuses an existing tenant or colliding account without adopting or altering it", async () => {
    const tenant = await prisma.tenant.create({ data: { id: STAGING_BOOTSTRAP_TENANTS[0].tenantId, name: "Unknown synthetic dataset" } });
    await prisma.user.create({ data: { tenantId: tenant.id, email: STAGING_BOOTSTRAP_TENANTS[0].email,
      passwordHash: "Synthetic unused hash", firstName: "Unknown", lastName: "Synthetic" } });
    const previous = await counts();
    await assert.rejects(bootstrap(), errorWithCode("STAGING_BOOTSTRAP_DATASET_UNRECOGNIZED"));
    assert.deepEqual(await counts(), previous);
    assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).name, "Unknown synthetic dataset");
  });

  it("refuses unrelated records even when the tenant table is empty", async () => {
    await prisma.demoLead.create({ data: { fullName: "Synthetic unknown lead", email: "unknown@example.invalid",
      companyName: "Synthetic", fleetSize: "test", message: "Synthetic unrecognized record" } });
    await assert.rejects(bootstrap(), errorWithCode("STAGING_BOOTSTRAP_DATASET_UNRECOGNIZED"));
    assert.equal(await prisma.tenant.count(), 0);
    assert.equal(await prisma.demoLead.count(), 1);
  });

  it("refuses altered credentials without rotating passwords or creating sessions", async () => {
    await bootstrap();
    const previous = await prisma.user.findMany({ orderBy: { id: "asc" } });
    await assert.rejects(bootstrap({ ...credentials(), tenantA: "Different synthetic password 2026" }), errorWithCode("STAGING_BOOTSTRAP_CREDENTIAL_MISMATCH"));
    assert.ok(JSON.stringify(await prisma.user.findMany({ orderBy: { id: "asc" } })) === JSON.stringify(previous), "admin rows must remain unchanged");
    assert.equal(await prisma.refreshSession.count(), 0);
  });

  it("refuses a modified license without automatically reactivating it", async () => {
    await bootstrap();
    await prisma.tenantSubscription.update({ where: { tenantId: STAGING_BOOTSTRAP_TENANTS[0].tenantId }, data: { status: "SUSPENDED" } });
    await assert.rejects(bootstrap(), errorWithCode("STAGING_BOOTSTRAP_DATASET_UNRECOGNIZED"));
    assert.equal((await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: STAGING_BOOTSTRAP_TENANTS[0].tenantId } })).status, "SUSPENDED");
  });

  it("refuses corrupted RBAC without silently restoring privileges", async () => {
    await bootstrap();
    const permission = await prisma.rolePermission.findFirstOrThrow({ where: { role: { key: "ADMIN" } } });
    await prisma.rolePermission.delete({ where: { id: permission.id } });
    const previous = await counts();
    await assert.rejects(bootstrap(), errorWithCode("STAGING_BOOTSTRAP_DATASET_UNRECOGNIZED"));
    assert.deepEqual(await counts(), previous);
  });

  it("refuses altered RBAC metadata even when every model count is unchanged", async () => {
    await bootstrap();
    await prisma.role.update({ where: { key: "ADMIN" }, data: { name: "Unknown synthetic role label" } });
    const previous = await counts();
    await assert.rejects(bootstrap(), errorWithCode("STAGING_BOOTSTRAP_DATASET_UNRECOGNIZED"));
    assert.deepEqual(await counts(), previous);
    assert.equal((await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } })).name, "Unknown synthetic role label");
  });

  it("refuses an altered bootstrap marker without replacing it", async () => {
    await bootstrap();
    await prisma.auditLog.update({ where: { id: STAGING_BOOTSTRAP_TENANTS[0].markerId },
      data: { details: { fixture: "fleetum-staging-v1", version: 2 } } });
    await assert.rejects(bootstrap(), errorWithCode("STAGING_BOOTSTRAP_DATASET_UNRECOGNIZED"));
    const marker = await prisma.auditLog.findUniqueOrThrow({ where: { id: STAGING_BOOTSTRAP_TENANTS[0].markerId } });
    assert.equal((marker.details as { version: number }).version, 2);
  });

  it("refuses a domain-valid money change without overwriting legacy or exact values", async () => {
    await bootstrap();
    // Preserve the database's dual-write invariant. This fixture changes the
    // stored bootstrap price legally instead of bypassing or weakening a check.
    await prisma.tenantSubscription.update({ where: { tenantId: STAGING_BOOTSTRAP_TENANTS[0].tenantId }, data: { priceMonthly: 17 } });
    await assert.rejects(bootstrap(), errorWithCode("STAGING_BOOTSTRAP_DATASET_UNRECOGNIZED"));
    const values = await prisma.$queryRaw<Array<{ unchanged: boolean }>>`
      SELECT "priceMonthly" = 17.00 AND "priceMonthlyExact" = 17.00 AS unchanged
      FROM "TenantSubscription" WHERE "tenantId" = ${STAGING_BOOTSTRAP_TENANTS[0].tenantId}`;
    assert.equal(values[0].unchanged, true);
  });

  it("rolls back every tenant, credential, license and RBAC row after an injected failure in the second tenant", async () => {
    const faultClient = isolatedClient().$extends({ query: { user: { async create({ args, query }) {
      if (args.data.tenantId === STAGING_BOOTSTRAP_TENANTS[1].tenantId) throw new Error("Injected synthetic confidential database failure");
      return query(args);
    } } } }) as unknown as PrismaClient;
    await assert.rejects(runStagingBootstrap(canonicalEnvironment(), credentials(), () => faultClient), (error) => {
      assert.ok(errorWithCode("STAGING_BOOTSTRAP_DATABASE_FAILED")(error));
      assert.equal(String(error).includes("confidential"), false);
      return true;
    });
    assert.ok(Object.entries(await counts()).every(([model, count]) => count === (model === "Permission" ? 10 : 0)));
  });

  it("concurrent bootstrap creates only one complete dataset", async () => {
    const outcomes = await Promise.allSettled([bootstrap(), bootstrap()]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled" && outcome.value === "STAGING_BOOTSTRAP_CREATED").length, 1);
    assert.equal(await prisma.tenant.count(), 2);
    assert.equal(await prisma.user.count(), 2);
    assert.equal(await prisma.auditLog.count(), 2);
    assert.equal(await bootstrap(), "STAGING_BOOTSTRAP_UNCHANGED");
  });

  it("uses real login, CSRF, permission and license guards for both tenants and refuses cross-tenant mutation", async () => {
    await bootstrap();
    const { createApp } = await import("../src/app.js");
    ({ prisma: applicationPrisma } = await import("../src/infrastructure/database/prisma/client.js"));
    server = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const sessions: Array<{ cookie: string; csrfToken: string }> = [];
    for (const fixture of STAGING_BOOTSTRAP_TENANTS) {
      const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: fixture.email, password: credentials()[fixture.credential] }) });
      assert.equal(response.status, 200);
      const body = await response.json() as { user: { tenantId: string; permissions: string[] }; csrfToken: string };
      assert.equal(body.user.tenantId, fixture.tenantId);
      assert.ok(body.user.permissions.includes("vehicles:write"));
      const session = { cookie: response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; "), csrfToken: body.csrfToken };
      sessions.push(session);
      const list = await fetch(`${baseUrl}/api/master-data/vehicles`, { headers: { cookie: session.cookie } });
      assert.equal(list.status, 200);
      const visible = JSON.stringify(await list.json());
      assert.ok(visible.includes(fixture.vehicleId));
      assert.ok(!visible.includes(STAGING_BOOTSTRAP_TENANTS.find((candidate) => candidate.key !== fixture.key)!.vehicleId));
    }
    const tenantA = STAGING_BOOTSTRAP_TENANTS[0];
    const tenantB = STAGING_BOOTSTRAP_TENANTS[1];
    const customer = await prisma.rentalCustomer.create({ data: { tenantId: tenantA.tenantId, firstName: "Synthetic", lastName: "Customer" } });
    const bookingInput = { vehicleId: tenantA.vehicleId, customerId: customer.id,
      pickupAt: "2027-02-01T10:00:00.000Z", returnAt: "2027-02-02T10:00:00.000Z", generateContract: false };
    const headers = { "content-type": "application/json", cookie: sessions[0].cookie, "x-csrf-token": sessions[0].csrfToken,
      "x-idempotency-key": "staging-bootstrap-synthetic-booking" };
    const noCsrf = await fetch(`${baseUrl}/api/rental-bookings`, { method: "POST", headers: { "content-type": "application/json", cookie: sessions[0].cookie }, body: JSON.stringify(bookingInput) });
    assert.equal(noCsrf.status, 403);
    const valid = await fetch(`${baseUrl}/api/rental-bookings`, { method: "POST", headers, body: JSON.stringify(bookingInput) });
    assert.equal(valid.status, 201);
    const booking = await prisma.rentalBooking.findFirstOrThrow({ where: { tenantId: tenantA.tenantId } });
    const crossed = await fetch(`${baseUrl}/api/rental-bookings/${booking.id}`, { method: "PATCH", headers, body: JSON.stringify({ vehicleId: tenantB.vehicleId }) });
    assert.ok(crossed.status === 403 || crossed.status === 404);
    assert.equal((await prisma.rentalBooking.findUniqueOrThrow({ where: { id: booking.id } })).vehicleId, tenantA.vehicleId);
    assert.ok(!JSON.stringify(await crossed.json()).includes(tenantB.vehicleId));
    await prisma.tenantSubscription.update({ where: { tenantId: tenantB.tenantId }, data: { status: "PENDING" } });
    const pending = await fetch(`${baseUrl}/api/master-data/vehicles`, { headers: { cookie: sessions[1].cookie } });
    assert.equal(pending.status, 402);
    const pendingBody = await pending.json() as { code?: string; error?: string };
    assert.equal(pendingBody.code ?? pendingBody.error, "LICENSE_PENDING");
    await assert.rejects(bootstrap(), errorWithCode("STAGING_BOOTSTRAP_DATASET_UNRECOGNIZED"));
    assert.equal(await prisma.billingEvent.count(), 0);
    assert.equal(await prisma.emailQueue.count(), 0);
  });
});
