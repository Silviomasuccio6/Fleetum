import assert from "node:assert/strict";
import test from "node:test";
import type { PlatformInvoice } from "../src/application/usecases/platform/platform-admin-usecases";
import { upsertPlatformInvoice } from "../src/presentation/pages/platform/platform-invoice-state";

const invoice = (id: string, status: PlatformInvoice["status"] = "GENERATED"): PlatformInvoice => ({
  id, tenantId: "synthetic", tenantName: "QA", invoiceNumber: `QA-${id}`,
  issueDate: "2026-11-13", dueDate: "2026-12-13", periodStart: "2026-11-13", periodEnd: "2026-12-13",
  status, currency: "EUR", subtotal: 100, taxRate: 22, taxAmount: 22, total: 122,
  billingName: "Synthetic", createdAt: "2026-11-13", deliveries: [], items: []
});

test("regenerating an existing invoice does not duplicate rows or double totals", () => {
  const existing = [invoice("same"), invoice("other")];
  const result = upsertPlatformInvoice(existing, invoice("same", "SENT"));
  assert.equal(result.length, 2);
  assert.equal(result.reduce((sum, row) => sum + row.total, 0), 244);
  assert.equal(result[0].status, "SENT");
  assert.equal(existing[0].status, "GENERATED", "do not mutate previous UI state");
});

test("a genuinely new invoice is added while preserving all other invoices", () => {
  const existing = [invoice("old")];
  assert.deepEqual(upsertPlatformInvoice(existing, invoice("new")).map((row) => row.id), ["new", "old"]);
});
