import assert from "node:assert/strict";
import test from "node:test";
import { buildBookingInvoiceModel, isTenantBrandingKey } from "../src/application/services/booking-invoice-model.js";

const fixture = () => ({
  tenantName: "Synthetic Tenant", generatedAt: new Date("2035-01-04T10:00:00Z"),
  profile: { legalName: "Synthetic Legal Srl", tradeName: "Trading name", legalAddress: "Via sintetica 1", vatNumber: "00000000000" },
  booking: { code: "QA-001", status: "CONFIRMED", customerName: "Snapshot customer", expectedTotal: 181.78, finalTotal: null,
    pickupAt: new Date("2035-01-01T09:00:00Z"), returnAt: new Date("2035-01-04T09:00:00Z"),
    vehicle: { brand: "Synthetic", model: "Car", plate: "TEST001" }, site: { name: "Roma" }, pickupSite: { name: "Roma" }, returnSite: { name: "Milano" },
    customer: { customerType: "PERSONA_GIURIDICA", companyName: "Synthetic Customer Srl", firstName: "Representative", lastName: "Synthetic", companyVatNumber: "00000000000", companyLegalAddress: "Via fittizia 2" } },
  pricing: { priceListName: "Saved conditions", expectedSubtotal: 149, expectedTaxAmount: 32.78, expectedTotal: 181.78,
    finalSubtotal: 200, finalTaxAmount: 44, finalTotal: 244, vatRate: 22, extraKmEstimatedCost: 10, extraKmActualCost: 20, extraKmEstimated: 50, extraKmActual: 100, daysCharged: 3 }
});
const conflict = (fn: () => unknown) => assert.throws(fn, (e: any) => e.statusCode === 409);
test("draft uses saved expected amounts, with recorded extras partitioned rather than recomputed", () => {
  const m = buildBookingInvoiceModel(fixture());
  assert.equal(m.amountBasis, "EXPECTED"); assert.equal(m.total, "181.78"); assert.equal(m.subtotal, "149.00"); assert.equal(m.tax, "32.78");
  assert.deepEqual(m.items.map(x => x.amount), ["139.00", "10.00"]);
  assert.equal(m.statusLabel, "BOZZA - NON EMESSA");
});
test("a closed rental uses saved final amounts", () => {
  const f: any = fixture(); f.booking.status = "CLOSED"; f.booking.finalTotal = 244;
  const m = buildBookingInvoiceModel(f); assert.equal(m.amountBasis, "FINAL"); assert.equal(m.total, "244.00");
  assert.deepEqual(m.items.map(x => x.amount), ["180.00", "20.00"]);
});
test("closed rentals with incomplete final pricing cannot silently use expected values", () => {
  const f: any = fixture(); f.booking.status = "CLOSED"; f.pricing.finalTaxAmount = null; conflict(() => buildBookingInvoiceModel(f));
});
test("a closed rental needs its confirmed booking total, even when quote final columns exist", () => {
  const f: any = fixture(); f.booking.status = "CLOSED"; f.booking.finalTotal = null;
  conflict(() => buildBookingInvoiceModel(f));
});
test("missing pricing or taxes never invent a VAT rate or split a gross manual total", () => {
  for (const patch of [null, { ...fixture().pricing, expectedTaxAmount: null }, { ...fixture().pricing, expectedSubtotal: null }]) {
    conflict(() => buildBookingInvoiceModel({ ...fixture(), pricing: patch } as any));
  }
});
test("inconsistent totals and manual overrides require correction before a document", () => {
  const f = fixture(); f.pricing.expectedTotal = 182; conflict(() => buildBookingInvoiceModel(f));
  const other = fixture(); other.booking.expectedTotal = 999; conflict(() => buildBookingInvoiceModel(other));
});
test("negative, nonfinite and overlarge financial values are rejected", () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1e20]) {
    const f = fixture(); f.pricing.expectedSubtotal = value; conflict(() => buildBookingInvoiceModel(f));
  }
});
test("zero totals are legitimate and no extra charges or deposits are added automatically", () => {
  const f: any = fixture(); Object.assign(f.pricing, { expectedSubtotal: 0, expectedTaxAmount: 0, expectedTotal: 0, extraKmEstimatedCost: 0 }); f.booking.expectedTotal = 0;
  f.deposits = [{ amount: 500 }]; f.extraCharges = [{ amount: 90 }]; assert.equal(buildBookingInvoiceModel(f).total, "0.00");
});
test("issuer and buyer use their actual legal identities, not the representative or trade name", () => {
  const m = buildBookingInvoiceModel(fixture()); assert.equal(m.issuer.name, "Synthetic Legal Srl"); assert.equal(m.customer.name, "Synthetic Customer Srl");
  assert.equal(m.pickupSite, "Roma"); assert.equal(m.returnSite, "Milano");
});
test("personal identity and missing company profile are explicit, with no invented official details", () => {
  const f: any = fixture(); f.profile = null; f.booking.customer = { customerType: "PERSONA_FISICA", firstName: "Cliente", lastName: "Sintetico", taxCode: "SYNTHETIC", drivingLicenseNumber: "PRIVATE_NOT_FOR_INVOICE", dateOfBirth: new Date() };
  const m = buildBookingInvoiceModel(f); assert.equal(m.customer.name, "Cliente Sintetico"); assert.ok(m.warnings.length);
  assert.ok(!JSON.stringify(m).includes("PRIVATE_NOT_FOR_INVOICE"));
});
test("unknown historical sites are not inferred from the vehicle's current position", () => {
  const f: any = fixture(); f.booking.site = null; f.booking.pickupSite = null; f.booking.returnSite = null; f.booking.vehicle.site = { name: "Napoli" };
  const m = buildBookingInvoiceModel(f); assert.equal(m.pickupSite, "Sede non classificata"); assert.equal(m.returnSite, "Sede non classificata");
});
test("cancelled and no-show bookings have no implicit billable amount", () => {
  for (const status of ["CANCELED", "NO_SHOW"]) { const f = fixture(); f.booking.status = status; conflict(() => buildBookingInvoiceModel(f)); }
});
test("branding keys accept only the exact tenant and branding namespace", () => {
  assert.equal(isTenantBrandingKey("tenants/company-a/branding/logo.png", "company-a"), true);
  assert.equal(isTenantBrandingKey("uploads/company-a/branding/logo.jpg", "company-a"), true);
  for (const key of ["tenants/company-b/branding/logo.png", "tenants/company-a-x/branding/logo.png", "tenants/company-a/contracts/logo.png", "../logo.png", "https://example.invalid/logo.png", "tenants/company-a/branding/../../b.png", "tenants/company-a/branding/nested/logo.png"]) assert.equal(isTenantBrandingKey(key, "company-a"), false, key);
});
