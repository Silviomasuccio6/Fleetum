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

const PRODUCTION_HOSTS = new Set(["fleetum.it", "www.fleetum.it", "api.fleetum.it"]);

function readUrl(env, name, errors) {
  const value = env[name]?.trim();
  if (!value) return null;

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
  const missing = REQUIRED_SETTINGS.filter((name) => !env[name]?.trim());

  if (missing.length > 0) {
    errors.push(`Missing required E2E settings: ${missing.join(", ")}.`);
  }

  readUrl(env, "E2E_BASE_URL", errors);
  const apiUrl = readUrl(env, "E2E_API_URL", errors);

  if (apiUrl && !apiUrl.pathname.replace(/\/+$/, "").endsWith("/api")) {
    errors.push("E2E_API_URL must include the /api path.");
  }

  const tenantEmail = env.E2E_TENANT_EMAIL?.trim().toLowerCase();
  const otherTenantEmail = env.E2E_OTHER_TENANT_EMAIL?.trim().toLowerCase();
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

  output.log("E2E configuration accepted for two distinct tenants in a non-production environment.");
  return 0;
}

const isCli = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isCli) {
  process.exitCode = runConfigValidation();
}
