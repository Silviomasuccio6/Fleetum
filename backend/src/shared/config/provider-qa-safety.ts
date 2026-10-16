import type { StagingIsolationConfig } from "./staging-safety.js";

export const PROVIDER_QA_CANONICAL = {
  appUrl: "http://localhost:5273",
  backendPublicUrl: "http://localhost:4200",
  corsOrigin: "http://localhost:5273",
  platformCorsOrigin: "http://localhost:5274"
} as const;

// This is a local test profile, never an alternative way to deploy staging.
// Errors contain field names only; credentials and URLs are never interpolated.
export const assertProviderQaIsolation = (config: StagingIsolationConfig): void => {
  if (config.environment !== "provider-qa") return;
  const raw = config.rawEnv;
  const require = (condition: boolean, field: string) => {
    if (!condition) throw new Error(`PROVIDER_QA_INVALID_${field}`);
  };
  const configured = (name: string) => Boolean(raw[name]?.trim());
  require(raw.NODE_ENV === "test", "NODE_ENV");
  require(raw.DOTENV_CONFIG_PATH === "/dev/null", "DOTENV_CONFIG_PATH");
  require(config.appUrl === PROVIDER_QA_CANONICAL.appUrl, "APP_URL");
  require(config.backendPublicUrl === PROVIDER_QA_CANONICAL.backendPublicUrl, "BACKEND_PUBLIC_URL");
  require(config.corsOrigin === PROVIDER_QA_CANONICAL.corsOrigin, "CORS_ORIGIN");
  require(config.platformCorsOrigin === PROVIDER_QA_CANONICAL.platformCorsOrigin, "PLATFORM_CORS_ORIGIN");
  require(raw.PORT === "4200" && raw.PLATFORM_PORT === "4300", "PORTS");
  require(raw.PLATFORM_BIND_HOST === "127.0.0.1" && raw.TRUST_PROXY === "false", "BINDING");
  require(config.emailProvider === "disabled", "EMAIL_PROVIDER");
  require(config.storageProvider === "local", "STORAGE_PROVIDER");
  require(!config.privacyRetentionCronEnabled && !config.privacyRetentionGlobalEnabled &&
    !config.billingDunningCronEnabled, "AUTOMATIC_JOBS");
  const runId = raw.FLEETUM_PROVIDER_QA_RUN_ID ?? "";
  require(/^[a-z0-9]{12,32}$/.test(runId), "RUN_ID");
  const temporaryRoot = process.platform === "darwin" ? "/private/tmp" : "/tmp";
  require(raw.UPLOAD_DIR === `${temporaryRoot}/fleetum-provider-qa-${runId}/uploads`, "UPLOAD_DIR");
  let database: URL;
  try { database = new URL(config.databaseUrl); }
  catch { throw new Error("PROVIDER_QA_INVALID_DATABASE_URL"); }
  require(["postgres:", "postgresql:"].includes(database.protocol) &&
    database.hostname === "127.0.0.1" && Number(database.port) >= 1024 &&
    database.username === "fleetum_provider_qa" && database.password.length >= 16 &&
    database.pathname === "/fleetum_provider_qa" && database.hash === "" &&
    ["", "?schema=public"].includes(database.search), "DATABASE_URL");

  for (const name of Object.keys(raw)) {
    if (name.startsWith("APPLE_") || name.startsWith("S3_") ||
        ["RESEND_API_KEY", "RESEND_FROM", "DEMO_LEAD_RECIPIENT_EMAIL"].includes(name)) {
      require(!configured(name), "FORBIDDEN_PROVIDER");
    }
  }
  const mode = raw.FLEETUM_PROVIDER_QA_MODE;
  require(["offline", "stripe", "google", "both"].includes(mode ?? ""), "MODE");
  const stripe = mode === "stripe" || mode === "both";
  const google = mode === "google" || mode === "both";
  if (stripe) {
    require(/^sk_test_[A-Za-z0-9]{16,}$/.test(raw.STRIPE_SECRET_KEY ?? ""), "STRIPE_SECRET_KEY");
    require(/^whsec_[A-Za-z0-9]{16,}$/.test(raw.STRIPE_WEBHOOK_SECRET ?? ""), "STRIPE_WEBHOOK_SECRET");
    require(/^acct_[A-Za-z0-9]+$/.test(raw.FLEETUM_PROVIDER_QA_STRIPE_ACCOUNT_ID ?? ""), "STRIPE_ACCOUNT_ID");
    if (configured("STRIPE_PORTAL_RETURN_URL")) {
      require(raw.STRIPE_PORTAL_RETURN_URL === `${PROVIDER_QA_CANONICAL.appUrl}/billing`, "STRIPE_PORTAL_RETURN_URL");
    }
  } else {
    require(!Object.keys(raw).some(name => name.startsWith("STRIPE_") && configured(name)), "STRIPE_DISABLED");
  }
  if (google) {
    require(/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(raw.GOOGLE_CLIENT_ID ?? ""), "GOOGLE_CLIENT_ID");
    require(raw.GOOGLE_CLIENT_ID === raw.FLEETUM_PROVIDER_QA_GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_BINDING");
    require(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(raw.FLEETUM_PROVIDER_QA_GOOGLE_PROJECT_ID ?? ""), "GOOGLE_PROJECT_ID");
    require(configured("GOOGLE_CLIENT_SECRET"), "GOOGLE_CLIENT_SECRET");
    require(raw.GOOGLE_REDIRECT_URI === `${PROVIDER_QA_CANONICAL.backendPublicUrl}/api/auth/google/callback`, "GOOGLE_REDIRECT_URI");
  } else {
    require(!Object.keys(raw).some(name => name.startsWith("GOOGLE_") && configured(name)), "GOOGLE_DISABLED");
  }
  if (configured("OAUTH_CALLBACK_URL")) {
    require(raw.OAUTH_CALLBACK_URL === `${PROVIDER_QA_CANONICAL.appUrl}/auth/social-callback`, "OAUTH_CALLBACK_URL");
  }
};
