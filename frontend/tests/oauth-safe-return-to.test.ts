import assert from "node:assert/strict";
import test from "node:test";
import { getSafeReturnTo } from "../src/presentation/routes/safe-return-to";

test("OAuth returnTo accepts only same-origin application paths", () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: new URL("https://fleetum.it/login") }
  });

  try {
    assert.equal(getSafeReturnTo("/onboarding/azienda?from=social"), "/onboarding/azienda?from=social");
    assert.equal(getSafeReturnTo("/activate?billing=required"), "/activate?billing=required");
    assert.equal(getSafeReturnTo("//evil.example/phish"), "/dashboard");
    assert.equal(getSafeReturnTo("https://evil.example/dashboard"), "/dashboard");
    assert.equal(getSafeReturnTo("/\\evil.example"), "/dashboard");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});
