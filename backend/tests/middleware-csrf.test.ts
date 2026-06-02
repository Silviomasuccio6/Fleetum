import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMockNext, createMockReq, createMockRes } from "./helpers/mock-req-res.js";
import { requireCsrfProtection } from "../src/interfaces/http/middlewares/csrf-protection.js";
import { AppError } from "../src/shared/errors/app-error.js";

const assertCsrfInvalid = (error: unknown) => {
  assert.ok(error instanceof AppError);
  assert.equal(error.statusCode, 403);
  assert.equal(error.code, "CSRF_INVALID");
};

describe("requireCsrfProtection", () => {
  it("allows GET requests without CSRF checks", () => {
    const next = createMockNext();
    requireCsrfProtection(createMockReq({ method: "GET" }), createMockRes(), next);

    assert.equal(next.calls.length, 1);
    assert.equal(next.calls[0], undefined);
  });

  it("rejects POST requests without CSRF cookie", () => {
    const next = createMockNext();
    requireCsrfProtection(createMockReq({ method: "POST" }), createMockRes(), next);

    assert.equal(next.calls.length, 1);
    assertCsrfInvalid(next.lastError);
  });

  it("rejects POST requests with CSRF cookie but without matching header", () => {
    const next = createMockNext();
    const req = createMockReq({ method: "POST", headers: { cookie: "fermi_csrf=token-a" } });

    requireCsrfProtection(req, createMockRes(), next);

    assert.equal(next.calls.length, 1);
    assertCsrfInvalid(next.lastError);
  });

  it("rejects POST requests when CSRF cookie and header differ", () => {
    const next = createMockNext();
    const req = createMockReq({
      method: "POST",
      headers: { cookie: "fermi_csrf=token-a", "x-csrf-token": "token-b" }
    });

    requireCsrfProtection(req, createMockRes(), next);

    assert.equal(next.calls.length, 1);
    assertCsrfInvalid(next.lastError);
  });

  it("allows POST requests with matching CSRF cookie and header", () => {
    const next = createMockNext();
    const req = createMockReq({
      method: "POST",
      headers: { cookie: "fermi_csrf=token-a", "x-csrf-token": "token-a" }
    });

    requireCsrfProtection(req, createMockRes(), next);

    assert.equal(next.calls.length, 1);
    assert.equal(next.calls[0], undefined);
  });

  it("bypasses CSRF for API clients using Bearer tokens", () => {
    const next = createMockNext();
    const req = createMockReq({ method: "POST", headers: { authorization: "Bearer api-token" } });

    requireCsrfProtection(req, createMockRes(), next);

    assert.equal(next.calls.length, 1);
    assert.equal(next.calls[0], undefined);
  });
});
