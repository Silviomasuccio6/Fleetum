import assert from "node:assert/strict";
import test from "node:test";
import { isBillingSelfServiceRoute } from "../src/presentation/routes/billing-self-service-routes";

test("billing self-service routes are limited to activation, upgrade and company onboarding", () => {
  assert.equal(isBillingSelfServiceRoute("/activate"), true);
  assert.equal(isBillingSelfServiceRoute("/upgrade"), true);
  assert.equal(isBillingSelfServiceRoute("/onboarding/azienda"), true);
  assert.equal(isBillingSelfServiceRoute("/upgrade/payment-method"), true);

  assert.equal(isBillingSelfServiceRoute("/dashboard"), false);
  assert.equal(isBillingSelfServiceRoute("/booking"), false);
  assert.equal(isBillingSelfServiceRoute("/statistiche"), false);
});

