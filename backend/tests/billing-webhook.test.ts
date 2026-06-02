import crypto from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BillingController } from "../src/interfaces/http/controllers/billing-controller.js";
import { AppError } from "../src/shared/errors/app-error.js";
import { createMockReq, createMockRes } from "./helpers/mock-req-res.js";

const webhookSecret = "whsec_test_webhook_secret_000000000000";

const generateTestHeaderString = (payload: Buffer, secret = webhookSecret) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload.toString("utf8")}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
};

const createController = () => {
  const billingService = {
    calls: [] as Array<{ signature?: string; rawBody?: Buffer; body: unknown }>,
    async handleWebhook(input: { signature?: string; rawBody?: Buffer; body: unknown }) {
      this.calls.push(input);
      if (!input.signature) throw new AppError("Firma webhook Stripe mancante", 400, "STRIPE_SIGNATURE_MISSING");
      if (input.signature !== generateTestHeaderString(input.rawBody ?? Buffer.from(JSON.stringify(input.body)))) {
        throw new AppError("Firma webhook Stripe non valida", 400, "STRIPE_SIGNATURE_INVALID");
      }
      return { received: true };
    }
  };

  const invoiceService = {};
  return {
    controller: new BillingController(billingService as never, invoiceService as never),
    billingService
  };
};

describe("BillingController.webhook", () => {
  it("rejects requests without stripe-signature and does not process them", async () => {
    const { controller, billingService } = createController();
    const req = createMockReq({ body: { type: "checkout.session.completed" }, headers: {} });

    await assert.rejects(
      () => controller.webhook(req, createMockRes()),
      (error) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "STRIPE_SIGNATURE_MISSING");
        return true;
      }
    );
    assert.equal(billingService.calls.length, 1);
  });

  it("processes requests with a valid Stripe signature", async () => {
    const { controller, billingService } = createController();
    const rawBody = Buffer.from(JSON.stringify({ id: "evt_test", type: "checkout.session.completed" }));
    const signature = generateTestHeaderString(rawBody);
    const req = createMockReq({
      body: JSON.parse(rawBody.toString("utf8")),
      headers: { "stripe-signature": signature }
    }) as typeof createMockReq extends (...args: never[]) => infer R ? R & { rawBody?: Buffer } : never;
    req.rawBody = rawBody;
    const res = createMockRes();

    await controller.webhook(req, res);

    assert.deepEqual(res.body, { received: true });
    assert.equal(billingService.calls.length, 1);
    assert.equal(billingService.calls[0]?.signature, signature);
  });

  it("rejects requests with an invalid Stripe signature", async () => {
    const { controller } = createController();
    const rawBody = Buffer.from(JSON.stringify({ id: "evt_test", type: "invoice.payment_failed" }));
    const req = createMockReq({
      body: JSON.parse(rawBody.toString("utf8")),
      headers: { "stripe-signature": "t=123,v1=invalid" }
    }) as typeof createMockReq extends (...args: never[]) => infer R ? R & { rawBody?: Buffer } : never;
    req.rawBody = rawBody;

    await assert.rejects(
      () => controller.webhook(req, createMockRes()),
      (error) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "STRIPE_SIGNATURE_INVALID");
        return true;
      }
    );
  });
});
