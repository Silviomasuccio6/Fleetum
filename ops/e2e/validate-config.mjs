import process from "node:process";
import { pathToFileURL } from "node:url";

const REQUIRED_SETTINGS = [
  "E2E_BASE_URL",
  "E2E_API_URL",
  "E2E_TENANT_EMAIL",
  "E2E_TENANT_PASSWORD",
  "E2E_OTHER_TENANT_EMAIL",
  "E2E_OTHER_TENANT_PASSWORD"
];

const PRODUCTION_HOSTS = new Set(["fleetum.it", "www.fleetum.it", "api.fleetum.it", "platform.fleetum.it", "api-platform.fleetum.it"]);
const STAGING_BASE_TARGETS = new Set(["https://staging.fleetum.it", "https://staging.fleetum.it:443"]);
const STAGING_API_TARGETS = new Set([
  "https://api-staging.fleetum.it/api", "https://api-staging.fleetum.it:443/api",
  "https://staging.fleetum.it/api", "https://staging.fleetum.it:443/api"
]);

export function hasHostedOrCiContext(env = process.env) {
  const ciValue = String(env.CI ?? "").trim().toLowerCase();
  return !["", "false", "0"].includes(ciValue)
    || String(env.GITHUB_ACTIONS ?? "").trim().toLowerCase() === "true"
    || Boolean(env.GITHUB_RUN_ID);
}

function readUrl(env, name, errors) {
  const value = env[name];
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      errors.push(`${name} must use HTTPS.`);
    }
    if (url.username || url.password) {
      errors.push(`${name} must not contain embedded credentials.`);
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (PRODUCTION_HOSTS.has(hostname)) {
      errors.push(`${name} must target the synthetic staging environment, not Fleetum production.`);
    }
    return url;
  } catch {
    errors.push(`${name} must be a valid absolute URL.`);
    return null;
  }
}

export function validateE2EConfig(env = process.env) {
  const errors = [];
  const missing = REQUIRED_SETTINGS.filter((name) => typeof env[name] !== "string" || !env[name].trim());
  const targetMode = env.E2E_TARGET_MODE ?? "staging";

  if (missing.length > 0) {
    errors.push(`Missing required E2E settings: ${missing.join(", ")}.`);
  }

  const baseUrl = readUrl(env, "E2E_BASE_URL", errors);
  const apiUrl = readUrl(env, "E2E_API_URL", errors);

  if (!["staging", "local-rehearsal"].includes(targetMode)) {
    errors.push("E2E_TARGET_MODE must be staging or local-rehearsal.");
  }
  if (targetMode === "local-rehearsal") {
    if (env.NODE_ENV !== "test" || hasHostedOrCiContext(env)) {
      errors.push("Local rehearsal is allowed only with NODE_ENV=test outside CI and hosted GitHub Actions.");
    }
    const match = typeof env.E2E_BASE_URL === "string" && /^https:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(env.E2E_BASE_URL);
    if (!match || Number(match[1]) > 65535 || !baseUrl) {
      errors.push("Local E2E_BASE_URL must be canonical HTTPS 127.0.0.1 with an explicit valid port and no extra URL components.");
    }
    if (!apiUrl || env.E2E_API_URL !== `${env.E2E_BASE_URL}/api` || apiUrl.origin !== baseUrl?.origin) {
      errors.push("Local E2E_API_URL must use the same explicit-port loopback HTTPS origin and exact /api path.");
    }
  } else {
    if (baseUrl && !STAGING_BASE_TARGETS.has(env.E2E_BASE_URL)) {
      errors.push("E2E_BASE_URL must use the canonical staging frontend origin with no extra URL components.");
    }
    if (apiUrl && !STAGING_API_TARGETS.has(env.E2E_API_URL)) {
      errors.push("E2E_API_URL must use an approved canonical staging origin and the exact /api path.");
    }
  }

  const tenantEmail = typeof env.E2E_TENANT_EMAIL === "string" ? env.E2E_TENANT_EMAIL.trim().toLowerCase() : "";
  const otherTenantEmail = typeof env.E2E_OTHER_TENANT_EMAIL === "string" ? env.E2E_OTHER_TENANT_EMAIL.trim().toLowerCase() : "";
  if (tenantEmail && otherTenantEmail && tenantEmail === otherTenantEmail) {
    errors.push("The primary and secondary E2E tenants must be different accounts.");
  }

  return { ok: errors.length === 0, errors };
}

export function runConfigValidation(env = process.env, output = console) {
  const result = validateE2EConfig(env);
  if (!result.ok) {
    output.error("E2E configuration rejected:");
    for (const error of result.errors) output.error(`- ${error}`);
    return 1;
  }

  output.log("E2E configuration accepted for two distinct account credentials; tenant identity is checked by preflight.");
  return 0;
}

const isCli = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isCli) {
  process.exitCode = runConfigValidation();
}
