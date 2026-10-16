// Dedicated local entrypoint. No dotenv file, cron, production server or real email.
import { lstatSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { installQaNetworkPolicy } from "./network-policy.mjs";

if (process.env.FLEETUM_ENVIRONMENT !== "provider-qa" || process.env.NODE_ENV !== "test" ||
    process.env.DOTENV_CONFIG_PATH !== "/dev/null") throw new Error("PROVIDER_QA_ENTRYPOINT_REFUSED");
// External execution is deliberately not armed by local preparation.
if (process.env.FLEETUM_PROVIDER_QA_MODE !== "offline") throw new Error("PROVIDER_QA_EXTERNAL_EXECUTION_NOT_ARMED");
const { env } = await import("../../backend/src/shared/config/env.js");
const root = dirname(env.UPLOAD_DIR);
for (const path of [root, env.UPLOAD_DIR]) {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o777) !== 0o700) throw new Error("PROVIDER_QA_UNSAFE_TEMPORARY_ROOT");
}
const duration = Number(process.env.FLEETUM_PROVIDER_QA_MAX_SECONDS ?? "60");
if (!Number.isInteger(duration) || duration < 15 || duration > 3600) throw new Error("PROVIDER_QA_INVALID_DURATION");
const restoreNetwork = installQaNetworkPolicy("offline");
const { prisma } = await import("../../backend/src/infrastructure/database/prisma/client.js");
const { createApp } = await import("../../backend/src/app.js");
const server = createApp().listen(4200, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== "127.0.0.1") throw new Error("PROVIDER_QA_BIND_REFUSED");
  writeFileSync(join(root, "ready.json"), JSON.stringify({ environment: "provider-qa", mode: "offline",
    address: address.address, port: address.port, email: "disabled", automaticWorkersStarted: 0,
    maximumDurationSeconds: duration }), { flag: "wx", mode: 0o600 });
});
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  clearTimeout(lease);
  const force = setTimeout(() => process.exit(1), 5000);
  force.unref();
  server.close(() => { restoreNetwork(); void prisma.$disconnect().finally(() => process.exit(0)); });
};
const lease = setTimeout(close, duration * 1000);
process.on("SIGTERM", close);
process.on("SIGINT", close);
