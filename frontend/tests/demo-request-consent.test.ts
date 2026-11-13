import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";

const sourceModule = (path: URL, imports: Record<string, unknown>, globals: Record<string, unknown> = {}) => {
  const module = { exports: {} as Record<string, any> };
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  runInNewContext(output, {
    module, exports: module.exports,
    require: (name: string) => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
      return imports[name];
    },
    URL, URLSearchParams, ...globals
  });
  return module.exports;
};

const storage = (values: Record<string, string> = {}) => {
  const entries = new Map(Object.entries(values));
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value)
  };
};

const schema = sourceModule(new URL("../../backend/src/interfaces/http/validators/public-validators.ts", import.meta.url), { zod: { z } }).publicDemoRequestSchema;
const buildEvent = sourceModule(new URL("../../backend/src/application/services/public-demo-analytics-service.ts", import.meta.url), {
  "../../shared/utils/privacy-hash.js": { privacyHash: (value: unknown) => value ? `synthetic-hash:${value}` : undefined }
}).buildConsentedDemoAnalyticsEvent;

// Execute the actual form handler and consent helper against the actual API
// schema/event builder. Browser, transport and hashing are synthetic; no DB or
// real email is involved, and this does not claim mounted-browser coverage.
const submitDemo = async (analytics: boolean | undefined, doNotTrack = "0") => {
  const consent = analytics === undefined ? {} : {
    fleetum_cookie_consent_v1: JSON.stringify({ necessary: true, analytics, marketing: false })
  };
  const browser = {
    location: new URL("https://fleetum.example.test/demo?utm_source=synthetic-campaign"),
    localStorage: storage(consent), sessionStorage: storage()
  };
  const globals = {
    window: browser, document: { referrer: "https://synthetic-referrer.example.test/demo" },
    navigator: { doNotTrack }, crypto: { randomUUID: () => "synthetic-request-uuid" }
  };
  const consentModule = sourceModule(new URL("../src/infrastructure/privacy/cookie-consent.ts", import.meta.url), {}, globals);
  const analyticsModule = sourceModule(new URL("../src/application/usecases/public-analytics-usecases.ts", import.meta.url), {
    "../../infrastructure/api/api-base-url": { getApiBaseUrl: () => "/api" },
    "../../infrastructure/privacy/cookie-consent": consentModule
  }, globals);

  const pagePath = new URL("../src/presentation/pages/legal/legal-pages.tsx", import.meta.url);
  const page = ts.createSourceFile(pagePath.pathname, readFileSync(pagePath, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let handler: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(page) === "submit") handler = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(page);
  assert.ok(handler, "The actual demo submit handler must exist");
  const output = ts.transpileModule(`const run = ${handler.getText(page)}; run`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  let request: { body: Record<string, unknown>; headers: Record<string, string> } | undefined;
  const statuses: string[] = [];
  const errors: string[] = [];
  const fields = { companyName: "Synthetic Rental", fullName: "Synthetic Operator", email: "operator@example.test", source: "fleetum.it/demo", fleetSize: "1-10" };
  const form = { entries: Object.entries(fields), reset() {} };
  class SyntheticFormData {
    constructor(private value: { entries: Array<[string, string]> }) {}
    get(key: string) { return this.value.entries.find(([name]) => name === key)?.[1] ?? null; }
    entries() { return this.value.entries.values(); }
  }
  const submit = runInNewContext(output, {
    ...globals, FormData: SyntheticFormData, requestRef: { current: null }, apiBaseUrl: "/api",
    getConsentedPublicAnalyticsContext: analyticsModule.getConsentedPublicAnalyticsContext,
    setStatus: (status: string) => statuses.push(status), setError: (error: string) => errors.push(error),
    trackPublicEvent() {},
    fetch: async (_url: string, init: { body: string; headers: Record<string, string> }) => {
      request = { body: JSON.parse(init.body), headers: init.headers };
      return { ok: true };
    }
  }) as (event: unknown) => Promise<void>;
  await submit({ preventDefault() {}, currentTarget: form });
  assert.ok(request);
  assert.deepEqual(statuses, ["loading", "success"]);
  assert.deepEqual(errors, [""]);
  assert.equal(request.headers["X-Idempotency-Key"], "synthetic-request-uuid");
  return request.body;
};

test("the React demo form explicitly preserves consented, lead-associated analytics through the API contract", async () => {
  const body = await submitDemo(true);
  const input = schema.parse(body);
  assert.equal(input.consentAnalytics, true);
  assert.ok(input.visitorId);
  assert.ok(input.sessionId);
  const event = buildEvent({ input, leadId: "synthetic-lead" });
  assert.equal(event?.eventType, "DEMO_FORM_SUBMIT");
  assert.equal(event?.metadata.leadId, "synthetic-lead");
  assert.equal(event?.utmSource, "synthetic-campaign");
});

for (const { label, consent, dnt } of [
  { label: "rejected", consent: false, dnt: "0" },
  { label: "missing", consent: undefined, dnt: "0" },
  { label: "Do Not Track", consent: true, dnt: "1" }
]) {
  test(`the React demo form creates no analytics context or event with ${label} consent`, async () => {
    const body = await submitDemo(consent, dnt);
    const input = schema.parse(body);
    assert.equal(input.consentAnalytics, false);
    assert.equal(input.visitorId, undefined);
    assert.equal(input.sessionId, undefined);
    assert.equal(input.utmSource, undefined);
    assert.equal(buildEvent({ input, leadId: "synthetic-lead" }), null);
  });
}
