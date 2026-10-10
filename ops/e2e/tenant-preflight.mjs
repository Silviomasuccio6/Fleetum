import process from "node:process";
import { validateE2EConfig } from "./validate-config.mjs";

const tenantIdOf = (value) => typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value ? value : null;
const successful = (response) => response.status() >= 200 && response.status() < 300;

export async function runTenantPreflight({ env = process.env, createContext } = {}) {
  const configuration = validateE2EConfig(env);
  if (!configuration.ok) throw new Error(`E2E tenant preflight rejected configuration: ${configuration.errors.join(" ")}`);
  const contexts = [];
  let verified = false;
  try {
    if (typeof createContext !== "function") throw new Error("API context factory required");
    for (let index = 0; index < 2; index += 1) {
      contexts.push(await createContext({
        baseURL: `${env.E2E_API_URL}/`,
        extraHTTPHeaders: { Accept: "application/json" },
        storageState: { cookies: [], origins: [] },
        maxRedirects: 0,
        timeout: 20_000,
        ignoreHTTPSErrors: env.E2E_TARGET_MODE === "local-rehearsal"
      }));
    }
    if (contexts[0] === contexts[1]) throw new Error("API cookie contexts must be isolated");
    const tenantIds = [];
    const accounts = [
      { email: env.E2E_TENANT_EMAIL, password: env.E2E_TENANT_PASSWORD },
      { email: env.E2E_OTHER_TENANT_EMAIL, password: env.E2E_OTHER_TENANT_PASSWORD }
    ];
    for (const [index, api] of contexts.entries()) {
      const login = await api.post("auth/login", { data: accounts[index], maxRedirects: 0, failOnStatusCode: false });
      if (!successful(login)) throw new Error("Authentication did not succeed");
      const payload = await login.json();
      const csrfToken = payload?.csrfToken;
      if (typeof csrfToken !== "string" || !csrfToken.trim()) throw new Error("Authentication CSRF token missing");
      let tenantId = tenantIdOf(payload?.user?.tenantId);
      if (!tenantId) {
        const me = await api.get("auth/me", { maxRedirects: 0, failOnStatusCode: false, headers: { "X-CSRF-Token": csrfToken } });
        if (!successful(me)) throw new Error("Authenticated profile did not succeed");
        tenantId = tenantIdOf((await me.json())?.tenantId);
      }
      if (!tenantId) throw new Error("Authenticated tenant identity missing");
      tenantIds.push(tenantId);
    }
    if (tenantIds[0] === tenantIds[1]) throw new Error("Authenticated tenant identities must differ");
    verified = true;
    return { ok: true };
  } catch {
    // Never propagate transport errors, bodies, URLs, credentials, tokens or tenant IDs.
    throw new Error("E2E tenant preflight failed: unable to verify two authenticated, distinct tenant identities.");
  } finally {
    const cleanup = await Promise.allSettled([...new Set(contexts)].map((context) => Promise.resolve().then(() => context?.dispose())));
    if (verified && cleanup.some(({ status }) => status === "rejected")) {
      throw new Error("E2E tenant preflight failed: unable to dispose isolated API contexts.");
    }
  }
}
