import { COMMERCIAL_PLAN_CATALOG, getCommercialPlanPriceCents } from "../../packages/commercial-plan-catalog/index.js";

const requireQa = (condition, code) => { if (!condition) throw Error(`PROVIDER_QA_STRIPE_${code}`); };
const sameSet = (a, b) => Array.isArray(a) && a.length === b.length &&
  new Set(a).size === a.length && [...a].sort().every((value, i) => value === [...b].sort()[i]);

// Does not load dotenv, start the app, write to Stripe, retry, or persist raw responses.
export async function verifyStripeQa(raw, requestJson) {
  requireQa(/^sk_test_[A-Za-z0-9]{16,}$/.test(raw.STRIPE_SECRET_KEY ?? ""), "KEY_REFUSED");
  requireQa(/^acct_[A-Za-z0-9]+$/.test(raw.FLEETUM_PROVIDER_QA_STRIPE_ACCOUNT_ID ?? ""), "ACCOUNT_REFUSED");
  requireQa(/^bpc_[A-Za-z0-9]+$/.test(raw.STRIPE_BILLING_PORTAL_CONFIGURATION_ID ?? ""), "PORTAL_ID_REFUSED");
  const bindings = Object.keys(COMMERCIAL_PLAN_CATALOG).flatMap(plan => ["monthly", "yearly"].map(cycle => ({
    plan, cycle, id: raw[COMMERCIAL_PLAN_CATALOG[plan].stripePriceEnv[cycle]]
  })));
  requireQa(bindings.every(p => /^price_[A-Za-z0-9]+$/.test(p.id ?? "")) &&
    new Set(bindings.map(p => p.id)).size === 6, "PRICE_BINDINGS_REFUSED");
  const deadline = AbortSignal.timeout(30000);
  let requests = 0;
  const get = async path => {
    requireQa(++requests <= 7, "REQUEST_CAP");
    try {
      if (requestJson) return await requestJson(path, deadline);
      const response = await fetch(`https://api.stripe.com${path}`, { method: "GET", redirect: "error",
        headers: { Authorization: `Bearer ${raw.STRIPE_SECRET_KEY}`, Accept: "application/json" },
        signal: AbortSignal.any([deadline, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw Error("provider HTTP failure");
      const reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > 1048576) { await reader.cancel(); throw Error("response too large"); }
        chunks.push(Buffer.from(part.value));
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      // Network/SDK errors may include credentials. Never propagate them.
      throw Error("PROVIDER_QA_STRIPE_READ_FAILED");
    }
  };
  const account = await get("/v1/account");
  requireQa(account?.object === "account" && account.id === raw.FLEETUM_PROVIDER_QA_STRIPE_ACCOUNT_ID, "ACCOUNT_MISMATCH");
  const balance = await get("/v1/balance");
  requireQa(balance?.object === "balance" && balance.livemode === false, "MODE_REFUSED");
  const listed = await get("/v1/prices?active=true&limit=10");
  requireQa(listed?.object === "list" && listed.has_more === false && Array.isArray(listed.data) &&
    listed.data.length === 6, "CATALOG_REFUSED");
  const prices = listed.data;
  for (const binding of bindings) {
    const found = prices.filter(p => p.id === binding.id);
    requireQa(found.length === 1, "PRICE_MISMATCH");
    const p = found[0];
    requireQa(p.object === "price" && p.active === true && p.livemode === false && p.currency === "eur" &&
      p.unit_amount === getCommercialPlanPriceCents(binding.plan, binding.cycle) && p.tax_behavior === "inclusive" &&
      p.type === "recurring" && p.recurring?.interval === (binding.cycle === "monthly" ? "month" : "year") &&
      p.recurring?.interval_count === 1 && p.recurring?.usage_type === "licensed" &&
      /^prod_[A-Za-z0-9]+$/.test(p.product ?? ""), "PRICE_MISMATCH");
  }
  const productIds = [...new Set(prices.map(p => p.product))];
  requireQa(productIds.length === 3, "PRODUCT_BINDING_REFUSED");
  for (const id of productIds) {
    const product = await get(`/v1/products/${id}`);
    const bound = bindings.filter(b => prices.find(p => p.id === b.id).product === id);
    requireQa(product?.object === "product" && product.id === id && product.active === true && product.livemode === false &&
      bound.length === 2 && new Set(bound.map(b => b.plan)).size === 1 &&
      product.metadata?.fleetum_plan === bound[0].plan, "PRODUCT_MISMATCH");
  }
  const portal = await get(`/v1/billing_portal/configurations/${raw.STRIPE_BILLING_PORTAL_CONFIGURATION_ID}?expand%5B%5D=features.subscription_update.products`);
  const update = portal?.features?.subscription_update;
  requireQa(portal?.id === raw.STRIPE_BILLING_PORTAL_CONFIGURATION_ID && portal.active === true && portal.livemode === false &&
    portal.default_return_url === "http://localhost:5273/upgrade?portal=returned" && portal.login_page?.enabled === false &&
    portal.features?.invoice_history?.enabled === true && portal.features?.payment_method_update?.enabled === true &&
    portal.features?.subscription_cancel?.enabled === true && portal.features.subscription_cancel.mode === "at_period_end" &&
    update?.enabled === true && sameSet(update.default_allowed_updates, ["price"]) &&
    update.trial_update_behavior === "continue_trial" && update.billing_cycle_anchor === "unchanged" &&
    update.proration_behavior === "always_invoice" && Array.isArray(update.products) && update.products.length === 3 &&
    sameSet(update.products.map(p => p.product), productIds), "PORTAL_MISMATCH");
  for (const product of update.products) requireQa(product.adjustable_quantity?.enabled === false &&
    sameSet(product.prices, prices.filter(p => p.product === product.product).map(p => p.id)), "PORTAL_PRICE_MISMATCH");
  return { account: account.id, livemode: false, prices: 6, products: 3,
    portal: portal.id, requests, methods: ["GET"], completedAt: new Date().toISOString() };
}
