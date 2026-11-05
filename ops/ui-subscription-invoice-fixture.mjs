import { tsImport } from "tsx/esm/api";
// Synthetic local preview: pure renderer only, no DB, env loader or provider.
let renderer;
export const uiSubscriptionInvoiceData = (now = new Date()) => ({
  id: "demo-invoice-1", invoiceNumber: "DEMO-2026-001", issueDate: now, dueDate: now, periodStart: now, periodEnd: now,
  status: "GENERATED", currency: "EUR", subtotal: 149, taxRate: 22, taxAmount: 32.78, total: 181.78,
  billingName: "Autonoleggio Demo - azienda fittizia", billingAddress: "Via di prova 1, Milano", billingVatNumber: "00000000000",
  billingTaxCode: null, billingEmail: "noleggio@example.invalid", billingPec: null, billingSdi: null,
  notes: "FACSIMILE - DATI SINTETICI. Nessuna emissione o richiesta di pagamento.",
  items: [{ description: "Abbonamento Fleetum STARTER (mensile)", quantity: 1, unitPrice: 149, subtotal: 149, taxRate: 22, taxAmount: 32.78, total: 181.78 }]
});
export const uiSubscriptionInvoiceFixture = async now => {
  renderer ??= tsImport("../backend/src/application/services/subscription-invoice-pdf.ts", import.meta.url);
  const { renderSubscriptionInvoicePdf } = await renderer;
  return renderSubscriptionInvoicePdf(uiSubscriptionInvoiceData(now), {
    name: "Fleetum - emittente dimostrativo", address: "Via sintetica 10, Roma", vat: "P.IVA 00000000000",
    email: "billing@fleetum.example.invalid", pec: "", sdi: "", iban: "", website: "fleetum.it"
  });
};
