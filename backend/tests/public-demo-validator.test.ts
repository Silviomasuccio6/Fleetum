import assert from "node:assert/strict";
import test from "node:test";
import { publicAnalyticsEventSchema, publicDemoRequestSchema } from "../src/interfaces/http/validators/public-validators.js";

test("public demo request accepts valid B2B lead", () => {
  const parsed = publicDemoRequestSchema.parse({
    companyName: "Autonoleggio Demo",
    fullName: "Mario Rossi",
    email: "MARIO.ROSSI@EXAMPLE.COM",
    phone: "+39 333 1234567",
    fleetSize: "11-30",
    message: "Vorrei vedere booking e contratti.",
    source: "fleetum.it/demo"
  });

  assert.equal(parsed.email, "mario.rossi@example.com");
  assert.equal(parsed.companyName, "Autonoleggio Demo");
  assert.equal(parsed.fleetSize, "11-30");
});

test("public demo request treats optional empty fields as missing", () => {
  const parsed = publicDemoRequestSchema.parse({
    companyName: "Autonoleggio Demo",
    fullName: "Mario Rossi",
    email: "mario.rossi@example.com",
    fleetSize: "",
    message: ""
  });

  assert.equal(parsed.fleetSize, undefined);
  assert.equal(parsed.message, undefined);
});

test("public demo request rejects invalid email and unsafe oversize payload", () => {
  assert.throws(() => {
    publicDemoRequestSchema.parse({
      companyName: "Azienda Demo",
      fullName: "Mario Rossi",
      email: "non-valida",
      message: "x".repeat(1300)
    });
  });
});

test("public analytics event accepts privacy-safe attribution fields", () => {
  const parsed = publicAnalyticsEventSchema.parse({
    eventType: "CTA_CLICK",
    path: "/prezzi",
    referrer: "https://google.com",
    visitorId: "visitor-12345678",
    sessionId: "session-12345678",
    consentAnalytics: true,
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "starter-autonoleggi",
    utmContent: "hero",
    utmTerm: "software autonoleggio",
    metadata: {
      ctaId: "pricing-start",
      label: "Inizia ora",
      order: 1,
      highlighted: true
    }
  });

  assert.equal(parsed.consentAnalytics, true);
  assert.equal(parsed.utmContent, "hero");
  assert.equal(parsed.visitorId, "visitor-12345678");
});

test("public analytics event defaults to no consent and rejects unsafe metadata", () => {
  const parsed = publicAnalyticsEventSchema.parse({
    eventType: "PAGE_VIEW",
    path: "/"
  });

  assert.equal(parsed.consentAnalytics, false);
  assert.throws(() => {
    publicAnalyticsEventSchema.parse({
      eventType: "PAGE_VIEW",
      path: "/",
      consentAnalytics: true,
      metadata: {
        payload: "x".repeat(2200)
      }
    });
  });
});
