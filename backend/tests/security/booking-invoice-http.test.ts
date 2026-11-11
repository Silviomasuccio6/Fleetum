import {assertSyntheticDatabase} from "../helpers/synthetic-database.js";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PDFParse } from "pdf-parse";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { storageProvider } from "../../src/infrastructure/storage/storage-provider.js";
import { runWithSiteAccess } from "../../src/infrastructure/auth/site-access-context.js";
import { BookingInvoiceService } from "../../src/application/services/booking-invoice-service.js";
import { signTenantAccessToken } from "../helpers/http-auth.js";

const run = `invoice-${Date.now()}`;
const ids: Record<string, string> = {}, tokens: Record<string, string> = {};
const tenants: string[] = [];
let server: http.Server | undefined, base = "";
const extract = async (bytes: Uint8Array) => {
  const reader = new PDFParse({ data: bytes.slice() });
  try { return (await reader.getText()).text; } finally { await reader.destroy(); }
};
const request = (who = "admin", id = ids.booking, suffix = "") => fetch(`${base}/rental-bookings/${id}/invoice/draft.pdf${suffix}`, { headers: { Authorization: `Bearer ${tokens[who]}`, "X-Fleetum-Site": "all" } });
const pdf = async (who = "admin", id = ids.booking) => {
  const res = await request(who, id); assert.equal(res.status, 200, await res.clone().text());
  assert.match(res.headers.get("content-type")!, /^application\/pdf/); return new Uint8Array(await res.arrayBuffer());
};

describe("booking invoice draft through authenticated HTTP on synthetic PostgreSQL", () => {
  before(async () => {
    assertSyntheticDatabase({user:"fleetum_e01",database:"fleetum_e01_test",port:"61521",uploadPrefix:"/private/tmp/fleetum-e01-invoice-"});
    assert.equal(process.env.NODE_ENV, "test");
    const target = new URL(process.env.DATABASE_URL!);



    const read = await prisma.permission.upsert({ where: { key: "vehicles:read" }, update: {}, create: { key: "vehicles:read", description: "Synthetic read" } });
    for (const key of ["ADMIN", "MANAGER", "OPERATOR", "VIEWER"] as const) {
      const role = await prisma.role.upsert({ where: { key }, update: {}, create: { key, name: key } }); ids[key] = role.id;
      if (["MANAGER", "OPERATOR"].includes(key)) await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: read.id } }, update: {}, create: { roleId: role.id, permissionId: read.id } });
    }
    for (const key of ["a", "b"]) {
      const tenant = await prisma.tenant.create({ data: { name: `Synthetic ${run}-${key}` } }); tenants.push(tenant.id); ids[key] = tenant.id;
      await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, provider: "test", plan: "ENTERPRISE", status: "ACTIVE", seats: 20 } });
      await prisma.tenantProfile.create({ data: { tenantId: tenant.id, legalName: key === "a" ? "Autonoleggio Sintetico Srl" : "FOREIGN_COMPANY_NOT_ALLOWED", legalAddress: "Via fittizia 1", city: "Roma", vatNumber: "00000000000" } });
      for (const location of key === "a" ? ["roma", "milano", "napoli"] : ["foreign"]) {
        ids[location] = (await prisma.site.create({ data: { tenantId: tenant.id, name: location, address: "Synthetic", city: "Synthetic" } })).id;
      }
    }
    for (const [name, role, tenant, site] of [["admin", "ADMIN", ids.a, null], ["manager", "MANAGER", ids.a, null], ["rome", "OPERATOR", ids.a, ids.roma], ["milan", "OPERATOR", ids.a, ids.milano], ["unassigned", "OPERATOR", ids.a, null], ["nopermission", "VIEWER", ids.a, ids.roma], ["foreign", "ADMIN", ids.b, null]] as const) {
      const user = await prisma.user.create({ data: { tenantId: tenant, email: `${run}-${name}@example.invalid`, firstName: "Synthetic", lastName: name, passwordHash: "synthetic-not-a-login-hash", assignedSiteId: site, roles: { create: { roleId: ids[role] } } } }); ids[name+"User"] = user.id;
      const session = await prisma.refreshSession.create({ data: { tenantId: tenant, userId: user.id, tokenHash: `${run}-${name}`, expiresAt: new Date(Date.now() + 3600000) } }); ids[name+"Session"] = session.id;
      tokens[name] = signTenantAccessToken({ tenantId: tenant, userId: user.id, sessionId: session.id });
    }
    const customer = await prisma.rentalCustomer.create({ data: { tenantId: ids.a, firstName: "Synthetic", lastName: "Representative", customerType: "PERSONA_GIURIDICA", companyName: "Cliente Dimostrativo Srl", companyVatNumber: "00000000000", companyLegalAddress: "Via fittizia 2", drivingLicenseNumber: "PRIVATE_DRIVER_DOCUMENT", taxCode: "PRIVATE_REPRESENTATIVE_TAX", dateOfBirth: new Date("2000-01-01") } }); ids.customer = customer.id;
    ids.foreignCustomer = (await prisma.rentalCustomer.create({ data: { tenantId: ids.b, firstName: "FOREIGN_CUSTOMER_NOT_ALLOWED", lastName: "Synthetic" } })).id;
    const vehicle = await prisma.vehicle.create({ data: { tenantId: ids.a, siteId: ids.roma, plate: run, brand: "Synthetic", model: "Car" } }); ids.vehicle = vehicle.id;
    for (const [name, location, destination] of [["booking", ids.roma, ids.milano], ["unrelated", ids.napoli, ids.napoli], ["legacy", null, null]] as const) {
      const booking = await prisma.rentalBooking.create({ data: { tenantId: ids.a, siteId: location, pickupSiteId: location, returnSiteId: destination, vehicleId: vehicle.id, customerId: ids.customer, customerName: "Synthetic snapshot", code: `${run}-${name}`, status: "CONFIRMED", pickupAt: new Date("2035-01-01T09:00:00Z"), returnAt: new Date("2035-01-04T09:00:00Z"), expectedTotal: 181.78, internalNotes: "PRIVATE_INTERNAL_NOTE" } }); ids[name] = booking.id;
      ids[name+"Pricing"] = (await prisma.rentalBookingPricingSnapshot.create({ data: { tenantId: ids.a, bookingId: booking.id, priceListName: "Condizioni salvate", daysCharged: 3, expectedSubtotal: 149, expectedTaxAmount: 32.78, expectedTotal: 181.78, finalSubtotal: 200, finalTaxAmount: 44, finalTotal: 244, vatRate: 22, extraKmEstimated: 50, extraKmEstimatedCost: 10, extraKmActual: 100, extraKmActualCost: 20 } })).id;
    }
    const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160"><rect width="640" height="160" fill="white"/><rect x="8" y="24" width="8" height="100" fill="#3158c8"/><text x="36" y="67" font-family="sans-serif" font-size="34" font-weight="bold" fill="#14263f">AUTONOLEGGIO</text><text x="36" y="110" font-family="sans-serif" font-size="24" letter-spacing="7" fill="#66758a">SINTETICO</text></svg>')).png().toBuffer();
    const key = `tenants/${ids.a}/branding/qa-logo.png`; await storageProvider.write(key, image); ids.logoKey = key;
    await prisma.storedFileObject.create({ data: { tenantId: ids.a, provider: storageProvider.name, storageKey: key, resourceType: "TenantBranding", resourceId: ids.a, sizeBytes: image.length, mimeType: "image/png" } });
    await prisma.tenantBranding.create({ data: { tenantId: ids.a, logoFilePath: key } });
    server = createApp().listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (!tenants.length) { await prisma.$disconnect(); return; }
    const where = { tenantId: { in: tenants } };
    await prisma.rentalBookingPricingSnapshot.deleteMany({ where }); await prisma.rentalBooking.deleteMany({ where });
    await prisma.rentalCustomer.deleteMany({ where }); await prisma.refreshSession.deleteMany({ where });
    await prisma.userRole.deleteMany({ where: { user: where } }); await prisma.user.deleteMany({ where });
    await prisma.vehicle.deleteMany({ where }); await prisma.site.deleteMany({ where });
    await prisma.tenantBranding.deleteMany({ where }); await prisma.tenantProfile.deleteMany({ where });
    await prisma.storedFileObject.deleteMany({ where }); await prisma.tenantSubscription.deleteMany({ where });
    await prisma.auditLog.deleteMany({ where }); await prisma.tenant.deleteMany({ where: { id: { in: tenants } } }); await prisma.$disconnect();
    if (process.env.UPLOAD_DIR?.startsWith("/private/tmp/fleetum-e01-invoice-")) await fs.rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
  });
  it("returns a private PDF with the stored amounts and legal identities, without unrelated personal data", async () => {
    const res = await request(); assert.equal(res.status, 200); assert.equal(res.headers.get("cache-control"), "private, no-store"); assert.equal(res.headers.get("x-content-type-options"), "nosniff"); assert.match(res.headers.get("content-disposition")!, /^attachment; filename="Bozza_fattura_/);
    const bytes = new Uint8Array(await res.arrayBuffer()), text = await extract(bytes);
    for (const value of ["BOZZA - NON EMESSA", "Autonoleggio Sintetico Srl", "Cliente Dimostrativo Srl", "181,78", "32,78", "roma", "milano"]) assert.ok(text.includes(value), value);
    for (const value of ["PRIVATE_DRIVER_DOCUMENT", "PRIVATE_REPRESENTATIVE_TAX", "PRIVATE_INTERNAL_NOTE", "FOREIGN_COMPANY_NOT_ALLOWED"]) assert.ok(!text.includes(value), value);
    const dir = process.env.FLEETUM_INVOICE_QA_DIR;
    if (dir) { assert.ok(dir.startsWith("/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/verification/e01-booking-pdf-20261027/")); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "booking-from-http.pdf"), bytes); }
  });
  it("allows both pickup and return operators, while another booking and forged site query remain hidden", async () => {
    assert.equal((await request("rome")).status, 200); assert.equal((await request("milan")).status, 200);
    assert.equal((await request("rome", ids.unrelated, "?siteId="+ids.napoli+"&all=1")).status, 404);
    assert.equal((await request("unassigned")).status, 404);
  });
  it("keeps another tenant, missing bookings, unauthenticated callers and insufficient permissions out", async () => {
    assert.equal((await request("foreign")).status, 404); assert.equal((await request("admin", "missing-booking")).status, 404);
    assert.equal((await fetch(`${base}/rental-bookings/${ids.booking}/invoice/draft.pdf`)).status, 401);
    assert.equal((await request("nopermission")).status, 403);
  });
  it("keeps historical access after the vehicle is transferred and hides unclassified legacy bookings from operators", async () => {
    await prisma.vehicle.update({ where: { id: ids.vehicle }, data: { siteId: ids.napoli } });
    assert.equal((await request("rome")).status, 200); assert.equal((await request("milan")).status, 200);
    assert.equal((await request("rome", ids.legacy)).status, 404); assert.equal((await request("manager", ids.legacy)).status, 200);
  });
  it("applies a selected manager context as an additional restriction", async () => {
    await assert.rejects(() => runWithSiteAccess({ tenantId: ids.a, allSites: false, canViewAllSites: true, siteIds: [ids.napoli] }, () => new BookingInvoiceService().preview(ids.a, ids.managerUser, ids.booking)), (e: any) => e.statusCode === 404);
  });
  it("reads site assignment, site state, account state and backing session revocation on the next request", async () => {
    await prisma.user.update({ where: { id: ids.romeUser }, data: { assignedSiteId: ids.napoli } }); assert.equal((await request("rome")).status, 404);
    await prisma.user.update({ where: { id: ids.romeUser }, data: { assignedSiteId: ids.roma } });
    await prisma.site.update({ where: { id: ids.roma }, data: { isActive: false } }); assert.equal((await request("rome")).status, 404); await prisma.site.update({ where: { id: ids.roma }, data: { isActive: true } });
    await prisma.user.update({ where: { id: ids.romeUser }, data: { status: "SUSPENDED" } }); assert.equal((await request("rome")).status, 401); await prisma.user.update({ where: { id: ids.romeUser }, data: { status: "ACTIVE" } });
    await prisma.refreshSession.update({ where: { id: ids.romeSession }, data: { revokedAt: new Date() } }); assert.equal((await request("rome")).status, 401);
  });
  it("cannot fetch a forged cross-company logo and retains a text fallback for corrupt images", async () => {
    const reads: string[] = [], original = storageProvider.read;
    storageProvider.read = async key => { reads.push(key); return original.call(storageProvider, key); };
    try {
      await prisma.tenantBranding.update({ where: { tenantId: ids.a }, data: { logoFilePath: `tenants/${ids.b}/branding/foreign.png` } });
      const text = await extract(await pdf()); assert.ok(text.includes("Logo aziendale non disponibile")); assert.equal(reads.length, 0);
      await prisma.tenantBranding.update({ where: { tenantId: ids.a }, data: { logoFilePath: ids.logoKey } }); await storageProvider.write(ids.logoKey, Buffer.from("not an image"));
      assert.ok((await extract(await pdf())).includes("Logo aziendale non disponibile"));
    } finally { storageProvider.read = original; }
  });
  it("rejects corrupted cross-tenant customer relations before generating a document", async () => {
    await prisma.rentalBooking.update({ where: { id: ids.booking }, data: { customerId: ids.foreignCustomer } }); assert.equal((await request()).status, 404);
    await prisma.rentalBooking.update({ where: { id: ids.booking }, data: { customerId: ids.customer } });
  });
  it("rejects inconsistent or missing prices and uses final saved amounts only for a closed booking", async () => {
    await prisma.rentalBooking.update({ where: { id: ids.booking }, data: { expectedTotal: 999 } }); assert.equal((await request()).status, 409);
    await prisma.rentalBooking.update({ where: { id: ids.booking }, data: { expectedTotal: 181.78, status: "CLOSED", finalTotal: null } }); assert.equal((await request()).status, 409);
    await prisma.rentalBooking.update({ where: { id: ids.booking }, data: { finalTotal: 244 } });
    assert.ok((await extract(await pdf())).includes("244,00"));
    await prisma.rentalBookingPricingSnapshot.update({ where: { id: ids.bookingPricing }, data: { deletedAt: new Date() } }); assert.equal((await request()).status, 409);
  });
  it("does not create invoices, deliveries or queued email when previewing", async () => {
    assert.equal(await prisma.invoice.count({ where: { tenantId: ids.a } }), 0); assert.equal(await prisma.emailQueue.count({ where: { tenantId: ids.a } }), 0);
  });
});
