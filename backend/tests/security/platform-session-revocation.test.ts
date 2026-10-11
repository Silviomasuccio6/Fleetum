import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { PlatformAdminService } from "../../src/application/services/platform-admin-service.js";
import { PlatformSessionService } from "../../src/application/services/platform-session-service.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { PlatformAdminController } from "../../src/interfaces/http/controllers/platform-admin-controller.js";
import { requireAuth } from "../../src/interfaces/http/middlewares/auth.js";
import { errorHandler } from "../../src/interfaces/http/middlewares/error-handler.js";
import { platformAdminRoutes } from "../../src/interfaces/http/routes/platform-admin-routes.js";
import { env } from "../../src/shared/config/env.js";

const action = "PLATFORM_SESSION_REVOKED";
const hashes: string[] = [];
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const issuedToken = (extra: Record<string, unknown> = {}, secret = env.PLATFORM_JWT_SECRET) => {
  const token = jwt.sign({ userId: "platform-admin", tenantId: "platform", roles: ["PLATFORM_ADMIN"],
    permissions: ["platform:manage"], platformAdmin: true, tokenType: "platform", jti: randomUUID(), ...extra }, secret, { expiresIn: "5m" });
  hashes.push(hash(token));
  return token;
};
const count = (token: string) => prisma.platformSecurityEvent.count({ where: { action, details: { path: ["tokenHash"], equals: hash(token) } } });
const servers: Server[] = [];
let origin: string;

async function startHttp(sessions = new PlatformSessionService()) {
  // Real JWT middleware, controller, routes and PostgreSQL. Only the harmless
  // overview response is synthetic; no SMTP, provider or alert is invoked.
  const controller = new PlatformAdminController({} as any, {} as any, { overview: async () => ({ synthetic: "platform" }) } as any, sessions);
  const app = express();
  app.use(express.json());
  app.use("/platform-api", platformAdminRoutes(controller));
  app.get("/tenant/probe", requireAuth, (req, res) => res.json({ tenantId: req.auth?.tenantId }));
  app.use(errorHandler);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  servers.push(server);
  const address = server.address(); assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}
async function request(token: string, path = "/platform-api/overview", method = "GET", base = origin) {
  return fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
}
async function freshProcessAuth(token: string) {
  const source = `import { requirePlatformAuth } from './backend/src/interfaces/http/middlewares/platform-auth.js';
import { prisma } from './backend/src/infrastructure/database/prisma/client.js';
let raw=''; for await (const piece of process.stdin) raw+=piece;
const req={headers:{authorization:'Bearer '+raw}};
let error; await requirePlatformAuth(req,{},value=>{error=value;});
console.log(JSON.stringify({status:error?.statusCode??200,code:error?.code})); await prisma.$disconnect();`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
    cwd: process.cwd().endsWith("/backend") ? ".." : process.cwd(),
    env: { PATH: process.env.PATH, NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null", DATABASE_URL: process.env.DATABASE_URL,
      JWT_SECRET: env.JWT_SECRET, PLATFORM_JWT_SECRET: env.PLATFORM_JWT_SECRET, PLATFORM_ADMIN_EMAIL: env.PLATFORM_ADMIN_EMAIL,
      PLATFORM_ADMIN_PASSWORD_HASH: env.PLATFORM_ADMIN_PASSWORD_HASH,
      // The isolated runner can select a cached engine without copying it into node_modules.
      // A separate process must use that same explicit engine, not an incidental prior install.
      ...(process.env.PRISMA_QUERY_ENGINE_LIBRARY ? { PRISMA_QUERY_ENGINE_LIBRARY: process.env.PRISMA_QUERY_ENGINE_LIBRARY } : {}) },
    stdio: ["pipe", "pipe", "pipe"], signal: AbortSignal.timeout(8000)
  });
  let output = ""; child.stdout.on("data", value => { output += value.toString(); });
  child.stderr.resume(); child.stdin.end(token);
  const code = await new Promise<number | null>((resolve, reject) => { child.once("close", resolve); child.once("error", reject); });
  assert.equal(code, 0);
  return JSON.parse(output.trim().split("\n").at(-1)!);
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
async function bounded<T>(promise: Promise<T>, label: string, timeout = 7000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out coordinating ${label}`)), timeout);
  })]); } finally { if (timer) clearTimeout(timer); }
}
async function concurrentLogoutWithRealLock(token: string) {
  const firstLocked = deferred(); const secondAttempted = deferred(); const releaseFirst = deferred();
  let sequence = 0; let firstPid = 0; let secondPid = 0;
  const originalTransaction = prisma.$transaction;
  const coordinatedDatabase = new Proxy(prisma, { get(target, key) {
    if (key === "$transaction") return (callback: any, options: any) => originalTransaction.call(prisma, async (tx: any) => {
      const current = ++sequence;
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      if (current === 1) firstPid = pid; else secondPid = pid;
      return callback(new Proxy(tx, { get(inner, field) {
        if (field === "$queryRaw") return async (...args: any[]) => {
          const lock = Array.isArray(args[0]) && args[0].some((part: string) => part.includes("pg_advisory_xact_lock"));
          if (lock && current === 2) secondAttempted.resolve();
          const result = await inner.$queryRaw(...args);
          if (lock && current === 1) {
            firstLocked.resolve();
            await bounded(releaseFirst.promise, "release first real PostgreSQL advisory lock");
          }
          return result;
        };
        const value = Reflect.get(inner, field); return typeof value === "function" ? value.bind(inner) : value;
      } }));
    }, options);
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const base = await startHttp(new PlatformSessionService(coordinatedDatabase));
  const pending: Promise<Response>[] = [];
  try {
    pending.push(request(token, "/platform-api/auth/logout", "POST", base));
    await bounded(firstLocked.promise, "first real PostgreSQL advisory lock");
    pending.push(request(token, "/platform-api/auth/logout", "POST", base));
    await bounded(secondAttempted.promise, "second real PostgreSQL lock attempt");
    let blocked = false; const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      const [observed] = await prisma.$queryRaw<Array<{ blockers: number[] }>>`SELECT pg_blocking_pids(${secondPid}::integer) AS blockers`;
      if (observed.blockers.includes(firstPid)) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    assert(blocked, "Second HTTP logout must actually wait on the first PostgreSQL advisory lock");
    releaseFirst.resolve();
    return await bounded(Promise.all(pending), "both real HTTP logout responses");
  } finally {
    releaseFirst.resolve();
    await bounded(Promise.allSettled(pending), "logout coordination cleanup");
  }
}

describe("durable per-session Platform logout on synthetic PostgreSQL and local HTTP", () => {
  before(async () => {
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(process.env.DOTENV_CONFIG_PATH, "/dev/null");
    assert.equal(process.env.RUN_TENANT_ISOLATION_TESTS, "1");
    const url = new URL(process.env.DATABASE_URL!);
    assert(url.hostname === "127.0.0.1" && url.pathname === "/fleetum_ci" && url.username === "fleetum" && url.port);
    await prisma.$connect();
    assert.equal(await prisma.platformAdminCredential.findUnique({ where: { email: env.PLATFORM_ADMIN_EMAIL.trim().toLowerCase() } }), null);
    origin = await startHttp();
  });
  after(async () => {
    for (const server of servers) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (hashes.length) await prisma.platformSecurityEvent.deleteMany({ where: { action, OR: hashes.map(tokenHash => ({ details: { path: ["tokenHash"], equals: tokenHash } })) } });
    await prisma.$disconnect();
  });

  it("real HTTP login token authorizes, logout commits, then bearer replay is rejected", async () => {
    const token = issuedToken();
    assert.equal((await request(token)).status, 200);
    const logout = await request(token, "/platform-api/auth/logout", "POST");
    assert.equal(logout.status, 200); assert.deepEqual(await logout.json(), { revoked: true });
    assert.equal(logout.headers.get("cache-control"), "no-store");
    const replay = await request(token); assert.equal(replay.status, 401);
    assert.equal((await replay.json() as any).error, "PLATFORM_SESSION_REVOKED");
    const event = await prisma.platformSecurityEvent.findFirstOrThrow({ where: { action, details: { path: ["tokenHash"], equals: hash(token) } } });
    assert.deepEqual(event.details, { tokenHash: hash(token), expiresAt: new Date((jwt.decode(token) as any).exp * 1000).toISOString() });
    assert.equal(event.actor, env.PLATFORM_ADMIN_EMAIL.trim().toLowerCase());
    assert.equal(JSON.stringify(event).includes(token), false);
  });
  it("same-second independent issued sessions stay distinct and logout revokes only one", async () => {
    const service = new PlatformAdminService({} as any, {} as any, {} as any);
    const first = (service as any).createPlatformSession().token as string;
    const second = (service as any).createPlatformSession().token as string;
    hashes.push(hash(first), hash(second)); assert.notEqual(first, second);
    assert.equal((await request(first, "/platform-api/auth/logout", "POST")).status, 200);
    assert.equal((await request(first)).status, 401);
    assert.equal((await request(second)).status, 200);
    assert.equal(await count(first), 1); assert.equal(await count(second), 0);
  });
  it("two concurrent logout requests both acknowledge but create one durable event", async () => {
    const token = issuedToken();
    const replies = await concurrentLogoutWithRealLock(token);
    assert.deepEqual(replies.map(reply => reply.status), [200, 200]);
    for (const reply of replies) assert.deepEqual(await reply.json(), { revoked: true });
    assert.equal(await count(token), 1);
    assert.equal((await request(token)).status, 401);
  });
  it("legacy signed Platform tokens without jti also support durable per-token revocation", async () => {
    const token = issuedToken({ jti: undefined });
    assert.equal((jwt.decode(token) as any).jti, undefined);
    assert.equal((await request(token)).status, 200);
    assert.equal((await request(token, "/platform-api/auth/logout", "POST")).status, 200);
    assert.equal(await count(token), 1); assert.equal((await request(token)).status, 401);
  });
  it("already revoked logout retry remains idempotent and never restores privileged access", async () => {
    const token = issuedToken();
    for (let retry = 0; retry < 3; retry++) assert.equal((await request(token, "/platform-api/auth/logout", "POST")).status, 200);
    assert.equal(await count(token), 1); assert.equal((await request(token)).status, 401);
  });
  it("a fresh operating-system process reads the durable revocation", async () => {
    const token = issuedToken();
    assert.equal((await request(token, "/platform-api/auth/logout", "POST")).status, 200);
    const otherProcess = await freshProcessAuth(token);
    assert.equal(otherProcess.status, 401); assert.equal(otherProcess.code, "PLATFORM_SESSION_REVOKED");
  });
  it("failed persistence returns non-success, rolls back, and leaves the original token usable", async () => {
    const originalTransaction = prisma.$transaction;
    const failingDatabase = new Proxy(prisma, { get(target, key) {
      if (key === "$transaction") return (callback: any, options: any) => originalTransaction.call(prisma, async (tx: any) => callback(new Proxy(tx, { get(inner, field) {
        if (field === "platformSecurityEvent") return { ...inner.platformSecurityEvent, create: async (args: any) => { await inner.platformSecurityEvent.create(args); throw new Error("Synthetic persistence failure after real INSERT"); } };
        const value = Reflect.get(inner, field); return typeof value === "function" ? value.bind(inner) : value;
      } })), options);
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const failedOrigin = await startHttp(new PlatformSessionService(failingDatabase));
    const token = issuedToken();
    assert.equal((await request(token, "/platform-api/auth/logout", "POST", failedOrigin)).status, 500);
    assert.equal(await count(token), 0); assert.equal((await request(token)).status, 200);
    assert.equal((await request(token, "/platform-api/auth/logout", "POST")).status, 200);
    assert.equal(await count(token), 1);
  });
  it("tenant-secret and wrong-identity tokens cannot create revocation events or gain Platform access", async () => {
    for (const token of [issuedToken({}, env.JWT_SECRET), issuedToken({ tenantId: "synthetic-tenant-a" }), issuedToken({ tokenType: "access", platformAdmin: false })]) {
      for (const [path, method] of [["/platform-api/overview", "GET"], ["/platform-api/auth/logout", "POST"]]) {
        const response = await request(token, path, method); assert([401, 403].includes(response.status));
      }
      assert.equal(await count(token), 0);
    }
  });
  it("expired tokens cannot authorize or mutate the durable revocation store", async () => {
    const token = jwt.sign({ userId: "platform-admin", tenantId: "platform", roles: ["PLATFORM_ADMIN"], permissions: ["platform:manage"],
      platformAdmin: true, tokenType: "platform", jti: randomUUID() }, env.PLATFORM_JWT_SECRET, { expiresIn: -1 });
    hashes.push(hash(token));
    const logout = await request(token, "/platform-api/auth/logout", "POST");
    assert.equal(logout.status, 401); assert.equal((await logout.json() as any).error, "PLATFORM_SESSION_EXPIRED");
    assert.equal(await count(token), 0); assert.equal((await request(token)).status, 401);
  });
  it("existing Platform password-reset cutoff applies to business access and logout", async () => {
    const token = issuedToken({ iat: Math.floor(Date.now() / 1000) - 60 });
    const credential = await prisma.platformAdminCredential.create({ data: { email: env.PLATFORM_ADMIN_EMAIL.trim().toLowerCase(),
      passwordHash: env.PLATFORM_ADMIN_PASSWORD_HASH, passwordChangedAt: new Date(), lastResetAt: new Date() } });
    try {
      for (const [path, method] of [["/platform-api/overview", "GET"], ["/platform-api/auth/logout", "POST"]]) {
        const result = await request(token, path, method); assert.equal(result.status, 401);
        assert.equal((await result.json() as any).error, "PLATFORM_SESSION_REVOKED");
      }
      assert.equal(await count(token), 0);
    } finally { await prisma.platformAdminCredential.delete({ where: { id: credential.id } }); }
  });
  it("logout preserves trusted-device authorization and pending login/password-reset challenges", async () => {
    const token = issuedToken(); const id = randomUUID();
    const challenge = await prisma.platformOtpChallenge.create({ data: { key: `login:synthetic-${id}@example.invalid`, codeHash: hash(id), expiresAt: new Date(Date.now() + 60000) } });
    const reset = await prisma.platformOtpChallenge.create({ data: { key: `password-reset-token:${id}`, codeHash: hash(randomUUID()), expiresAt: new Date(Date.now() + 60000) } });
    const device = await prisma.platformTrustedDevice.create({ data: { deviceId: id, tokenHash: hash(randomUUID()), userAgentHash: hash("synthetic-browser"), expiresAt: new Date(Date.now() + 60000) } });
    try {
      assert.equal((await request(token, "/platform-api/auth/logout", "POST")).status, 200);
      assert.deepEqual(await prisma.platformOtpChallenge.findUnique({ where: { id: challenge.id } }), challenge);
      assert.deepEqual(await prisma.platformOtpChallenge.findUnique({ where: { id: reset.id } }), reset);
      assert.deepEqual(await prisma.platformTrustedDevice.findUnique({ where: { id: device.id } }), device);
    } finally {
      await prisma.platformOtpChallenge.deleteMany({ where: { id: { in: [challenge.id, reset.id] } } });
      await prisma.platformTrustedDevice.delete({ where: { id: device.id } });
    }
  });
  it("Platform logout never changes the independent tenant refresh session", async () => {
    const tenant = await prisma.tenant.create({ data: { name: `Synthetic Platform isolation ${randomUUID()}` } });
    const user = await prisma.user.create({ data: { tenantId: tenant.id, email: `${randomUUID()}@example.invalid`, firstName: "Synthetic", lastName: "Tenant",
      passwordHash: env.PLATFORM_ADMIN_PASSWORD_HASH, status: "ACTIVE" } });
    const session = await prisma.refreshSession.create({ data: { userId: user.id, tenantId: tenant.id, tokenHash: hash(randomUUID()), expiresAt: new Date(Date.now() + 60000) } });
    const tenantToken = jwt.sign({ userId: user.id, tenantId: tenant.id, sessionId: session.id, roles: [], permissions: [], tokenType: "access" }, env.JWT_SECRET, { expiresIn: "5m" });
    const platformToken = issuedToken();
    try {
      assert.equal((await request(tenantToken, "/tenant/probe")).status, 200);
      assert.equal((await request(platformToken, "/tenant/probe")).status, 401);
      assert.equal((await request(tenantToken, "/platform-api/auth/logout", "POST")).status, 401);
      assert.equal((await request(platformToken, "/platform-api/auth/logout", "POST")).status, 200);
      assert.equal((await request(tenantToken, "/tenant/probe")).status, 200);
      assert.deepEqual(await prisma.refreshSession.findUnique({ where: { id: session.id } }), session);
    } finally {
      await prisma.refreshSession.delete({ where: { id: session.id } });
      await prisma.user.delete({ where: { id: user.id } }); await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });
});
