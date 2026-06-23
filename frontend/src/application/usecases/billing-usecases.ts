import { httpClient } from "../../infrastructure/api/http-client";
import type { SaasPlan } from "../../domain/constants/entitlements";

type BillingCycle = "monthly" | "yearly";

export const billingUseCases = {
  createCheckoutSession: (input: { plan: SaasPlan; billingCycle: BillingCycle }) =>
    httpClient.post<{ mode: "stripe" | "local"; checkoutUrl: string }>(
      "/billing/checkout-session",
      input,
      { suppressSuccessToast: true }
    ),
  createPaymentMethodSession: () =>
    httpClient.post<{ mode: "stripe"; checkoutUrl: string }>(
      "/billing/payment-method-session",
      {},
      { suppressSuccessToast: true }
    ),
  createCustomerPortalSession: () =>
    httpClient.post<{ portalUrl: string }>(
      "/billing/customer-portal-session",
      {},
      { suppressSuccessToast: true }
    ),
  listInvoices: () =>
    httpClient.get<{
      data: Array<{
        id: string;
        invoiceNumber: string;
        issueDate: string;
        dueDate: string;
        periodStart: string;
        periodEnd: string;
        status: string;
        currency: string;
        subtotal: number;
        taxRate: number;
        taxAmount: number;
        total: number;
        billingName: string;
        billingEmail?: string | null;
        sentAt?: string | null;
      }>;
    }>("/billing/invoices"),
  invoicePdfUrl: (invoiceId: string) => `/api/billing/invoices/${invoiceId}/pdf`
};
