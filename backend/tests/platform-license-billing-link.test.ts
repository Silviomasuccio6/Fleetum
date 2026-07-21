import assert from "node:assert/strict";
import test from "node:test";
import { preservePlatformLicenseBillingLink } from "../src/application/services/platform-license-billing-link.js";

test("platform license updates preserve Stripe customer and subscription links", () => {
  assert.deepEqual(
    preservePlatformLicenseBillingLink({
      provider: "stripe",
      stripeCustomerId: "cus_test_existing",
      stripeSubscriptionId: "sub_test_existing"
    }),
    {
      provider: "stripe",
      stripeCustomerId: "cus_test_existing",
      stripeSubscriptionId: "sub_test_existing"
    }
  );
});

test("platform license updates keep genuinely local subscriptions local", () => {
  assert.deepEqual(
    preservePlatformLicenseBillingLink({
      provider: "local",
      stripeCustomerId: null,
      stripeSubscriptionId: null
    }),
    {
      provider: "local",
      stripeCustomerId: null,
      stripeSubscriptionId: null
    }
  );
});

test("platform license updates default new subscriptions to local", () => {
  assert.deepEqual(preservePlatformLicenseBillingLink(null), {
    provider: "local",
    stripeCustomerId: null,
    stripeSubscriptionId: null
  });
});
