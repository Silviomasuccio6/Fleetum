import assert from "node:assert/strict";
import test from "node:test";
import {
  COOKIE_CONSENT_VERSION,
  parseCookieConsent
} from "../src/shared/privacy/cookie-consent";
import { trackPublicEvent } from "../src/application/usecases/public-analytics-usecases";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  has(key: string) {
    return this.values.has(key);
  }
}

const withBrowser = async (input: {
  localStorage?: MemoryStorage;
  sessionStorage?: MemoryStorage;
  run: (requests: Array<{ url: string; body: Record<string, unknown> }>, sessionStorage: MemoryStorage) => void;
}) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const localStorage = input.localStorage ?? new MemoryStorage();
  const sessionStorage = input.sessionStorage ?? new MemoryStorage();
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: new URL("https://fleetum.it/"),
      localStorage,
      sessionStorage
    }
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { referrer: "" }
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (url: string, init: { body?: string }) => {
      requests.push({ url, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
      return Promise.resolve(new Response(null, { status: 202 }));
    }
  });

  try {
    input.run(requests, sessionStorage);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete (globalThis as { window?: unknown }).window;
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete (globalThis as { document?: unknown }).document;
    if (previousFetch) Object.defineProperty(globalThis, "fetch", previousFetch);
    else delete (globalThis as { fetch?: unknown }).fetch;
  }
};

test("analytics consent is accepted only for the current explicit version", () => {
  const consent = parseCookieConsent(JSON.stringify({
    necessary: true,
    analytics: true,
    marketing: false,
    version: COOKIE_CONSENT_VERSION,
    acceptedAt: "2026-06-19T00:00:00.000Z"
  }));

  assert.equal(consent?.analytics, true);
});

test("stale or malformed consent never enables analytics", () => {
  assert.equal(parseCookieConsent(null), null);
  assert.equal(parseCookieConsent("not-json"), null);
  assert.equal(parseCookieConsent(JSON.stringify({
    necessary: true,
    analytics: true,
    marketing: false,
    version: "2026-05-17",
    acceptedAt: "2026-05-17T00:00:00.000Z"
  })), null);
});

test("public analytics does not create a session or send data before opt-in", async () => {
  await withBrowser({
    run: (requests, sessionStorage) => {
      trackPublicEvent("PAGE_VIEW");
      assert.equal(requests.length, 0);
      assert.equal(sessionStorage.has("fleetum_public_session"), false);
    }
  });
});

test("public analytics sends an event only after valid analytics consent", async () => {
  const localStorage = new MemoryStorage();
  localStorage.setItem("fleetum_cookie_consent_v1", JSON.stringify({
    necessary: true,
    analytics: true,
    marketing: false,
    version: COOKIE_CONSENT_VERSION,
    acceptedAt: "2026-06-19T00:00:00.000Z"
  }));

  await withBrowser({
    localStorage,
    run: (requests, sessionStorage) => {
      trackPublicEvent("PAGE_VIEW");
      assert.equal(requests.length, 1);
      assert.equal(sessionStorage.has("fleetum_public_session"), true);
      assert.equal(requests[0]?.body.consentVersion, COOKIE_CONSENT_VERSION);
    }
  });
});
