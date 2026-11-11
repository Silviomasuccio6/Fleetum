export const subscriptionInvoiceFixture = () => ({
  id: "synthetic_invoice", tenantId: "synthetic_tenant", invoiceNumber: "FLT-2035-00001",
  issueDate: new Date("2035-01-04T10:00:00Z"), dueDate: new Date("2035-01-18T10:00:00Z"),
  periodStart: new Date("2035-01-01T00:00:00Z"), periodEnd: new Date("2035-01-31T23:59:59Z"),
  status: "GENERATED", currency: "EUR", subtotal: 149, taxRate: 22, taxAmount: 32.78, total: 181.78,
  billingName: "Autonoleggio Sintetico Srl", billingVatNumber: "00000000000", billingTaxCode: null,
  billingAddress: "Via di prova 1, 00100 Roma", billingEmail: "billing@example.invalid", billingPec: null, billingSdi: null,
  notes: "FACSIMILE - DATI SINTETICI. Nessuna emissione o richiesta di pagamento.", pdfFilePath: null,
  createdAt: new Date("2035-01-04T10:00:00Z"), updatedAt: new Date("2035-01-04T10:00:00Z"), sentAt: null, deletedAt: null,
  tenant: { id: "synthetic_tenant", name: "Current tenant name must not replace snapshot" }, deliveries: [],
  items: [{ id: "synthetic_item", invoiceId: "synthetic_invoice", description: "Abbonamento Fleetum STARTER (mensile)", quantity: 1, unitPrice: 149, subtotal: 149, taxRate: 22, taxAmount: 32.78, total: 181.78 }]
});
export const subscriptionIssuerFixture = () => ({ name: "Fleetum - Emittente dimostrativo", vat: "P.IVA 00000000000", address: "Via sintetica 10, Roma", email: "billing@fleetum.example.invalid", pec: "", sdi: "", iban: "", website: "fleetum.it" });
