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

test("public analytics requires an explicit consent version", () => {
  const parsed = publicAnalyticsEventSchema.parse({
    eventType: "PAGE_VIEW",
    path: "/",
    consentVersion: "2026-06-19"
  });

  assert.equal(parsed.consentVersion, "2026-06-19");
  assert.throws(() => publicAnalyticsEventSchema.parse({ eventType: "PAGE_VIEW", path: "/" }));
});
