import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { getLogContext, logger } from "../src/infrastructure/logging/logger.js";
import { sanitizeRequestUrl } from "../src/infrastructure/logging/sanitize-request-url.js";
import { errorHandler } from "../src/interfaces/http/middlewares/error-handler.js";
import { requestContext } from "../src/interfaces/http/middlewares/request-context.js";

const contractToken = "ZXlKMFpXNWhiblJKWkNJNkltUmxiVzhpZlE.signature987654321ABCDEFGHIJ";
const contractTokenFragments = [
  contractToken,
  encodeURIComponent(contractToken),
  ...contractToken.split(".").flatMap((part) =>
    Array.from({ length: Math.max(1, part.length - 11) }, (_unused, index) => part.slice(index, index + 12))
  )
];

const assertContractTokenAbsent = (value: string) => {
  for (const fragment of new Set(contractTokenFragments)) {
    assert.equal(value.includes(fragment), false, `Sensitive contract token fragment leaked: ${fragment}`);
  }
};

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

test("request logging masks the public contract token path segment", () => {
  const sanitized = sanitizeRequestUrl(`/api/contracts/public/${contractToken}?download=1`);

  assert.equal(sanitized, "/api/contracts/public/:token?download=1");
  assertContractTokenAbsent(sanitized);
});

test("request logging masks public contract tokens in absolute referrers and nested URLs", () => {
  const referrer = sanitizeRequestUrl(
    `https://api.fleetum.test/api/contracts/public/${contractToken}?source=whatsapp`
  );
  const nested = sanitizeRequestUrl(
    `/api/auth/continue?returnTo=${encodeURIComponent(`/api/contracts/public/${contractToken}`)}`
  );

  assert.equal(referrer, "/api/contracts/public/:token?source=whatsapp");
  assert.equal(new URL(nested, "http://localhost").searchParams.get("returnTo"), "***");
  assertContractTokenAbsent(referrer);
  assertContractTokenAbsent(nested);
});

test("request completion logging keeps route, status and request id without the contract token", () => {
  const captured: Array<{ payload: Record<string, unknown>; context: ReturnType<typeof getLogContext> }> = [];
  const mutableLogger = logger as unknown as {
    info: (payload: Record<string, unknown>, message: string) => void;
  };
  const originalInfo = mutableLogger.info;
  mutableLogger.info = (payload) => {
    captured.push({ payload, context: getLogContext() });
  };

  try {
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
      setHeader: (name: string, value: string) => void;
    };
    response.statusCode = 401;
    response.setHeader = () => undefined;
    const request = {
      headers: { "x-request-id": "request-sec08-1234" },
      method: "GET",
      originalUrl: `/api/contracts/public/${contractToken}`,
      ip: "127.0.0.1"
    } as unknown as Request;

    requestContext(
      request,
      response as unknown as Response,
      (() => response.emit("finish")) as NextFunction
    );
  } finally {
    mutableLogger.info = originalInfo;
  }

  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.payload.path, "/api/contracts/public/:token");
  assert.equal(captured[0]?.payload.statusCode, 401);
  assert.equal(captured[0]?.context?.requestId, "request-sec08-1234");
  assertContractTokenAbsent(JSON.stringify(captured));
});

test("error logging masks the public contract token and preserves request correlation", () => {
  const captured: Array<Record<string, unknown>> = [];
  const mutableLogger = logger as unknown as {
    error: (payload: Record<string, unknown>, message: string) => void;
  };
  const originalError = mutableLogger.error;
  mutableLogger.error = (payload) => {
    captured.push(payload);
  };

  let responseStatus = 0;
  try {
    const response = {
      status(code: number) {
        responseStatus = code;
        return this;
      },
      json() {
        return this;
      }
    } as unknown as Response;
    const request = {
      originalUrl: `/api/contracts/public/${contractToken}`,
      method: "GET",
      requestId: "request-sec08-error"
    } as Request;

    errorHandler(new Error("Synthetic failure"), request, response, (() => undefined) as NextFunction);
  } finally {
    mutableLogger.error = originalError;
  }

  assert.equal(responseStatus, 500);
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.path, "/api/contracts/public/:token");
  assert.equal(captured[0]?.requestId, "request-sec08-error");
  assertContractTokenAbsent(JSON.stringify(captured));
});
