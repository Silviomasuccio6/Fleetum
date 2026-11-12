import assert from "node:assert/strict";
import test from "node:test";
import {
  rentalBookingCreateSchema,
  rentalBookingUpdateSchema,
  rentalCustomerUpdateSchema,
  rentalPricingCreateListSchema,
  rentalPricingUpdateListSchema,
  rentalPricingUpdatePackageSchema,
  rentalPricingUpdateExtraPolicySchema
} from "../src/interfaces/http/validators/rental-bookings-validators.js";
import {
  integrationsSettingsSchema,
  playbooksSettingsSchema,
  reportsSettingsSchema
} from "../src/interfaces/http/validators/settings-validators.js";

for (const [name, schema] of [
  ["list", rentalPricingUpdateListSchema],
  ["package", rentalPricingUpdatePackageSchema],
  ["policy", rentalPricingUpdateExtraPolicySchema]
] as const) {
  test("partial " + name + " updates preserve omitted fields and explicit false", () => {
    assert.deepEqual(schema.parse({}), {});
    assert.deepEqual(schema.parse({ name: "Synthetic update" }), { name: "Synthetic update" });
    assert.deepEqual(schema.parse({ isActive: false }), { isActive: false });
    const explicit = schema.parse({ isActive: undefined });
    assert.ok(Object.hasOwn(explicit, "isActive"));
    assert.equal(explicit.isActive, undefined);
  });
}

test("partial customer updates cannot introduce a different customer type", () => {
  assert.deepEqual(rentalCustomerUpdateSchema.parse({ companyName: "Synthetic company" }), {
    companyName: "Synthetic company"
  });
  assert.deepEqual(rentalCustomerUpdateSchema.parse({}), {});
});

test("booking updates preserve omitted fields while creation retains its defaults", () => {
  assert.deepEqual(rentalBookingUpdateSchema.parse({ internalNotes: "Synthetic note" }), {
    internalNotes: "Synthetic note"
  });
  const input = {
    vehicleId: "synthetic-vehicle",
    customerId: "synthetic-customer",
    pickupAt: "2035-01-01T10:00:00Z",
    returnAt: "2035-01-02T10:00:00Z"
  };
  const created = rentalBookingCreateSchema.parse(input);
  assert.equal(created.generateContract, true);
  assert.ok(created.pickupAt instanceof Date);
  assert.equal(rentalBookingCreateSchema.safeParse({
    ...input, returnAt: "2034-01-01T10:00:00Z"
  }).success, false);
  const list = rentalPricingCreateListSchema.parse({ name: "Synthetic list", baseRateAmount: "19.50" });
  assert.equal(list.baseRateAmount, 19.5);
  assert.equal(list.vatRate, 22);
  assert.equal(list.scope, "GLOBAL");
  assert.equal(list.isActive, true);
});

test("missing coerced settings flags preserve the previous false defaults", () => {
  assert.equal(reportsSettingsSchema.parse({
    recipients: [], frequency: "weekly", hour: 8, minute: 0, reportStyle: "EXECUTIVE"
  }).enabled, false);
  const playbooks = playbooksSettingsSchema.parse({
    WAITING_PARTS: { reminderEveryDays: 3 },
    SOLICITED: { reminderEveryDays: 2 }
  });
  assert.equal(playbooks.WAITING_PARTS.enabled, false);
  assert.equal(playbooks.SOLICITED.enabled, false);
  assert.deepEqual(integrationsSettingsSchema.parse({}), {
    erpWebhookUrl: "", telematicsWebhookUrl: "", ticketingWebhookUrl: ""
  });
});
