import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  readTenantSubscription,
  upsertStripeTenantSubscriptionIfCurrent,
  upsertTenantSubscription
} from "../../src/application/services/tenant-subscription-service.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";

const runId = `billing-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let tenantId = "";

const writeStripeStatus = async (
  status: "ACTIVE" | "PAST_DUE" | "CANCELED",
  expectedCurrent: Awaited<ReturnType<typeof readTenantSubscription>>,
  stripeSubscriptionId = "sub_billing_race_current"
) => upsertStripeTenantSubscriptionIfCurrent({
  tenantId,
  plan: "PRO",
  seats: 5,
  status,
  expiresAt: new Date("2030-03-17T17:46:40.000Z").toISOString(),
  priceMonthly: 199,
  billingCycle: "monthly",
  provider: "stripe",
  stripeCustomerId: "cus_billing_race",
  stripeSubscriptionId
}, {
  stripeSubscriptionId,
  stripeCustomerId: "cus_billing_race",
  expectedCurrent
});

describe("Stripe tenant subscription PostgreSQL concurrency", () => {
  before(async () => {
    await prisma.$connect();
    const tenant = await prisma.tenant.create({
      data: {
        name: `Billing Race ${runId}`,
        vatNumber: `IT${Date.now().toString().slice(-11)}`
      }
    });
    tenantId = tenant.id;
    await upsertTenantSubscription({
      tenantId,
      plan: "PRO",
      seats: 5,
      status: "PAST_DUE",
      expiresAt: new Date("2029-11-21T00:00:00.000Z").toISOString(),
      priceMonthly: 199,
      billingCycle: "monthly",
      provider: "stripe",
      stripeCustomerId: "cus_billing_race",
      stripeSubscriptionId: "sub_billing_race_current"
    });
  });

  after(async () => {
    if (tenantId) {
      await prisma.tenantSubscription.deleteMany({ where: { tenantId } });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  it("allows only one writer for the same expected snapshot", async () => {
    const expected = await readTenantSubscription(tenantId);
    assert.ok(expected);

    const results = await Promise.all([
      writeStripeStatus("ACTIVE", expected),
      writeStripeStatus("CANCELED", expected)
    ]);

    assert.equal(results.filter((result) => result.applied).length, 1);
    assert.equal(results.filter((result) => result.reason === "STALE_SNAPSHOT").length, 1);
    const current = await readTenantSubscription(tenantId);
    assert.equal(current?.status, results.find((result) => result.applied)?.subscription?.status);
  });

  it("rejects a delayed stale response and an obsolete subscription id", async () => {
    await upsertTenantSubscription({
      tenantId,
      plan: "PRO",
      seats: 5,
      status: "PAST_DUE",
      expiresAt: new Date("2029-11-21T00:00:00.000Z").toISOString(),
      priceMonthly: 199,
      billingCycle: "monthly",
      provider: "stripe",
      stripeCustomerId: "cus_billing_race",
      stripeSubscriptionId: "sub_billing_race_current"
    });
    const staleExpected = await readTenantSubscription(tenantId);
    assert.ok(staleExpected);

    const authoritative = await writeStripeStatus("CANCELED", staleExpected);
    assert.equal(authoritative.applied, true);

    const delayed = await writeStripeStatus("ACTIVE", staleExpected);
    assert.equal(delayed.applied, false);
    assert.equal(delayed.reason, "STALE_SNAPSHOT");

    const current = await readTenantSubscription(tenantId);
    assert.equal(current?.status, "CANCELED");
    const obsolete = await writeStripeStatus("ACTIVE", current, "sub_billing_race_obsolete");
    assert.equal(obsolete.applied, false);
    assert.equal(obsolete.reason, "SUBSCRIPTION_REPLACED");
    assert.equal((await readTenantSubscription(tenantId))?.stripeSubscriptionId, "sub_billing_race_current");
  });
});
