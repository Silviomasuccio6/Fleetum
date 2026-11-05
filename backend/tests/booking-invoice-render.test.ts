import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { PDFParse } from "pdf-parse";
import { ExactMoneyReader } from "../src/infrastructure/database/exact-money-reader.js";
import { renderBookingInvoicePdf } from "../src/application/services/booking-invoice-pdf.js";
import type { BookingInvoiceModel } from "../src/application/services/booking-invoice-model.js";
const fixture = (): BookingInvoiceModel => ({
  statusLabel: "BOZZA - NON EMESSA", amountBasis: "EXPECTED", code: "QA-001", generatedAt: "2035-01-04T10:00:00Z",
  issuer: { name: "Autonoleggio Sintetico Srl", details: ["Via sintetica 1, Roma", "P.IVA 00000000000"] },
  customer: { name: "Cliente di prova", details: ["Via fittizia 2, Milano"] }, pickupAt: "2035-01-01T09:00:00Z", returnAt: "2035-01-04T09:00:00Z", pickupSite: "Roma", returnSite: "Milano", responsibleSite: "Roma", vehicle: "Synthetic Car - TEST001",
  items: [{ description: "Noleggio", detail: "Condizioni salvate", quantity: "3 gg", amount: "149.00" }], subtotal: "149.00", tax: "32.78", total: "181.78", vatRate: "22", warnings: []
});
test("transaction-bound money reader preserves exact mode, metrics and mismatch reporting", async () => {
  let oldQueries = 0, newQueries = 0, observed = 0, logged = 0;
  const reader = new ExactMoneyReader("exact", { query: async () => { oldQueries += 1; throw new Error("Must not use another connection"); }, observe: () => { observed += 1; }, logMismatch: () => { logged += 1; } });
  const bound = reader.withQuery(async <T>() => { newQueries += 1; return [{ id: "synthetic", expectedTotalExact: "181.78" }] as T; });
  const row = await bound.hydrateOne("RentalBookingPricingSnapshot", { id: "synthetic", expectedTotal: 1 }, { tenantId: "synthetic-tenant" });
  assert.equal(row.expectedTotal, 181.78); assert.equal(oldQueries, 0); assert.equal(newQueries, 1); assert.equal(observed, 1); assert.equal(logged, 1);
});
test("PDF embeds fonts and preserves accented, Greek and Cyrillic identities", async () => {
  const model = fixture(); model.customer.name = "René Δοκιμή Тест";
  const bytes = await renderBookingInvoicePdf(model), doc = await PDFDocument.load(bytes); assert.equal(doc.getPageCount(), 1);
  const parser = new PDFParse({ data: bytes.slice() }); try { assert.ok((await parser.getText()).text.includes(model.customer.name)); } finally { await parser.destroy(); }
});
test("long details and unbroken references paginate with a draft label and page count on each page", async () => {
  const model = fixture(); model.issuer.name = "Società con denominazione sintetica molto estesa ".repeat(8);
  model.customer.details = Array.from({ length: 24 }, (_, i) => `Riga indirizzo sintetico ${i + 1}: ` + "riferimento-operativo-".repeat(9));
  model.items[0].detail = "RiferimentoSenzaSpazi".repeat(45);
  const bytes = await renderBookingInvoicePdf(model), doc = await PDFDocument.load(bytes); assert.ok(doc.getPageCount() >= 3);
  const parser = new PDFParse({ data: bytes.slice() }); try {
    const text = (await parser.getText()).text; assert.equal((text.match(/BOZZA - NON EMESSA/g) ?? []).length, doc.getPageCount()); assert.ok(text.includes("181,78"));
  } finally { await parser.destroy(); }
  const dir = process.env.FLEETUM_INVOICE_QA_DIR;
  if (dir) { assert.ok(dir.startsWith("/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/verification/e01-booking-pdf-20261027/")); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "long-details.pdf"), bytes); }
});
test("portrait, landscape and malformed logos keep the PDF usable", async () => {
  for (const [name, width, height] of [["portrait", 60, 480], ["landscape", 900, 40]] as const) {
    const image = await sharp({ create: { width, height, channels: 4, background: "#3158c8" } }).png().toBuffer();
    const bytes = await renderBookingInvoicePdf(fixture(), image); assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
    const dir = process.env.FLEETUM_INVOICE_QA_DIR; if (dir) await fs.writeFile(path.join(dir, `${name}-logo.pdf`), bytes);
  }
  assert.equal((await PDFDocument.load(await renderBookingInvoicePdf(fixture(), new Uint8Array([0, 1, 2])))).getPageCount(), 1);
});
test("unsupported scripts or excessively long values produce an actionable error instead of missing glyphs or clipping", async () => {
  const unsupported = fixture(); unsupported.customer.name = "漢字";
  await assert.rejects(() => renderBookingInvoicePdf(unsupported), (e: any) => e.code === "INVOICE_TEXT_UNSUPPORTED");
  const tooLong = fixture(); tooLong.vehicle = "X".repeat(4001);
  await assert.rejects(() => renderBookingInvoicePdf(tooLong), (e: any) => e.code === "INVOICE_TEXT_TOO_LONG");
});
