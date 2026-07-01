import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const seed = readFileSync(resolve("prisma/seed.ts"), "utf8");

const modelBlock = (name: string) => {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Missing Prisma model ${name}`);
  return match[1]!;
};

const rentalPaymentModels = [
  "RentalCustomerPaymentProfile",
  "RentalCustomerPaymentMethod",
  "RentalDeposit",
  "RentalExtraCharge",
  "RentalPaymentEvent"
] as const;

test("rental payment foundations keep end-customer payments separate from SaaS billing", () => {
  for (const model of rentalPaymentModels) {
    assert.ok(schema.includes(`model ${model}`), `Missing model ${model}`);
  }

  assert.ok(!modelBlock("TenantSubscription").includes("rentalCustomer"), "SaaS subscriptions must not reference rental customers");
  assert.ok(!modelBlock("BillingEvent").includes("RentalDeposit"), "SaaS BillingEvent must not be reused for rental deposits");
});

test("rental payment models are tenant-scoped and indexed for tenant isolation", () => {
  for (const model of rentalPaymentModels) {
    const block = modelBlock(model);
    assert.match(block, /tenantId\s+String/, `${model} must include tenantId`);
    assert.match(block, /tenant\s+Tenant\s+@relation/, `${model} must relate to Tenant`);
    assert.match(block, /@@index\(\[tenantId/, `${model} must include tenant-scoped indexes`);
  }
});

test("rental monetary amounts use integer cents, never Float", () => {
  for (const model of ["RentalDeposit", "RentalExtraCharge"] as const) {
    const block = modelBlock(model);
    assert.doesNotMatch(block, /\bFloat\b/, `${model} must not use Float for money`);
    assert.match(block, /amountCents\s+Int/, `${model} must store amountCents as Int`);
  }

  assert.match(modelBlock("RentalDeposit"), /capturedAmountCents\s+Int\s+@default\(0\)/);
  assert.match(modelBlock("RentalExtraCharge"), /adminFeeCents\s+Int\s+@default\(0\)/);
  assert.match(modelBlock("RentalExtraCharge"), /totalAmountCents\s+Int/);
});

test("rental payment methods store only safe Stripe card metadata", () => {
  const block = modelBlock("RentalCustomerPaymentMethod");
  const forbiddenFields = ["cardNumber", "pan", "cvv", "cvc", "securityCode", "threeDSCode", "cardImage", "cardPhoto"];

  for (const field of forbiddenFields) {
    assert.ok(!new RegExp(`\\b${field}\\b`, "i").test(block), `Forbidden sensitive card field found: ${field}`);
  }

  for (const safeField of ["stripePaymentMethodId", "stripeSetupIntentId", "cardBrand", "cardLast4", "cardExpMonth", "cardExpYear"]) {
    assert.ok(block.includes(safeField), `Expected safe metadata field ${safeField}`);
  }
});

test("seed defines dedicated rental payment permissions without reusing billing permissions", () => {
  for (const permission of [
    "rental-payments:read",
    "rental-payments:write",
    "rental-payments:charge",
    "rental-payments:refund"
  ]) {
    assert.ok(seed.includes(`"${permission}"`), `Missing permission ${permission}`);
  }

  assert.ok(seed.includes('"rental-payments:refund"'), "ADMIN permission list must include refunds");
  assert.match(seed, /MANAGER:[\s\S]*"rental-payments:refund"/, "Manager rule must explicitly consider refund permission");
  assert.match(seed, /OPERATOR:[\s\S]*"rental-payments:read"[\s\S]*"rental-payments:write"/);
  assert.match(seed, /VIEWER:[\s\S]*"rental-payments:read"/);
});
