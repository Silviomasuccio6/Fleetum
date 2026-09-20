import assert from "node:assert/strict";
import test from "node:test";
import { buildConsentedDemoAnalyticsEvent } from "../src/application/services/public-demo-analytics-service.js";
import { publicDemoRequestSchema } from "../src/interfaces/http/validators/public-validators.js";

const baseRequest = {
  companyName: "Autonoleggio Demo",
  fullName: "Mario Rossi",
  email: "mario.rossi@example.com",
  source: "fleetum.it",
  referrer: "https://example.test",
  visitorId: "visitor-12345678",
  sessionId: "session-12345678"
};

test("demo remains operational without creating an analytics event when consent is absent", () => {
  const input = publicDemoRequestSchema.parse(baseRequest);
  const event = buildConsentedDemoAnalyticsEvent({
    input,
    leadId: "lead_1",
    ip: "203.0.113.9",
    userAgent: "Synthetic Browser"
  });

  assert.equal(input.consentAnalytics, false);
  assert.equal(event, null);
});

test("demo analytics event is built only from explicit consent and carries its policy version", () => {
  const input = publicDemoRequestSchema.parse({ ...baseRequest, consentAnalytics: true });
  const event = buildConsentedDemoAnalyticsEvent({
    input,
    leadId: "lead_1",
    ip: "203.0.113.9",
    userAgent: "Synthetic Browser"
  });

  assert.ok(event);
  assert.equal(event.consentAnalytics, true);
  assert.equal(event.eventType, "DEMO_FORM_SUBMIT");
  assert.equal((event.metadata as Record<string, unknown>).leadId, "lead_1");
  assert.equal((event.metadata as Record<string, unknown>).consentVersion, "cookie-preferences-v1");
  assert.notEqual(event.ipHash, "203.0.113.9");
  assert.notEqual(event.userAgentHash, "Synthetic Browser");
});
