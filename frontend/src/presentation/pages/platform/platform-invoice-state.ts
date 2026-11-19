import type { PlatformInvoice } from "../../../application/usecases/platform/platform-admin-usecases";

// Generation may return an existing invoice for an already billed period.
export const upsertPlatformInvoice = (invoices: PlatformInvoice[], invoice: PlatformInvoice): PlatformInvoice[] =>
  [invoice, ...invoices.filter((item) => item.id !== invoice.id)];
