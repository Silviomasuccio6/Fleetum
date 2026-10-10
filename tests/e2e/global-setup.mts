import { request } from "@playwright/test";
import { runTenantPreflight } from "../../ops/e2e/tenant-preflight.mjs";

export default async function globalSetup() {
  await runTenantPreflight({
    env: process.env,
    createContext: (options: Parameters<typeof request.newContext>[0]) => request.newContext(options)
  });
}
