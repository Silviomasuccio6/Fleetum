import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { AddressInfo } from "node:net";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { env } from "../../src/shared/config/env.js";
import { signTenantAccessToken } from "../helpers/http-auth.js";

type TenantFixture = {
  tenantId: string;
  userId: string;
  token: string;
  siteId: string;
  vehicleId: string;
  customerId: string;
  bookingId: string;
  contractId: string;
  vehiclePhotoId: string;
  marker: string;
};

const runId = `mti-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const uploadRoot = path.resolve(process.cwd(), env.UPLOAD_DIR);
let server: http.Server;
let baseUrl = "";
let tenantA: TenantFixture;
let tenantB: TenantFixture;

const jsonRequest = async (
  pathName: string,
  token: string,
  options: RequestInit = {}
) => {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
};

const assertForbiddenOrNotFound = (status: number) => {
  assert.ok(status === 403 || status === 404, `Expected 403/404 for cross-tenant access, got ${status}`);
};

const assertPayloadDoesNotContain = (payload: unknown, forbidden: string) => {
  assert.equal(JSON.stringify(payload).includes(forbidden), false, `Response leaked cross-tenant marker: ${forbidden}`);
};

const cleanupTenant = async (tenantId: string) => {
  await prisma.bookingContractDelivery.deleteMany({ where: { tenantId } });
  await prisma.bookingContractEvent.deleteMany({ where: { tenantId } });
  await prisma.bookingContract.deleteMany({ where: { tenantId } });
  await prisma.rentalBookingNote.deleteMany({ where: { tenantId } });
  await prisma.rentalCustomerAttachment.deleteMany({ where: { tenantId } });
  await prisma.rentalBookingPricingSnapshot.deleteMany({ where: { tenantId } });
  await prisma.rentalBooking.deleteMany({ where: { tenantId } });
  await prisma.rentalCustomer.deleteMany({ where: { tenantId } });
  await prisma.storedFileObject.deleteMany({ where: { tenantId } });
  await prisma.vehiclePhoto.deleteMany({ where: { vehicle: { tenantId } } });
  await prisma.vehicleCost.deleteMany({ where: { tenantId } });
  await prisma.vehicleMaintenanceAttachment.deleteMany({ where: { tenantId } });
  await prisma.vehicleMaintenance.deleteMany({ where: { tenantId } });
  await prisma.vehicleBooklet.deleteMany({ where: { tenantId } });
  await prisma.vehicle.deleteMany({ where: { tenantId } });
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.tenantSubscription.deleteMany({ where: { tenantId } });
  await prisma.userRole.deleteMany({ where: { user: { tenantId } } });
  await prisma.refreshSession.deleteMany({ where: { tenantId } });
  await prisma.privacyAcceptance.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.site.deleteMany({ where: { tenantId } });
  await prisma.workshop.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
};

const cleanupRun = async () => {
  const tenants = await prisma.tenant.findMany({
    where: { name: { startsWith: `MTI ${runId}` } },
    select: { id: true }
  });
  for (const tenant of tenants) {
    await cleanupTenant(tenant.id);
  }
  await fs.rm(path.join(uploadRoot, "tenant-isolation"), { recursive: true, force: true });
};

const assertDatabaseMigrated = async () => {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('Tenant', 'User', 'Vehicle', 'RentalBooking', 'RentalCustomer', 'BookingContract', 'StoredFileObject', 'AuditLog')
  `;
  const existing = new Set(rows.map((row) => row.table_name));
  const missing = ["Tenant", "User", "Vehicle", "RentalBooking", "RentalCustomer", "BookingContract", "StoredFileObject", "AuditLog"]
    .filter((tableName) => !existing.has(tableName));
  assert.equal(
    missing.length,
    0,
    `Tenant isolation HTTP tests require a migrated test DB. Missing tables: ${missing.join(", ")}`
  );
};

const createTenantFixture = async (label: "A" | "B"): Promise<TenantFixture> => {
  const marker = `TENANT_${label}_${runId}`;
  const tenant = await prisma.tenant.create({
    data: {
      name: `MTI ${runId} Tenant ${label}`,
      vatNumber: `IT${label}${Date.now().toString().slice(-9)}`
    }
  });

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `mti-${runId}-${label.toLowerCase()}@example.test`,
      passwordHash: "not-used-in-black-box-token-test",
      firstName: `User ${label}`,
      lastName: marker,
      isEmailVerified: true
    }
  });

  await prisma.tenantSubscription.create({
    data: {
      tenantId: tenant.id,
      provider: "test",
      plan: "ENTERPRISE",
      billingCycle: "monthly",
      status: "ACTIVE",
      seats: 10,
      priceMonthly: 0
    }
  });

  const site = await prisma.site.create({
    data: {
      tenantId: tenant.id,
      name: `Sede ${marker}`,
      address: `Via Test ${label}`,
      city: "Roma",
      email: `site-${label.toLowerCase()}@example.test`
    }
  });

  const vehicle = await prisma.vehicle.create({
    data: {
      tenantId: tenant.id,
      siteId: site.id,
      plate: `MT${label}${runId.slice(-4).toUpperCase()}`,
      brand: `Brand ${marker}`,
      model: `Model ${label}`,
      year: 2024,
      currentKm: label === "A" ? 1000 : 2000,
      purchasePrice: label === "A" ? 10000 : 20000
    }
  });

  const customer = await prisma.rentalCustomer.create({
    data: {
      tenantId: tenant.id,
      firstName: `Cliente ${label}`,
      lastName: marker,
      email: `customer-${label.toLowerCase()}-${runId}@example.test`,
      phone: `+390600000${label === "A" ? "1" : "2"}`,
      drivingLicenseNumber: `DL-${marker}`
    }
  });

  const pickupAt = new Date(Date.now() - 2 * 86400000);
  const returnAt = new Date(Date.now() + 2 * 86400000);
  const booking = await prisma.rentalBooking.create({
    data: {
      tenantId: tenant.id,
      vehicleId: vehicle.id,
      customerId: customer.id,
      createdByUserId: user.id,
      code: `MTI-${runId}-${label}`,
      status: "CONFIRMED",
      contractStatus: "READY",
      customerName: `Cliente ${marker}`,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      pickupAt,
      returnAt,
      pickupLocation: `Pickup ${marker}`,
      returnLocation: `Return ${marker}`,
      expectedTotal: label === "A" ? 250 : 999
    }
  });

  const contract = await prisma.bookingContract.create({
    data: {
      tenantId: tenant.id,
      bookingId: booking.id,
      status: "READY",
      title: `Contratto ${marker}`,
      content: `Contenuto contratto ${marker}`,
      emailTo: customer.email,
      templateVersion: 1
    }
  });

  const storageKey = path.posix.join(env.UPLOAD_DIR, "tenant-isolation", `${marker}.txt`);
  await fs.mkdir(path.dirname(path.resolve(process.cwd(), storageKey)), { recursive: true });
  await fs.writeFile(path.resolve(process.cwd(), storageKey), `file ${marker}`);
  const photo = await prisma.vehiclePhoto.create({
    data: {
      vehicleId: vehicle.id,
      filePath: storageKey,
      fileName: `${marker}.txt`,
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(`file ${marker}`)
    }
  });
  await prisma.storedFileObject.create({
    data: {
      tenantId: tenant.id,
      provider: "local",
      bucket: "local",
      storageKey,
      originalName: `${marker}.txt`,
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(`file ${marker}`),
      resourceType: "VehiclePhoto",
      resourceId: photo.id,
      visibility: "private"
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      action: "MTI_FIXTURE_CREATED",
      resource: "tenant-isolation",
      resourceId: tenant.id,
      details: { marker }
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      action: "SETTINGS_INTEGRATIONS",
      resource: "integrations",
      details: {
        erpWebhookUrl: `https://example.test/${marker}`,
        telematicsWebhookUrl: "",
        ticketingWebhookUrl: ""
      }
    }
  });

  return {
    tenantId: tenant.id,
    userId: user.id,
    token: signTenantAccessToken({ tenantId: tenant.id, userId: user.id }),
    siteId: site.id,
    vehicleId: vehicle.id,
    customerId: customer.id,
    bookingId: booking.id,
    contractId: contract.id,
    vehiclePhotoId: photo.id,
    marker
  };
};

describe("black-box HTTP tenant isolation", () => {
  before(async () => {
    await prisma.$connect();
    await assertDatabaseMigrated();
    await cleanupRun();
    tenantA = await createTenantFixture("A");
    tenantB = await createTenantFixture("B");
    server = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  after(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    try {
      await assertDatabaseMigrated();
      await cleanupRun();
    } catch {
      // If setup failed before migrations were available, there is nothing safe to clean up.
    }
    await prisma.$disconnect();
  });

  it("filters vehicle list by tenant and blocks cross-tenant vehicle mutation", async () => {
    const list = await jsonRequest("/master-data/vehicles?page=1&pageSize=50", tenantA.token);
    assert.equal(list.response.status, 200);
    assertPayloadDoesNotContain(list.body, tenantB.marker);

    const update = await jsonRequest(`/master-data/vehicles/${tenantB.vehicleId}`, tenantA.token, {
      method: "PATCH",
      body: JSON.stringify({ notes: `cross-tenant-write-${tenantA.marker}` })
    });
    assertForbiddenOrNotFound(update.response.status);

    const vehicleB = await prisma.vehicle.findUnique({ where: { id: tenantB.vehicleId }, select: { notes: true } });
    assert.notEqual(vehicleB?.notes, `cross-tenant-write-${tenantA.marker}`);
  });

  it("blocks cross-tenant rental customer access", async () => {
    const list = await jsonRequest("/rental-customers?page=1&pageSize=50", tenantA.token);
    assert.equal(list.response.status, 200);
    assertPayloadDoesNotContain(list.body, tenantB.marker);

    const direct = await jsonRequest(`/rental-customers/${tenantB.customerId}`, tenantA.token);
    assertForbiddenOrNotFound(direct.response.status);
  });

  it("blocks cross-tenant booking and contract access", async () => {
    const list = await jsonRequest("/rental-bookings?page=1&pageSize=50", tenantA.token);
    assert.equal(list.response.status, 200);
    assertPayloadDoesNotContain(list.body, tenantB.marker);

    const booking = await jsonRequest(`/rental-bookings/${tenantB.bookingId}`, tenantA.token);
    assertForbiddenOrNotFound(booking.response.status);

    const contract = await jsonRequest(`/rental-bookings/${tenantB.bookingId}/contract`, tenantA.token);
    assertForbiddenOrNotFound(contract.response.status);
  });

  it("blocks cross-tenant upload download", async () => {
    const download = await jsonRequest(`/uploads/vehicle-photos/${tenantB.vehiclePhotoId}/file`, tenantA.token);
    assertForbiddenOrNotFound(download.response.status);
    assertPayloadDoesNotContain(download.body, tenantB.marker);
  });

  it("does not leak cross-tenant data through stats and settings", async () => {
    const dashboard = await jsonRequest("/stats/dashboard", tenantA.token);
    assert.equal(dashboard.response.status, 200);
    assertPayloadDoesNotContain(dashboard.body, tenantB.marker);

    const profitability = await jsonRequest(`/stats/vehicles/profitability?vehicleId=${tenantB.vehicleId}`, tenantA.token);
    assertForbiddenOrNotFound(profitability.response.status);
    assertPayloadDoesNotContain(profitability.body, tenantB.marker);

    const settings = await jsonRequest("/settings/integrations", tenantA.token);
    assert.equal(settings.response.status, 200);
    assertPayloadDoesNotContain(settings.body, tenantB.marker);
  });

  it("does not leak cross-tenant audit logs", async () => {
    const audit = await jsonRequest("/audit/logs?page=1&pageSize=50", tenantA.token);
    assert.equal(audit.response.status, 200);
    assertPayloadDoesNotContain(audit.body, tenantB.marker);
  });
});
