import { scopedFetch } from "../../infrastructure/api/scoped-fetch";
import { getApiBaseUrl } from "../../infrastructure/api/api-base-url";
import { captureSiteStamp, assertSiteStamp } from "../stores/site-access-store";
import { httpClient } from "../../infrastructure/api/http-client";
import type { SaasPlan } from "../../domain/constants/entitlements";

type BillingCycle = "monthly" | "yearly";
type CustomerPortalInput = { plan: SaasPlan; billingCycle: BillingCycle };
type BillingAnalyticsContext = {
  visitorId?: string;
  sessionId?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
};

export const billingUseCases = {
  createCheckoutSession: (input: { plan: SaasPlan; billingCycle: BillingCycle; analytics?: BillingAnalyticsContext }) =>
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
  createCustomerPortalSession: (input?: CustomerPortalInput) =>
    httpClient.post<{ portalUrl: string }>(
      "/billing/customer-portal-session",
      input ?? {},
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

export const downloadSubscriptionInvoicePdf = async (invoiceId: string, signal?: AbortSignal): Promise<Blob> => {
  const stamp = captureSiteStamp();
  const response = await scopedFetch(`${getApiBaseUrl()}/billing/invoices/${encodeURIComponent(invoiceId)}/pdf`, {
    credentials: "include", cache: "no-store", headers: { Accept: "application/pdf" }, signal
  });
  if (!response.ok) {
    let message = "Copia PDF non disponibile. Riprova.";
    try { const error = await response.json(); if (typeof error?.message === "string" && error.message.length <= 400) message = error.message; } catch { /* Use the actionable default. */ }
    throw new Error(message);
  }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/pdf")) throw new Error("Il servizio non ha restituito un PDF valido. Riprova.");
  const blob = await response.blob();
  if (!blob.size || blob.size > 10 * 1024 * 1024 || new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer()) !== "%PDF-") throw new Error("Il servizio non ha restituito un PDF valido. Riprova.");
  assertSiteStamp(stamp);
  return blob;
};
