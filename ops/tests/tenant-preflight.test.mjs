import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runTenantPreflight } from "../e2e/tenant-preflight.mjs";

const env = {
  E2E_BASE_URL: "https://staging.fleetum.it", E2E_API_URL: "https://api-staging.fleetum.it/api",
  E2E_TENANT_EMAIL: "a@example.invalid", E2E_TENANT_PASSWORD: "DO-NOT-LOG-PASSWORD-A",
  E2E_OTHER_TENANT_EMAIL: "b@example.invalid", E2E_OTHER_TENANT_PASSWORD: "DO-NOT-LOG-PASSWORD-B"
};
const response = (payload, status = 200) => ({ status: () => status, json: async () => payload });
const validLogin = (tenantId) => ({ csrfToken: "DO-NOT-LOG-CSRF", user: { tenantId } });
function transport({ login = [validLogin("tenant-a"), validLogin("tenant-b")], me = [{ tenantId: "tenant-a" }, { tenantId: "tenant-b" }], status = 200, meStatus = 200, failure } = {}) {
  const contexts = [], options = [], calls = [];
  return { contexts, options, calls, createContext: async (settings) => {
    const index = contexts.length;
    options.push(settings);
    const context = {
      disposed: false,
      async post(url, request) { calls.push({ index, method: "post", url, request }); if (failure) throw new Error(failure); return response(login[index], status); },
      async get(url, request) { calls.push({ index, method: "get", url, request }); return response(me[index], meStatus); },
      async dispose() { this.disposed = true; }
    };
    contexts.push(context);
    return context;
  } };
}

test("preflight proves distinct authenticated tenant IDs using isolated disposable cookie contexts", async () => {
  const fake = transport();
  const result = await runTenantPreflight({ env, createContext: fake.createContext });
  assert.deepEqual(result, { ok: true });
  assert.equal(fake.contexts.length, 2);
  assert.notEqual(fake.contexts[0], fake.contexts[1]);
  assert.ok(fake.contexts.every((context) => context.disposed));
  for (const options of fake.options) {
    assert.equal(options.baseURL, "https://api-staging.fleetum.it/api/");
    assert.equal(options.ignoreHTTPSErrors, false);
    assert.equal(options.maxRedirects, 0);
    assert.deepEqual(options.storageState, { cookies: [], origins: [] });
  }
  assert.notEqual(fake.options[0].storageState, fake.options[1].storageState);
  assert.deepEqual(fake.calls.map(({ index, method, url, request }) => ({ index, method, url, email: request.data.email, redirects: request.maxRedirects })), [
    { index: 0, method: "post", url: "auth/login", email: env.E2E_TENANT_EMAIL, redirects: 0 },
    { index: 1, method: "post", url: "auth/login", email: env.E2E_OTHER_TENANT_EMAIL, redirects: 0 }
  ]);
  assert.doesNotMatch(JSON.stringify(result), /tenant-a|tenant-b|DO-NOT-LOG/);
});

test("preflight uses authenticated me fallback with CSRF preserved and redirects disabled", async () => {
  const fake = transport({ login: [{ csrfToken: "DO-NOT-LOG-CSRF" }, { csrfToken: "DO-NOT-LOG-CSRF" }] });
  assert.equal((await runTenantPreflight({ env, createContext: fake.createContext })).ok, true);
  const reads = fake.calls.filter(({ method }) => method === "get");
  assert.equal(reads.length, 2);
  for (const { url, request } of reads) {
    assert.equal(url, "auth/me"); assert.equal(request.maxRedirects, 0);
    assert.equal(request.headers["X-CSRF-Token"], "DO-NOT-LOG-CSRF");
  }
});

test("preflight rejects same tenant IDs even when emails differ, absent IDs and absent CSRF", async () => {
  for (const input of [
    { login: [validLogin("same-tenant"), validLogin("same-tenant")] },
    { login: [{ csrfToken: "DO-NOT-LOG-CSRF" }, validLogin("tenant-b")], me: [{}, { tenantId: "tenant-b" }] },
    { login: [{ user: { tenantId: "tenant-a" } }, validLogin("tenant-b")] },
    { login: [validLogin("   "), validLogin("tenant-b")], me: [{ tenantId: " " }, { tenantId: "tenant-b" }] }
  ]) {
    const fake = transport(input);
    await assert.rejects(runTenantPreflight({ env, createContext: fake.createContext }), /tenant preflight failed/);
    assert.ok(fake.contexts.every((context) => context.disposed));
  }
});

test("preflight rejects redirects, failed auth and transports without revealing secrets", async () => {
  for (const input of [{ status: 302 }, { status: 401 }, { failure: "DO-NOT-LOG-PASSWORD-A DO-NOT-LOG-CSRF api-staging.fleetum.it" }]) {
    const fake = transport(input);
    await assert.rejects(runTenantPreflight({ env, createContext: fake.createContext }), (error) => {
      assert.doesNotMatch(error.message, /DO-NOT-LOG|api-staging\.fleetum\.it/);
      return /tenant preflight failed/.test(error.message);
    });
    assert.ok(fake.contexts.every((context) => context.disposed));
  }
});

test("preflight rejects profile redirects, failed me and duplicate fallback tenant identities", async () => {
  for (const input of [{ meStatus: 302 }, { meStatus: 401 }, { me: [{ tenantId: "same" }, { tenantId: "same" }] }]) {
    const fake = transport({ login: [{ csrfToken: "DO-NOT-LOG-CSRF" }, { csrfToken: "DO-NOT-LOG-CSRF" }], ...input });
    await assert.rejects(runTenantPreflight({ env, createContext: fake.createContext }), /tenant preflight failed/);
    assert.ok(fake.contexts.every((context) => context.disposed));
  }
});

test("preflight disposes an already-created context when the second factory call fails", async () => {
  const fake = transport();
  let creations = 0;
  await assert.rejects(runTenantPreflight({ env, createContext: async (settings) => {
    if (creations++ === 1) throw new Error("DO-NOT-LOG-FACTORY-SECRET");
    return fake.createContext(settings);
  } }), (error) => {
    assert.doesNotMatch(error.message, /DO-NOT-LOG/);
    return /tenant preflight failed/.test(error.message);
  });
  assert.equal(fake.contexts.length, 1);
  assert.equal(fake.contexts[0].disposed, true);
});

test("preflight cleanup failure is sanitized even when dispose throws synchronously", async () => {
  const fake = transport();
  await assert.rejects(runTenantPreflight({ env, createContext: async (settings) => {
    const context = await fake.createContext(settings);
    if (fake.contexts.length === 1) context.dispose = () => { throw new Error("DO-NOT-LOG-DISPOSE-SECRET"); };
    return context;
  } }), (error) => {
    assert.doesNotMatch(error.message, /DO-NOT-LOG/);
    return /tenant preflight failed/.test(error.message);
  });
  assert.equal(fake.contexts[1].disposed, true);
});

test("preflight validates targets before context creation and permits TLS relaxation only in local rehearsal", async () => {
  const fake = transport();
  await assert.rejects(runTenantPreflight({ env: { ...env, E2E_API_URL: "https://api.fleetum.it/api" }, createContext: fake.createContext }), /configuration/);
  assert.equal(fake.contexts.length, 0);
  const local = transport();
  assert.equal((await runTenantPreflight({ env: { ...env, E2E_TARGET_MODE: "local-rehearsal", NODE_ENV: "test", E2E_BASE_URL: "https://127.0.0.1:4443", E2E_API_URL: "https://127.0.0.1:4443/api" }, createContext: local.createContext })).ok, true);
  assert.ok(local.options.every((options) => options.ignoreHTTPSErrors === true));
});

test("preflight rejects reused cookie contexts and still disposes them", async () => {
  const reused = { async post() { return response(validLogin("tenant-a")); }, async dispose() { this.disposed = true; } };
  await assert.rejects(runTenantPreflight({ env, createContext: async () => reused }), /tenant preflight failed/);
  assert.equal(reused.disposed, true);
});

test("Playwright bootstrap wires the preflight for both nightly and local rehearsal", () => {
  const config = readFileSync("playwright.config.ts", "utf8");
  assert.match(config, /globalSetup:\s*["']\.\/tests\/e2e\/global-setup\.mts["']/);
  assert.match(config, /trace:\s*["']off["']/);
  assert.match(config, /video:\s*["']off["']/);
  const setup = readFileSync("tests/e2e/global-setup.mts", "utf8");
  assert.match(setup, /runTenantPreflight/);
  assert.match(setup, /request\.newContext/);
  assert.doesNotMatch(setup, /console\.|process\.env\s*=/);
  const rehearsal = readFileSync("ops/verify-local-rehearsal.mjs", "utf8");
  assert.match(rehearsal, /E2E_TARGET_MODE:\s*["']local-rehearsal["']/);
  assert.match(rehearsal, /NODE_ENV:\s*["']test["']/);
  const clean = spawnSync(process.execPath, ["ops/e2e/validate-config.mjs"], { encoding: "utf8", env: { PATH: process.env.PATH, DOTENV_CONFIG_PATH: "/dev/null", ...env, E2E_TARGET_MODE: "local-rehearsal", NODE_ENV: "test", GITHUB_ACTIONS: "true" } });
  assert.equal(clean.status, 1);
  assert.doesNotMatch(`${clean.stdout}${clean.stderr}`, /DO-NOT-LOG/);
});

test("local rehearsal runner rejects inherited CI/hosted context before allocating resources", () => {
  const rehearsal = readFileSync("ops/verify-local-rehearsal.mjs", "utf8");
  const guardPosition = rehearsal.indexOf("if (hasHostedOrCiContext())");
  assert.ok(guardPosition >= 0 && guardPosition < rehearsal.indexOf("const scratch = await mkdtemp"));
  const evidenceDirectory = `/private/tmp/fleetum-staging-isolation-e2e-hosted-guard-${process.pid}`;
  for (const flags of [{ CI: "true" }, { CI: "false", GITHUB_ACTIONS: "true" }, { CI: "false", GITHUB_RUN_ID: "12" }]) {
    const result = spawnSync(process.execPath, ["ops/verify-local-rehearsal.mjs", "--run", "--source-sha", "a".repeat(40), "--evidence-dir", evidenceDirectory], {
      encoding: "utf8", env: { PATH: process.env.PATH, DOTENV_CONFIG_PATH: "/dev/null", ...flags }
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot run inside CI or hosted GitHub Actions/);
    assert.equal(existsSync(evidenceDirectory), false);
  }
});


test("actual Playwright loader rejects production config before browser or authentication", () => {
  const marker = "SYNTHETIC-DO-NOT-PRINT-BOOTSTRAP";
  const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--project=chromium", "--reporter=line", "01-login.spec.ts"], {
    encoding: "utf8", timeout: 30_000,
    env: { PATH: process.env.PATH, NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null", E2E_BASE_URL: "https://fleetum.it", E2E_API_URL: "https://api.fleetum.it/api", E2E_TENANT_EMAIL: "a@example.test", E2E_TENANT_PASSWORD: marker, E2E_OTHER_TENANT_EMAIL: "b@example.test", E2E_OTHER_TENANT_PASSWORD: marker }
  });
  assert.equal(result.status, 1);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /E2E tenant preflight rejected configuration/);
  assert.doesNotMatch(output, /ReferenceError|SYNTHETIC-DO-NOT-PRINT-BOOTSTRAP/);
});
