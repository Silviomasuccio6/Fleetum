import assert from "node:assert/strict";
import test from "node:test";
import { Resend } from "resend";
import { emailSender } from "../src/infrastructure/email/email-sender.js";

test("the provider SDK receives the stable invoice key as request options", async () => {
  const original = Resend.prototype.post;
  const requests: any[] = [];
  Resend.prototype.post = (async (...args: any[]) => {
    requests.push(args);
    return { data: { id: "synthetic-provider-receipt" }, error: null };
  }) as typeof original;
  try {
    const result = await emailSender.send({ to: "billing@example.test", subject: "Synthetic", text: "Synthetic", idempotencyKey: "fleetum-email-queue:synthetic-queue" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0][0], "/emails");
    assert.equal(requests[0][2].idempotencyKey, "fleetum-email-queue:synthetic-queue");
    assert.equal(requests[0][1].idempotencyKey, undefined);
    assert.equal(result.id, "synthetic-provider-receipt");
  } finally { Resend.prototype.post = original; }
});

test("ordinary tenant emails keep their previous provider request options", async () => {
  const original = Resend.prototype.post;
  const requests: any[] = [];
  Resend.prototype.post = (async (...args: any[]) => {
    requests.push(args);
    return { data: { id: "synthetic-tenant-receipt" }, error: null };
  }) as typeof original;
  try {
    await emailSender.send({ to: "reset@example.test", subject: "Synthetic", text: "Synthetic" });
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0][2], {});
  } finally { Resend.prototype.post = original; }
});
