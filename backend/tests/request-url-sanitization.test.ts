import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeRequestUrl } from "../src/infrastructure/logging/sanitize-request-url.js";

test("request logging masks OAuth authorization artifacts", () => {
  const sanitized = sanitizeRequestUrl(
    "/api/auth/google/callback?code=provider-code&state=oauth-state&nonce=oidc-nonce&returnTo=%2Fdashboard"
  );
  const parsed = new URL(sanitized, "http://localhost");

  assert.equal(parsed.searchParams.get("code"), "***");
  assert.equal(parsed.searchParams.get("state"), "***");
  assert.equal(parsed.searchParams.get("nonce"), "***");
  assert.equal(parsed.searchParams.get("returnTo"), "/dashboard");
  assert.equal(sanitized.includes("provider-code"), false);
  assert.equal(sanitized.includes("oauth-state"), false);
});

test("request logging masks credentials nested inside a return path", () => {
  const sanitized = sanitizeRequestUrl(
    "/api/auth/google?returnTo=%2Freset-password%3Ftoken%3Dreset-secret&next=%2Fcallback%3Fstate%3Dnested-state"
  );
  const parsed = new URL(sanitized, "http://localhost");

  assert.equal(parsed.searchParams.get("returnTo"), "***");
  assert.equal(parsed.searchParams.get("next"), "***");
  assert.equal(sanitized.includes("reset-secret"), false);
  assert.equal(sanitized.includes("nested-state"), false);
});
