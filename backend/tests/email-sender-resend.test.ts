import assert from "node:assert/strict";
import test from "node:test";

test("email sender delivers through the Resend SDK without Nodemailer", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: "resend_email_123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const { emailSender } = await import("../src/infrastructure/email/email-sender.js");
    const sent = await emailSender.send({
      to: "customer@example.test",
      subject: "Fleetum test",
      text: "Email test",
      fromName: "Fleetum Test",
      attachments: [{ filename: "contract.pdf", content: Buffer.from("pdf"), contentType: "application/pdf" }]
    });

    assert.deepEqual(sent, { provider: "resend", id: "resend_email_123" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.resend.com/emails");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
