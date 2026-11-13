import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { COMMERCIAL_PLAN_CATALOG, getCommercialPlanPriceCents } from "../../packages/commercial-plan-catalog/index.js";
import { verifyStripeQa } from "../provider-qa/stripe-preflight.mjs";

function fixture() {
  const raw = { STRIPE_SECRET_KEY: ["sk", "test", "synthetic".repeat(5)].join("_"),
    FLEETUM_PROVIDER_QA_STRIPE_ACCOUNT_ID: "acct_syntheticQA", STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_syntheticQA" };
  const prices = [];
  const products = [];
  for (const plan of Object.keys(COMMERCIAL_PLAN_CATALOG)) {
    const product = { id: `prod_${plan}`, object: "product", active: true, livemode: false, metadata: { fleetum_plan: plan } };
    products.push(product);
    for (const cycle of ["monthly", "yearly"]) {
      const id = `price_${plan}${cycle}`;
      raw[COMMERCIAL_PLAN_CATALOG[plan].stripePriceEnv[cycle]] = id;
      prices.push({ id, object: "price", product: product.id, active: true, livemode: false,
        currency: "eur", unit_amount: getCommercialPlanPriceCents(plan, cycle), tax_behavior: "inclusive",
        type: "recurring", recurring: { interval: cycle === "monthly" ? "month" : "year", interval_count: 1, usage_type: "licensed" } });
    }
  }
  const portal = { id: raw.STRIPE_BILLING_PORTAL_CONFIGURATION_ID, active: true, livemode: false,
    default_return_url: "http://localhost:5273/upgrade?portal=returned", login_page: { enabled: false },
    features: { invoice_history: { enabled: true }, payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: { enabled: true, default_allowed_updates: ["price"], trial_update_behavior: "continue_trial",
        billing_cycle_anchor: "unchanged", proration_behavior: "always_invoice",
        products: products.map(p => ({ product: p.id, prices: prices.filter(x => x.product === p.id).map(x => x.id), adjustable_quantity: { enabled: false } })) } } };
  const calls = [];
  const account = { object: "account", id: raw.FLEETUM_PROVIDER_QA_STRIPE_ACCOUNT_ID };
  const balance = { object: "balance", livemode: false };
  const request = async path => {
    calls.push(path);
    if (path === "/v1/account") return account;
    if (path === "/v1/balance") return balance;
    if (path.startsWith("/v1/prices?")) return { object: "list", has_more: false, data: prices };
    if (path.startsWith("/v1/products/")) return products.find(p => path === `/v1/products/${p.id}`);
    if (path.startsWith("/v1/billing_portal/configurations/")) return portal;
    throw Error("unexpected request");
  };
  return { raw, prices, products, portal, account, balance, calls, request };
}

test("Stripe QA preflight binds the test account, canonical catalog and complete portal using seven reads", async () => {
  const f = fixture();
  const result = await verifyStripeQa(f.raw, f.request);
  assert.equal(result.account, f.account.id);
  assert.equal(result.livemode, false);
  assert.equal(result.prices, 6);
  assert.equal(f.calls.length, 7);
  assert(!JSON.stringify(result).includes(f.raw.STRIPE_SECRET_KEY));
});

test("live credentials, absent prices and duplicate price bindings fail before network access", async () => {
  for (const mutate of [f => { f.raw.STRIPE_SECRET_KEY = ["sk", "live", "synthetic".repeat(5)].join("_"); },
    f => { delete f.raw.STRIPE_PRICE_PRO_YEARLY; },
    f => { f.raw.STRIPE_PRICE_PRO_YEARLY = f.raw.STRIPE_PRICE_PRO_MONTHLY; }]) {
    const f = fixture(); mutate(f);
    await assert.rejects(verifyStripeQa(f.raw, f.request), /PROVIDER_QA_STRIPE_/);
    assert.equal(f.calls.length, 0);
  }
});

test("another account or live balance stops before reading any catalog", async () => {
  const f = fixture(); f.account.id = "acct_other";
  await assert.rejects(verifyStripeQa(f.raw, f.request), /ACCOUNT/);
  assert.deepEqual(f.calls, ["/v1/account"]);
  const g = fixture(); g.balance.livemode = true;
  await assert.rejects(verifyStripeQa(g.raw, g.request), /MODE/);
  assert.equal(g.calls.length, 2);
});

test("incorrect tax, amount, recurrence, product metadata and portal allowlist prevent startup", async t => {
  const cases = [
    ["tax", f => { f.prices[0].tax_behavior = "exclusive"; }],
    ["amount", f => { f.prices[0].unit_amount += 1; }],
    ["interval", f => { f.prices[0].recurring.interval_count = 2; }],
    ["product", f => { f.products[0].metadata.fleetum_plan = "ENTERPRISE"; }],
    ["extra portal price", f => { f.portal.features.subscription_update.products[0].prices.push("price_unapproved"); }],
    ["quantity", f => { f.portal.features.subscription_update.products[0].adjustable_quantity.enabled = true; }],
    ["trial", f => { f.portal.features.subscription_update.trial_update_behavior = "end_trial"; }],
    ["return", f => { f.portal.default_return_url = "https://fleetum.it/upgrade"; }],
    ["public link", f => { f.portal.login_page.enabled = true; }]
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const f = fixture(); mutate(f);
    await assert.rejects(verifyStripeQa(f.raw, f.request), /PROVIDER_QA_STRIPE_/);
  });
});

test("provider errors cannot expose credentials through the startup error", async () => {
  const f = fixture();
  await assert.rejects(verifyStripeQa(f.raw, async () => { throw Error(f.raw.STRIPE_SECRET_KEY); }), error => {
    assert.equal(error.message, "PROVIDER_QA_STRIPE_READ_FAILED");
    assert(!String(error).includes(f.raw.STRIPE_SECRET_KEY));
    return true;
  });
});

test("the separate Stripe entrypoint refuses ordinary, production and other provider modes before app import", () => {
  for (const changed of [{ FLEETUM_ENVIRONMENT: "production" }, { NODE_ENV: "production" },
    { DOTENV_CONFIG_PATH: "/forbidden-real-env" }, { FLEETUM_PROVIDER_QA_MODE: "offline" },
    { FLEETUM_PROVIDER_QA_MODE: "google" }, { FLEETUM_PROVIDER_QA_MODE: "both" }]) {
    const child = spawnSync(process.execPath, ["--import", "tsx", "ops/provider-qa/serve-stripe.mts"], {
      cwd: new URL("../..", import.meta.url), timeout: 10000, encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", FLEETUM_ENVIRONMENT: "provider-qa", NODE_ENV: "test",
        DOTENV_CONFIG_PATH: "/dev/null", FLEETUM_PROVIDER_QA_MODE: "stripe", ...changed }
    });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /PROVIDER_QA_STRIPE_ENTRYPOINT_REFUSED/);
  }
});
