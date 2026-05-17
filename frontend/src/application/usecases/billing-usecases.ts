import { httpClient } from "../../infrastructure/api/http-client";
import type { SaasPlan } from "../../domain/constants/entitlements";

type BillingCycle = "monthly" | "yearly";

export const billingUseCases = {
  createCheckoutSession: (input: { plan: SaasPlan; billingCycle: BillingCycle }) =>
    httpClient.post<{ mode: "stripe" | "local"; checkoutUrl: string }>(
      "/billing/checkout-session",
      input,
      { suppressSuccessToast: true }
    )
};
