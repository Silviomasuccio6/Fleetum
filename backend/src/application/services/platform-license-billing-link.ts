export type SubscriptionBillingLink = {
  provider: "stripe" | "local";
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
};

export const preservePlatformLicenseBillingLink = (
  current: SubscriptionBillingLink | null
): Required<SubscriptionBillingLink> => {
  if (current?.provider === "stripe") {
    return {
      provider: "stripe",
      stripeCustomerId: current.stripeCustomerId ?? null,
      stripeSubscriptionId: current.stripeSubscriptionId ?? null
    };
  }

  return {
    provider: "local",
    stripeCustomerId: null,
    stripeSubscriptionId: null
  };
};
