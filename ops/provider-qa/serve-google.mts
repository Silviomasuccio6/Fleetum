// Local Google QA only. The ordinary server and offline/Stripe entrypoints are unchanged.
import { existsSync, lstatSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyGoogleQa } from "./google-preflight.mjs";
import { installQaNetworkPolicy } from "./network-policy.mjs";

const started = Date.now();
const checked = verifyGoogleQa(process.env);
const repository = fileURLToPath(new URL("../../", import.meta.url));
if ([".env", "backend/.env", "backend/prisma/.env"].some(path => existsSync(join(repository, path)))) {
  throw new Error("PROVIDER_QA_GOOGLE_REAL_ENV_REFUSED");
}
const { env } = await import("../../backend/src/shared/config/env.js");
const root = dirname(env.UPLOAD_DIR);
for (const path of [root, env.UPLOAD_DIR]) {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o777) !== 0o700) throw new Error("PROVIDER_QA_GOOGLE_UNSAFE_ROOT");
}
let shutdown: (() => void) | undefined;
const lease = setTimeout(() => { if (shutdown) shutdown(); else process.exit(1); },
  Math.max(1, checked.maximumDurationSeconds * 1000 - (Date.now() - started)));
const restoreNetwork = installQaNetworkPolicy(checked.networkMode);
const { prisma } = await import("../../backend/src/infrastructure/database/prisma/client.js");
const { createApp } = await import("../../backend/src/app.js");
if (Date.now() - started >= checked.maximumDurationSeconds * 1000) throw new Error("PROVIDER_QA_GOOGLE_LEASE_EXPIRED");
const server = createApp().listen(4200, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== "127.0.0.1") throw new Error("PROVIDER_QA_GOOGLE_BIND_REFUSED");
  writeFileSync(join(root, "ready.json"), JSON.stringify({ environment: "provider-qa", mode: "google", ...checked,
    address: address.address, port: address.port, email: "disabled", automaticWorkersStarted: 0 }), { flag: "wx", mode: 0o600 });
});
let closing = false;
shutdown = () => {
  if (closing) return;
  closing = true;
  clearTimeout(lease);
  const force = setTimeout(() => process.exit(1), 5000);
  force.unref();
  server.close(() => { restoreNetwork(); void prisma.$disconnect().finally(() => process.exit(0)); });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
