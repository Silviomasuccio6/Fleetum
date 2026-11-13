import assert from "node:assert/strict";
import test from "node:test";
import {
  getLoginRedirectPath,
  getPostLoginReturnTo,
  getSafeReturnTo
} from "../src/presentation/routes/safe-return-to";

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

test("expired sessions preserve pathname, query and hash in a same-origin login redirect", () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: new URL("https://fleetum.it/login") }
  });

  try {
    assert.equal(
      getLoginRedirectPath({
        pathname: "/rental-bookings/booking-42",
        search: "?tab=contratto",
        hash: "#firma"
      }),
      "/login?next=%2Frental-bookings%2Fbooking-42%3Ftab%3Dcontratto%23firma"
    );
    assert.equal(
      getLoginRedirectPath({ pathname: "//evil.example/phish", search: "", hash: "" }),
      "/login?next=%2Fdashboard"
    );
    assert.equal(getLoginRedirectPath({ pathname: "/login", search: "?next=%2Fdashboard", hash: "" }), "/login");
    assert.equal(
      getLoginRedirectPath({
        pathname: "/auth/social-callback",
        search: "?intent=login",
        hash: "#user=eyJlbWFpbCI6InNlbnNpdGl2ZUBleGFtcGxlLnRlc3QifQ"
      }),
      "/login"
    );
    assert.equal(
      getLoginRedirectPath({ pathname: "/auth/social-callback/", search: "", hash: "#user=sensitive" }),
      "/login"
    );
    assert.equal(getLoginRedirectPath({ pathname: "/LOGIN", search: "", hash: "" }), "/login");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("credential login consumes the safe deep route and rejects unsafe or recursive destinations", () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: new URL("https://fleetum.it/login") }
  });

  try {
    assert.equal(
      getPostLoginReturnTo("?next=%2Frental-bookings%2Fbooking-42%3Ftab%3Dcontratto%23firma"),
      "/rental-bookings/booking-42?tab=contratto#firma"
    );
    assert.equal(getPostLoginReturnTo("?next=https%3A%2F%2Fevil.example%2Fphish"), "/dashboard");
    assert.equal(getPostLoginReturnTo("?next=%2Flogin%3Fnext%3D%252Fdashboard"), "/dashboard");
    assert.equal(getPostLoginReturnTo("?next=%2Flogin%23retry"), "/dashboard");
    assert.equal(getPostLoginReturnTo("?next=%2Flogin%2F"), "/dashboard");
    assert.equal(getPostLoginReturnTo("?next=%2FLOGIN"), "/dashboard");
    assert.equal(getPostLoginReturnTo(""), "/dashboard");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});
