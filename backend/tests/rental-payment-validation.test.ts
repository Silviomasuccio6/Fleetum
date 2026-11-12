import assert from "node:assert/strict";
import test from "node:test";
import { ZodError } from "zod";
import { rentalPaymentSetupSessionSchema } from "../src/interfaces/http/validators/rental-payments-validators.js";

const mandateMessage = "Devi accettare il mandato per registrare la carta del cliente.";

test("card setup preserves explicit mandate consent and normalized terms", () => {
  assert.deepEqual(rentalPaymentSetupSessionSchema.parse({
    mandateAccepted: true,
    termsVersion: " synthetic-v1 ",
    ignored: "not part of the payment setup request"
  }), {
    mandateAccepted: true,
    termsVersion: "synthetic-v1"
  });
});

test("missing, declined and non-boolean mandate consent preserve the validation message", () => {
  for (const mandateAccepted of [undefined, false, null, "true", 1, {}, []]) {
    const result = rentalPaymentSetupSessionSchema.safeParse({
      mandateAccepted,
      termsVersion: "synthetic-v1"
    });
    assert.equal(result.success, false);
    if (result.success) throw new Error("Explicit consent must be required.");
    assert.ok(result.error instanceof ZodError);
    assert.deepEqual(result.error.flatten(), {
      formErrors: [],
      fieldErrors: { mandateAccepted: [mandateMessage] }
    });
  }
});

test("accepting the mandate does not bypass required payment terms", () => {
  for (const termsVersion of [undefined, "", "   "]) {
    const result = rentalPaymentSetupSessionSchema.safeParse({
      mandateAccepted: true,
      termsVersion
    });
    assert.equal(result.success, false);
    if (result.success) throw new Error("A terms version must still be required.");
    assert.ok(result.error.flatten().fieldErrors.termsVersion?.length);
  }
});
