// Test-only server. Never import server.ts: it starts scheduled production jobs.
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";

const database = new URL(process.env.DATABASE_URL ?? "");
if (process.env.NODE_ENV !== "test" || database.hostname !== "127.0.0.1" || database.pathname !== "/fleetum_rehearsal") {
  throw new Error("Local rehearsal requires its own loopback synthetic database");
}
if (!process.env.FLEETUM_REHEARSAL_READY_FILE) throw new Error("Missing local rehearsal ready file");

const assertLocal = (input: unknown) => {
  const host = typeof input === "string" || input instanceof URL
    ? new URL(input).hostname
    : String((input as { hostname?: string; host?: string })?.hostname ?? (input as { host?: string })?.host ?? "localhost");
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error("External HTTP connection blocked by local rehearsal");
  }
};
for (const transport of [http, https]) {
  const originalRequest = transport.request;
  const originalGet = transport.get;
  transport.request = ((...args: unknown[]) => {
    assertLocal(args[0]);
    if ((typeof args[0] === "string" || args[0] instanceof URL) && args[1] && typeof args[1] === "object") assertLocal(args[1]);
    return Reflect.apply(originalRequest, transport, args);
  }) as typeof transport.request;
  transport.get = ((...args: unknown[]) => {
    assertLocal(args[0]);
    if ((typeof args[0] === "string" || args[0] instanceof URL) && args[1] && typeof args[1] === "object") assertLocal(args[1]);
    return Reflect.apply(originalGet, transport, args);
  }) as typeof transport.get;
}
syncBuiltinESMExports();
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  assertLocal(input instanceof Request ? input.url : input);
  return originalFetch(input, { ...init, redirect: "error" });
};

const { emailSender } = await import("../../backend/src/infrastructure/email/email-sender.js");
let simulatedEmails = 0;
emailSender.send = async () => ({ provider: "resend", id: `synthetic-receipt-${++simulatedEmails}` });
const { prisma } = await import("../../backend/src/infrastructure/database/prisma/client.js");
const { default: bcrypt } = await import("bcryptjs");
const role = await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
const passwordHash = await bcrypt.hash(process.env.DEMO_ADMIN_PASSWORD!, 12);
for (const suffix of ["a", "b"]) {
  await prisma.tenant.create({ data: {
    id: `synthetic-rehearsal-${suffix}`, name: `Synthetic rehearsal ${suffix.toUpperCase()}`,
    tenantSubscription: { create: { provider: "local", plan: "ENTERPRISE", status: "ACTIVE", seats: 10,
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } },
    users: { create: { email: `rehearsal-${suffix}@example.invalid`, passwordHash,
      firstName: "Synthetic", lastName: suffix.toUpperCase(), isEmailVerified: true,
      roles: { create: { roleId: role.id } } } }
  } });
}
const { createApp } = await import("../../backend/src/app.js");
const server = createApp().listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local API port");
  writeFileSync(process.env.FLEETUM_REHEARSAL_READY_FILE!, JSON.stringify({ port: address.port }));
  console.log("Synthetic API ready; cron disabled; external HTTP blocked; email simulated");
});
const close = () => server.close(() => { void prisma.$disconnect().finally(() => process.exit(0)); });
process.on("SIGTERM", close);
process.on("SIGINT", close);
