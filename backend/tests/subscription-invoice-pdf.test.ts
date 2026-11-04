import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { PDFParse } from "pdf-parse";
import { InvoiceService } from "../src/application/services/invoice-service.js";
import { subscriptionInvoiceFixture } from "./helpers/subscription-invoice-fixture.js";

const render = async (invoice: ReturnType<typeof subscriptionInvoiceFixture>) => {
  const service = new InvoiceService();
  (service as any).findInvoice = async () => invoice;
  return service.pdfBufferForPlatform(invoice.id);
};
const extract = async (bytes: Buffer) => {
  const parser = new PDFParse({ data: bytes.slice() });
  try { return await parser.getText(); } finally { await parser.destroy(); }
};
test("subscription document paginates saved line items instead of drawing below the A4 page", async () => {
  const invoice = subscriptionInvoiceFixture();
  invoice.items = Array.from({ length: 42 }, (_, i) => ({ ...invoice.items[0], id: `item_${i}`, description: `Riga sintetica ${i+1}: ` + "Servizio previsto nelle condizioni contrattuali ".repeat(3) }));
  const bytes = await render(invoice), doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 3);
  const result = await extract(bytes);
  assert.ok(result.text.includes("Riga sintetica 42"));
  assert.equal((result.text.match(/COPIA DI CORTESIA/g) ?? []).length, doc.getPageCount());
  assert.ok(result.text.includes("181,78"));
});
test("subscription preserves multilingual legal identities without WinAnsi errors", async () => {
  const invoice = subscriptionInvoiceFixture(); invoice.billingName = "René Δοκιμή Тест";
  assert.ok((await extract(await render(invoice))).text.includes(invoice.billingName));
});
test("subscription status is explicit for draft, overdue and void documents", async () => {
  for (const [status, label] of [["DRAFT", "BOZZA"], ["OVERDUE", "SCADUTA"], ["VOID", "ANNULLATA"]]) {
    const invoice = subscriptionInvoiceFixture(); invoice.status = status;
    assert.ok((await extract(await render(invoice))).text.includes(label), status);
  }
});

test("long legal names, unbroken details and notes paginate without truncation", async () => {
 const invoice=subscriptionInvoiceFixture(); invoice.billingName="Denominazione sintetica estesa ".repeat(25);
 invoice.billingAddress="RiferimentoSenzaSpazi".repeat(120)+" FINE_INDIRIZZO";
 invoice.notes="Condizioni sintetiche salvate ".repeat(100)+" FINE_NOTE";
 const bytes=await render(invoice),doc=await PDFDocument.load(bytes),result=await extract(bytes);
 assert.ok(doc.getPageCount()>=3); for(const expected of ["FINE_INDIRIZZO","FINE_NOTE","181,78"])assert.ok(result.text.includes(expected),expected);
});
test("unsupported scripts and excessive input are rejected rather than clipped", async () => {
 const invoice=subscriptionInvoiceFixture(); invoice.billingName="漢字";
 await assert.rejects(()=>render(invoice),(e:any)=>e.code==="INVOICE_TEXT_UNSUPPORTED");
 invoice.billingName="X".repeat(4001);await assert.rejects(()=>render(invoice),(e:any)=>e.code==="INVOICE_TEXT_TOO_LONG");
 invoice.billingName="Synthetic";invoice.total=NaN;await assert.rejects(()=>render(invoice),(e:any)=>e.code==="INVOICE_AMOUNTS_INVALID");
});
