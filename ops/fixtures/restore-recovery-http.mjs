import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

// Imported before application modules, including provider SDK construction.
const realFetch = globalThis.fetch;
const loopback = (value) => {
  const url = new URL(value);
  assert.equal(url.protocol, "http:", "only local HTTP is permitted");
  assert.equal(url.hostname, "127.0.0.1", "external HTTP is disabled");
  return url;
};
globalThis.fetch = (input, options) => realFetch(loopback(typeof input === "string" || input instanceof URL ? input : input.url), { ...options, redirect: "error" });
for (const module of [http, https]) {
  module.request = module.get = () => { throw new Error("Provider HTTP is disabled during restore rehearsal"); };
}
syncBuiltinESMExports();

let server; let prisma; let stepLabel = "import-app"; let status;
const checks = [];
const reportFailure = (error) => {
  const safeNames = new Set(["Error", "AssertionError", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "TimeoutError", "AbortError", "PrismaClientInitializationError", "PrismaClientKnownRequestError", "PrismaClientValidationError"]);
  const diagnostic = { stepLabel, errorName: safeNames.has(error?.name) ? error.name : "Error" };
  for (const [key, value] of [["actual", error?.actual], ["expected", error?.expected], ["status", status]]) if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 2147483647) diagnostic[key] = value;
  console.log(`FLEETUM_RESTORE_HTTP_FAILURE ${JSON.stringify(diagnostic)}`);
  process.exitCode = 1;
};
try {
  let base;
  if (process.env.SYNTHETIC_HTTP_BASE !== undefined) {
    assert.equal(process.env.SYNTHETIC_APPLICATION_RECOVERY, "true");
    const external = loopback(process.env.SYNTHETIC_HTTP_BASE);
    assert(external.port && external.pathname === "/api" && !external.username && !external.password && !external.search && !external.hash);
    assert.equal(external.href, process.env.SYNTHETIC_HTTP_BASE);
    assert(!external.href.includes("?") && !external.href.includes("#"));
    base = external.href;
  } else {
    assert.notEqual(process.env.SYNTHETIC_APPLICATION_RECOVERY, "true");
    const { createApp } = await import("./backend/src/app.ts");
    stepLabel = "import-prisma";
    ({ prisma } = await import("./backend/src/infrastructure/database/prisma/client.ts"));
    stepLabel = "listen";
    server = createApp().listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    base = `http://127.0.0.1:${server.address().port}/api`;
  }
  const request = async (route, options) => {
    status = undefined;
    const response = await fetch(`${base}${route}`, { ...options, signal: AbortSignal.timeout(10000) });
    status = response.status; return response;
  };
  stepLabel = "ready";
  const ready = await request("/ready");
  assert.equal(ready.status, 200, "ready-status"); stepLabel = "ready-body";
  assert.equal((await ready.json()).db, "up", "ready-db-up"); checks.push("ready");
  const login = async (email, tenantLabel) => {
    stepLabel = `login-${tenantLabel}`;
    const response = await request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: process.env.DEMO_ADMIN_PASSWORD }) });
    assert.equal(response.status, 200, "login-status");
    const body = await response.json();
    stepLabel = `login-${tenantLabel}-cookies`;
    const cookie = response.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
    assert(cookie.includes("fermi_access="), "access-cookie-present");
    stepLabel = `login-${tenantLabel}-csrf`; assert.equal(typeof body.csrfToken, "string", "csrf-token-present");
    return { cookie, "x-csrf-token": body.csrfToken };
  };
  const a = await login("admin@demo.local", "a"); const b = await login("restore-b@example.invalid", "b"); checks.push("two-tenant-login");
  stepLabel = "read-a";
  const vehicles = await request("/master-data/vehicles?page=1&pageSize=20", { headers: a });
  assert.equal(vehicles.status, 200, "tenant-a-read-status"); stepLabel = "read-a-fixture";
  assert.match(JSON.stringify(await vehicles.json()), /COMPAT26/, "tenant-a-fixture-present"); checks.push("business-read");
  stepLabel = "read-b";
  const otherVehicles = await request("/master-data/vehicles?page=1&pageSize=20", { headers: b });
  assert.equal(otherVehicles.status, 200, "tenant-b-read-status"); stepLabel = "read-b-isolation";
  assert.doesNotMatch(JSON.stringify(await otherVehicles.json()), /COMPAT26/, "tenant-a-fixture-not-visible-to-b"); checks.push("tenant-read-isolation");
  // A harmless update to an existing synthetic site exercises cookie auth + CSRF.
  const note = process.env.SYNTHETIC_WRITE_NOTE ?? "Synthetic restore HTTP write";
  assert(note === "Synthetic restore HTTP write" || /^Synthetic recovery (before|after)-(startup-rejected|database-unready|pause-before-import|client-artifact-mismatch)$/.test(note));
  const body = JSON.stringify({ notes: note });
  stepLabel = "write-without-csrf";
  const denied = await request("/master-data/sites/compat_site", { method: "PATCH", headers: { cookie: a.cookie, "content-type": "application/json" }, body });
  assert.equal(denied.status, 403, "missing-csrf-status"); checks.push("csrf-missing-denied");
  stepLabel = "write-with-csrf";
  const written = await request("/master-data/sites/compat_site", { method: "PATCH", headers: { ...a, "content-type": "application/json" }, body });
  assert.equal(written.status, 200, "valid-csrf-write-status"); checks.push("csrf-safe-write");
  stepLabel = "download-owner";
  const download = await request("/uploads/vehicle-booklets/restore_booklet_a/file", { headers: a });
  assert.equal(download.status, 200, "owner-download-status"); stepLabel = "download-owner-bytes";
  const expected = await readFile(path.join(process.env.SYNTHETIC_UPLOAD_TREE, "uploads/demo_tenant/vehicle-booklets/restore-a.pdf"));
  assert.equal(createHash("sha256").update(Buffer.from(await download.arrayBuffer())).digest("hex"), createHash("sha256").update(expected).digest("hex")); checks.push("owner-file-download");
  stepLabel = "download-other-tenant";
  const crossTenant = await request("/uploads/vehicle-booklets/restore_booklet_a/file", { headers: b });
  assert.equal(crossTenant.status, 404, "other-tenant-download-status"); checks.push("other-tenant-file-denied");
  stepLabel = "download-anonymous";
  const anonymous = await request("/uploads/vehicle-booklets/restore_booklet_a/file");
  assert.equal(anonymous.status, 401, "anonymous-download-status"); checks.push("anonymous-file-denied");
  if (process.env.SYNTHETIC_INCLUDE_MODERN_FILES === "true") {
    const route = "/uploads/vehicle-booklets/restore_booklet_a_modern/file";
    stepLabel = "download-modern-owner";
    const modern = await request(route, { headers: a }); assert.equal(modern.status, 200);
    stepLabel = "download-modern-owner-bytes";
    const expectedModern = await readFile(path.join(process.env.SYNTHETIC_UPLOAD_TREE, "tenants/demo_tenant/vehicle-booklets/restore-a-modern.pdf"));
    assert.equal(createHash("sha256").update(Buffer.from(await modern.arrayBuffer())).digest("hex"), createHash("sha256").update(expectedModern).digest("hex")); checks.push("modern-owner-file-download");
    stepLabel = "download-modern-other-tenant";
    assert.equal((await request(route, { headers: b })).status, 404); checks.push("modern-other-tenant-file-denied");
    stepLabel = "download-modern-anonymous";
    assert.equal((await request(route)).status, 401); checks.push("modern-anonymous-file-denied");
  }
  console.log(`FLEETUM_RESTORE_HTTP_RESULT ${JSON.stringify({ checks, providerCalls: 0, workersStarted: false })}`);
} catch (error) { reportFailure(error); }
finally {
  try {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    if (prisma) await prisma.$disconnect();
  } catch (error) { stepLabel = "cleanup"; status = undefined; reportFailure(error); }
}
