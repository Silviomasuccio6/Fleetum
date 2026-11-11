import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Exercise the real HTTP adapter with an Axios transport double. No network or credentials.
function adapter(status: number, data: unknown) {
  let defaults: any;
  let request: any;
  const api = {
    interceptors: { request: { use() {} }, response: { use() {} } },
    async get(url: string, config: any) {
      request = { url, config };
      if (!config.validateStatus(status)) throw Object.assign(new Error("Rejected HTTP status"), { status });
      return { status, data };
    }
  };
  const exports: any = {};
  const source = readFileSync(new URL("../src/infrastructure/api/http-client.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, { exports, require(id: string) {
    if (id === "axios") return { default: { create(config: any) { defaults = config; return api; } } };
    if (id.endsWith("api-base-url")) return { getApiBaseUrl: () => "/api" };
    return {};
  } });
  return { read: exports.getOptionalResource as <T>(url: string) => Promise<T | null>, defaults, request: () => request };
}

test("a missing optional booking contract returns null instead of its 404 error body", async () => {
  const client = adapter(404, { error: "NOT_FOUND", message: "Contratto non trovato" });
  assert.equal(await client.read("/rental-bookings/synthetic-booking/contract"), null);
  assert.equal(client.request().url, "/rental-bookings/synthetic-booking/contract");
  assert.equal(client.defaults.withCredentials, true);
  assert.equal(client.defaults.baseURL, "/api");
});

test("an existing optional contract is returned without changing its data", async () => {
  const contract = { id: "synthetic-contract", bookingId: "synthetic-booking", status: "DRAFT" };
  const client = adapter(200, contract);
  assert.equal(await client.read("/rental-bookings/synthetic-booking/contract"), contract);
});

test("optional absence does not accept auth, license, rate-limit or server errors", async () => {
  for (const status of [401, 402, 403, 409, 429, 500, 503]) {
    const client = adapter(status, { error: "EXPECTED_FAILURE" });
    await assert.rejects(() => client.read("/rental-bookings/synthetic-booking/contract"), { status });
  }
});
