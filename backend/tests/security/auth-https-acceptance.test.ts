import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import https from "node:https";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// Fail before importing application configuration or Prisma. These acceptance
// tests belong only to the existing temporary PostgreSQL verification runner.
assert.equal(process.env.NODE_ENV, "test");
assert.equal(process.env.RUN_TENANT_ISOLATION_TESTS, "1");
assert.equal(process.env.DOTENV_CONFIG_PATH, "/dev/null");
const database = new URL(process.env.DATABASE_URL ?? "");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, "/fleetum_ci");
assert.ok(Number(database.port) > 0);

type Account = { id: string; tenantId: string; email: string; password: string };
let prisma: PrismaClient;
let server: https.Server;
let ca: Buffer;
let baseUrl = "";
let certificateRoot = "";
let admin: Account;
let target: Account;
let other: Account;
let tenantIds: string[] = [];
const runId = randomUUID();
const resetHash = (value: string) => createHash("sha256").update(value).digest("hex");
const newPassword = () => `Synthetic!${randomBytes(16).toString("hex")}9Aa`;

class BrowserSession {
  cookies = new Map<string, string>();
  csrf = "";
  clone() {
    const copy = new BrowserSession();
    copy.cookies = new Map(this.cookies);
    copy.csrf = this.csrf;
    return copy;
  }
  async request(route: string, method = "GET", body?: unknown, withCsrf = true) {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string | number> = { accept: "application/json", origin: baseUrl,
      "user-agent": "Fleetum synthetic HTTPS acceptance" };
    if (data !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(data);
    }
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (withCsrf && this.csrf) headers["x-csrf-token"] = this.csrf;
    const result = await new Promise<{ status: number; body: any; setCookie: string[] }>((resolve, reject) => {
      const req = https.request(`${baseUrl}/api${route}`, { method, headers, ca, rejectUnauthorized: true }, res => {
        const chunks: Buffer[] = [];
        res.on("data", chunk => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          try {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null,
              setCookie: res.headers["set-cookie"] ?? [] });
          } catch { reject(new Error("HTTPS acceptance response was not JSON")); }
        });
      });
      req.on("error", reject);
      req.setTimeout(10_000, () => req.destroy(new Error("HTTPS acceptance request timed out")));
      req.end(data);
    });
    for (const cookie of result.setCookie) {
      const [entry] = cookie.split(";");
      const separator = entry.indexOf("=");
      const name = entry.slice(0, separator);
      const value = entry.slice(separator + 1);
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    if (result.body?.csrfToken) this.csrf = result.body.csrfToken;
    return result;
  }
}

async function login(account: Account, password = account.password) {
  const browser = new BrowserSession();
  const response = await browser.request("/auth/login", "POST", { email: account.email, password });
  assert.equal(response.status, 200, "synthetic login must succeed");
  assert.equal(response.body.user.id, account.id);
  assert.equal(response.body.user.tenantId, account.tenantId);
  assert.ok(browser.csrf, "login issues a CSRF token");
  return { browser, response };
}

async function seedReset(account: Account) {
  const token = randomBytes(32).toString("hex");
  const row = await prisma.passwordResetToken.create({ data: { userId: account.id, tokenHash: resetHash(token),
    expiresAt: new Date(Date.now() + 300_000) } });
  return { token, id: row.id };
}

async function createAccount(tenantId: string, roleId: string, suffix: string): Promise<Account> {
  const password = newPassword();
  const user = await prisma.user.create({ data: { tenantId, email: `${suffix}-${randomUUID()}@example.invalid`,
    firstName: "Synthetic", lastName: "HTTPS acceptance", status: "ACTIVE", isEmailVerified: true,
    passwordHash: await bcrypt.hash(password, 12), roles: { create: { roleId } } } });
  return { id: user.id, tenantId, email: user.email, password };
}

async function cleanupFixtures() {
  if (!prisma || !tenantIds.length) return;
  const users = { tenantId: { in: tenantIds } };
  await prisma.emailQueue.deleteMany({ where: users });
  await prisma.auditLog.deleteMany({ where: users });
  await prisma.privacyAcceptance.deleteMany({ where: users });
  await prisma.passwordResetToken.deleteMany({ where: { user: users } });
  await prisma.invitationToken.deleteMany({ where: { user: users } });
  await prisma.refreshSession.deleteMany({ where: users });
  await prisma.userRole.deleteMany({ where: { user: users } });
  await prisma.user.deleteMany({ where: users });
  await prisma.tenantSubscription.deleteMany({ where: users });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  tenantIds = [];
}

describe("account boundaries through real HTTPS and temporary PostgreSQL", () => {
  before(async () => {
    certificateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-auth-https-"));
    await fs.chmod(certificateRoot, 0o700);
    const key = path.join(certificateRoot, "key.pem");
    const cert = path.join(certificateRoot, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=Fleetum synthetic HTTPS", "-addext", "subjectAltName=IP:127.0.0.1",
      "-keyout", key, "-out", cert], { stdio: "ignore" });
    await fs.chmod(key, 0o600);
    ca = await fs.readFile(cert);
    server = https.createServer({ key: await fs.readFile(key), cert: ca });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.APP_URL = baseUrl;
    process.env.BACKEND_PUBLIC_URL = baseUrl;
    process.env.CORS_ORIGIN = baseUrl;
    // The development/test profile permits its synthetic Resend placeholder;
    // disabled is reserved for the strict staging profile. No transport runs.
    process.env.EMAIL_PROVIDER = "resend";
    process.env.PRIVACY_RETENTION_CRON_ENABLED = "false";
    process.env.PRIVACY_RETENTION_GLOBAL_ENABLED = "false";
    process.env.BILLING_DUNNING_CRON_ENABLED = "false";
    const localOnly = (input: any) => {
      const host = typeof input === "string" || input instanceof URL ? new URL(input).hostname
        : input?.hostname ?? input?.host ?? "localhost";
      assert.ok(["127.0.0.1", "localhost", "::1", "[::1]"].includes(String(host)), "external provider HTTP is blocked");
    };
    for (const transport of [http, https]) {
      const original = transport.request;
      transport.request = ((...args: any[]) => {
        localOnly(args[0]);
        if (args[1] && typeof args[1] === "object") localOnly(args[1]);
        return Reflect.apply(original, transport, args);
      }) as typeof transport.request;
      // Node's get implementation can call its internal request function
      // directly. Guard both exports rather than assuming it uses the wrapper.
      const originalGet = transport.get;
      transport.get = ((...args: any[]) => {
        localOnly(args[0]);
        if (args[1] && typeof args[1] === "object") localOnly(args[1]);
        return Reflect.apply(originalGet, transport, args);
      }) as typeof transport.get;
    }
    syncBuiltinESMExports();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      localOnly(input instanceof Request ? input.url : input);
      return originalFetch(input, { ...init, redirect: "error" });
    };
    const { emailSender } = await import("../../src/infrastructure/email/email-sender.js");
    emailSender.send = async () => ({ provider: "resend", id: `synthetic-${randomUUID()}` });
    const app = await import("../../src/app.js");
    prisma = (await import("../../src/infrastructure/database/prisma/client.js")).prisma;
    await prisma.$connect();
    server.on("request", app.createApp());
  });

  beforeEach(async () => {
    const role = await prisma.role.upsert({ where: { key: "ADMIN" }, update: {}, create: { key: "ADMIN", name: "ADMIN" } });
    await prisma.role.upsert({ where: { key: "VIEWER" }, update: {}, create: { key: "VIEWER", name: "VIEWER" } });
    const tenants = await Promise.all(["A", "B"].map(label => prisma.tenant.create({ data: { name: `HTTPS ${runId} ${label}` } })));
    tenantIds = tenants.map(t => t.id);
    for (const tenantId of tenantIds) await prisma.tenantSubscription.create({ data: {
      tenantId, provider: "test", plan: "ENTERPRISE", status: "ACTIVE", seats: 10, billingCycle: "monthly" } });
    admin = await createAccount(tenantIds[0], role.id, "owner");
    target = await createAccount(tenantIds[0], role.id, "target");
    other = await createAccount(tenantIds[1], role.id, "other-tenant");
  });

  afterEach(cleanupFixtures);
  after(async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    }
    await cleanupFixtures();
    if (prisma) await prisma.$disconnect();
    if (certificateRoot) await fs.rm(certificateRoot, { recursive: true, force: true });
  });

  it("issues HttpOnly access/refresh and readable CSRF cookies and denies cookie writes without CSRF", async () => {
    const { browser, response } = await login(target);
    for (const name of ["fermi_access", "fermi_refresh", "fermi_csrf"]) {
      const cookie = response.setCookie.find(value => value.startsWith(`${name}=`));
      assert.ok(Boolean(cookie), `cookie ${name} present`);
      assert.equal(/; HttpOnly(?:;|$)/i.test(cookie!), name !== "fermi_csrf");
      assert.equal(/; SameSite=Lax(?:;|$)/i.test(cookie!), true);
      assert.equal(/; Path=\/(?:;|$)/i.test(cookie!), true);
    }
    // NODE_ENV=test deliberately omits Secure. Production metadata is checked
    // by the critical E2E against the actual production-mode staging image.
    const before = await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { firstName: true } });
    const denied = await browser.request("/auth/profile", "PATCH", { firstName: "Changed", lastName: "Fixture" }, false);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, "CSRF_INVALID");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).firstName, before.firstName);
    assert.equal((await browser.request("/auth/profile", "PATCH", { firstName: "Changed", lastName: "Fixture" })).status, 200);
  });

  it("a reset issued before suspension cannot change credentials, consume the token or reactivate the user", async () => {
    const reset = await seedReset(target);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { passwordHash: true } });
    const owner = (await login(admin)).browser;
    assert.equal((await owner.request(`/users/${target.id}`, "PATCH", { status: "SUSPENDED" })).status, 200);
    const denied = await new BrowserSession().request("/auth/reset-password", "POST", { token: reset.token, newPassword: newPassword() });
    assert.ok([400, 403].includes(denied.status));
    const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(after.status, "SUSPENDED");
    assert.equal(after.passwordHash === before.passwordHash, true, "password unchanged");
    assert.equal((await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: reset.id } })).usedAt, null);
  });

  it("legitimate reset consumes sibling resets and denies both old access and old refresh on their next requests", async () => {
    const previous = (await login(target)).browser;
    const independent = (await login(other)).browser;
    const reset = await seedReset(target);
    const sibling = await seedReset(target);
    const password = newPassword();
    const result = await new BrowserSession().request("/auth/reset-password", "POST", { token: reset.token, newPassword: password });
    assert.equal(result.status, 200);
    assert.equal((await previous.clone().request("/auth/me")).status, 401);
    assert.equal((await previous.clone().request("/auth/refresh", "POST", {})).status, 401);
    for (const id of [reset.id, sibling.id]) {
      assert.ok(Boolean((await prisma.passwordResetToken.findUniqueOrThrow({ where: { id } })).usedAt));
    }
    assert.equal(await prisma.refreshSession.count({ where: { userId: target.id, revokedAt: null } }), 0);
    assert.equal((await independent.request("/auth/me")).status, 200);
    assert.equal((await login(target, password)).response.status, 200);
    assert.equal((await new BrowserSession().request("/auth/login", "POST", { email: target.email, password: target.password })).status, 401);
  });

  it("two concurrent refresh requests create one successor and a legitimate retry does not log out the winner", async () => {
    const original = (await login(target)).browser;
    const requests = [original.clone(), original.clone()];
    const responses = await Promise.all(requests.map(browser => browser.request("/auth/refresh", "POST", {})));
    assert.equal(responses.filter(response => response.status === 200).length, 1);
    assert.equal(await prisma.refreshSession.count({ where: { userId: target.id, revokedAt: null, expiresAt: { gt: new Date() } } }), 1);
    const winner = requests[responses.findIndex(response => response.status === 200)];
    assert.equal((await winner.request("/auth/me")).status, 200);
    const retry = await original.clone().request("/auth/refresh", "POST", {});
    assert.notEqual(retry.status, 200);
    assert.equal((await winner.request("/auth/me")).status, 200);
  });

  it("logout denies the captured access and refresh cookies immediately while preserving another tenant", async () => {
    const current = (await login(target)).browser;
    const captured = current.clone();
    const independent = (await login(other)).browser;
    assert.equal((await current.request("/auth/logout", "POST", {})).status, 200);
    assert.equal((await captured.clone().request("/auth/me")).status, 401);
    assert.equal((await captured.clone().request("/auth/refresh", "POST", {})).status, 401);
    assert.equal((await independent.request("/auth/me")).status, 200);
  });

  it("suspension invalidates an already issued access cookie on the next protected request", async () => {
    const current = (await login(target)).browser;
    const owner = (await login(admin)).browser;
    const independent = (await login(other)).browser;
    assert.equal((await owner.request(`/users/${target.id}`, "PATCH", { status: "SUSPENDED" })).status, 200);
    assert.ok([401, 403].includes((await current.request("/auth/me")).status));
    assert.equal((await independent.request("/auth/me")).status, 200);
  });

  it("role changes update authorization on the next request rather than trusting the old access claims", async () => {
    const current = (await login(target)).browser;
    const owner = (await login(admin)).browser;
    assert.equal((await owner.request(`/users/${target.id}/role`, "PATCH", { roleKey: "VIEWER" })).status, 200);
    const profile = await current.request("/auth/me");
    assert.equal(profile.status, 200);
    assert.deepEqual(profile.body.roles, ["VIEWER"]);
    assert.equal((await current.request(`/users/${admin.id}`, "PATCH", { status: "SUSPENDED" })).status, 403);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).status, "ACTIVE");
  });

  it("role updates cannot alter another tenant's grants or session or disclose its account", async () => {
    const owner = (await login(admin)).browser;
    const independent = (await login(other)).browser;
    const before = await prisma.userRole.findMany({ where: { userId: other.id }, orderBy: { id: "asc" } });
    const denied = await owner.request(`/users/${other.id}/role`, "PATCH", { roleKey: "VIEWER" });
    assert.equal(denied.status, 404);
    assert.equal(JSON.stringify(denied.body).includes(other.email), false);
    const after = await prisma.userRole.findMany({ where: { userId: other.id }, orderBy: { id: "asc" } });
    assert.deepEqual(after, before);
    const profile = await independent.request("/auth/me");
    assert.equal(profile.status, 200);
    assert.deepEqual(profile.body.roles, ["ADMIN"]);
  });

  it("concurrent role changes leave exactly one role and cannot retain mixed administrator/viewer grants", async () => {
    const owner = (await login(admin)).browser;
    let release: () => void = () => {};
    let ready: () => void = () => {};
    const acquired = new Promise<void>(resolve => { ready = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${target.id} FOR UPDATE`;
      ready();
      await released;
    }, { timeout: 20_000 });
    await acquired;
    const pending = Promise.all(["ADMIN", "VIEWER"].map(roleKey =>
      owner.clone().request(`/users/${target.id}/role`, "PATCH", { roleKey })));
    try {
      let waiting = 0;
      for (let attempt = 0; attempt < 100 && waiting < 2; attempt++) {
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
            AND (query LIKE '%UserRole%' OR query LIKE '%pg_advisory_xact_lock%' OR query LIKE '%FOR UPDATE%')
        `;
        waiting = Number(rows[0].count);
        if (waiting < 2) await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(waiting >= 2, true, "both role updates reached the deterministic PostgreSQL barrier");
    } finally { release(); }
    await blocker;
    const results = await pending;
    assert.equal(results.every(result => result.status === 200), true);
    const assigned = await prisma.userRole.findMany({ where: { userId: target.id }, include: { role: true } });
    assert.equal(assigned.length, 1, "one role per completed role-change command");
    assert.ok(["ADMIN", "VIEWER"].includes(assigned[0].role.key));
  });

  it("a failed role insertion preserves the previous grant and its existing session", async () => {
    const owner = (await login(admin)).browser;
    const current = (await login(target)).browser;
    const viewer = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });
    const trigger = `auth_role_fail_${runId.replaceAll("-", "")}`;
    assert.ok(/^[a-zA-Z0-9_-]+$/.test(target.id) && /^[a-zA-Z0-9_-]+$/.test(viewer.id));
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic role insertion fault' USING ERRCODE = '40001'; END; $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "UserRole"
        FOR EACH ROW WHEN (NEW."userId" = '${target.id}' AND NEW."roleId" = '${viewer.id}')
        EXECUTE FUNCTION "${trigger}"()`);
      const failed = await owner.request(`/users/${target.id}/role`, "PATCH", { roleKey: "VIEWER" });
      assert.equal(failed.status >= 400, true, "the injected database fault must not report success");
      const assigned = await prisma.userRole.findMany({ where: { userId: target.id }, include: { role: true } });
      assert.deepEqual(assigned.map(entry => entry.role.key), ["ADMIN"]);
      const profile = await current.request("/auth/me");
      assert.equal(profile.status, 200);
      assert.deepEqual(profile.body.roles, ["ADMIN"]);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "UserRole"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${trigger}"()`);
    }
  });

  it("a legitimate invitation activates only once and never affects another tenant session", async () => {
    await prisma.user.update({ where: { id: target.id }, data: { status: "INVITED" } });
    const token = randomBytes(32).toString("hex");
    const invitation = await prisma.invitationToken.create({ data: { userId: target.id, tokenHash: resetHash(token), expiresAt: new Date(Date.now() + 300_000) } });
    const reset = await seedReset(target);
    const independent = (await login(other)).browser;
    const password = newPassword();
    const result = await new BrowserSession().request("/auth/accept-invite", "POST", { token, password });
    assert.equal(result.status, 200);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status, "ACTIVE");
    assert.ok(Boolean((await prisma.invitationToken.findUniqueOrThrow({ where: { id: invitation.id } })).usedAt));
    assert.ok(Boolean((await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: reset.id } })).usedAt));
    assert.notEqual((await new BrowserSession().request("/auth/accept-invite", "POST", { token, password: newPassword() })).status, 200);
    assert.equal((await login(target, password)).response.status, 200);
    assert.equal((await independent.request("/auth/me")).status, 200);
  });
});
