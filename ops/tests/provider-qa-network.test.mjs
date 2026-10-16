import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import test from "node:test";
import { assertQaDestination, installQaNetworkPolicy } from "../provider-qa/network-policy.mjs";

test("QA destinations are explicit and selected providers do not unlock other services", () => {
  for (const mode of ["offline", "stripe", "google", "both"]) {
    assert.doesNotThrow(() => assertQaDestination("http://localhost:4200/api/ready", mode));
    for (const url of ["https://api.fleetum.it/", "https://api-staging.fleetum.it/", "http://57.131.47.124/",
      "http://localhost:4000/", "https://api.stripe.com.evil.invalid/v1/balance", "https://api.stripe.com:444/v1/balance",
      "http://api.stripe.com/v1/balance", "https://user:password@api.stripe.com/v1/balance", "https://api.resend.com/emails"])
      assert.throws(() => assertQaDestination(url, mode), /EGRESS_REFUSED/);
  }
  assert.doesNotThrow(() => assertQaDestination("https://api.stripe.com/v1/balance", "stripe"));
  assert.throws(() => assertQaDestination("https://api.stripe.com/v1/balance", "google"));
  assert.doesNotThrow(() => assertQaDestination("https://oauth2.googleapis.com/tokeninfo", "google"));
  assert.throws(() => assertQaDestination("https://oauth2.googleapis.com/tokeninfo", "stripe"));
  assert.throws(() => assertQaDestination("https://oauth2.googleapis.com/other", "google"));
});

test("installed offline guard rejects fetch, HTTP and overridden Node destinations before any connection", () => {
  const restore = installQaNetworkPolicy("offline");
  try {
    assert.throws(() => fetch("https://api.stripe.com/v1/account"), /EGRESS_REFUSED/);
    assert.throws(() => https.request("https://oauth2.googleapis.com/token"), /EGRESS_REFUSED/);
    assert.throws(() => http.get("http://localhost:4200", { hostname: "api.fleetum.it" }), /EGRESS_REFUSED/);
    assert.throws(() => http.request({ socketPath: "/var/run/docker.sock" }), /TRANSPORT_REFUSED/);
    assert.throws(() => https.request("https://api.stripe.com/v1/balance", { createConnection() {} }), /TRANSPORT_REFUSED/);
  } finally { restore(); }
});
