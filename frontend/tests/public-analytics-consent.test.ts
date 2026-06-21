import assert from "node:assert/strict";
import test from "node:test";
import { COOKIE_CONSENT_EVENT, COOKIE_CONSENT_STORAGE_KEY } from "../src/infrastructure/privacy/cookie-consent";
import { trackPublicEvent } from "../src/application/usecases/public-analytics-usecases";

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  };
};

test("public analytics waits for explicit analytics consent before sending a queued page view", async () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const listeners = new Map<string, (event: Event) => void>();
  const requests: Array<{ url: string; payload: Record<string, unknown> }> = [];

  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: new URL("https://fleetum.it/software-autonoleggio?utm_source=google&utm_medium=organic"),
      localStorage,
      sessionStorage,
      addEventListener: (name: string, listener: (event: Event) => void) => listeners.set(name, listener)
    }
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { referrer: "https://www.google.com/search?q=fleetum" } });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string, init?: RequestInit) => {
      requests.push({ url, payload: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(null, { status: 202 });
    }
  });

  try {
    trackPublicEvent("PAGE_VIEW", { page: "software-autonoleggio" });
    assert.equal(requests.length, 0);

    localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      JSON.stringify({ necessary: true, analytics: true, marketing: false, version: "test", acceptedAt: "2026-06-21T00:00:00.000Z" })
    );
    listeners.get(COOKIE_CONSENT_EVENT)?.({ detail: { analytics: true } } as CustomEvent);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].payload.eventType, "PAGE_VIEW");
    assert.equal(requests[0].payload.referrer, "https://www.google.com");
    assert.equal(requests[0].payload.utmSource, "google");
    assert.equal(requests[0].payload.utmMedium, "organic");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
  }
});
