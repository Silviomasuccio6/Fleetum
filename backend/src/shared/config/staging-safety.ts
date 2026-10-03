export type FleetumEnvironment = "production" | "staging";
export type FleetumEmailProvider = "resend" | "disabled";

export const STAGING_CANONICAL = {
  appUrl: "https://staging.fleetum.it",
  backendPublicUrl: "https://api-staging.fleetum.it",
  corsOrigin: "https://staging.fleetum.it",
  platformCorsOrigin: "https://platform-staging.fleetum.it"
} as const;

export const resolveFleetumEnvironment = (value?: string): FleetumEnvironment => {
  const normalized = (value ?? "production").trim().toLowerCase();
  if (normalized !== "production" && normalized !== "staging") {
    throw new Error("FLEETUM_ENVIRONMENT must be production or staging");
  }
  return normalized;
};

export const environmentDefaults = (environment: FleetumEnvironment) => ({
  emailProvider: environment === "staging" ? ("disabled" as const) : ("resend" as const),
  privacyRetentionCronEnabled: false,
  billingDunningCronEnabled: environment === "production"
});

export const resolveEmailProvider = (
  environment: FleetumEnvironment,
  value?: string
): FleetumEmailProvider => {
  const normalized = (value ?? environmentDefaults(environment).emailProvider).trim().toLowerCase();
  if (normalized !== "resend" && normalized !== "disabled") {
    throw new Error("EMAIL_PROVIDER must be resend or disabled");
  }
  if (normalized === "disabled" && environment !== "staging") {
    throw new Error("EMAIL_PROVIDER=disabled is allowed only in staging");
  }
  if (environment === "staging" && normalized !== "disabled") {
    throw new Error("EMAIL_PROVIDER must be disabled in staging");
  }
  return normalized;
};

type StagingIsolationConfig = {
  environment: FleetumEnvironment;
  appUrl: string;
  backendPublicUrl: string;
  corsOrigin: string;
  platformCorsOrigin: string;
  databaseUrl: string;
  emailProvider: FleetumEmailProvider;
  storageProvider: string;
  privacyRetentionCronEnabled: boolean;
  privacyRetentionGlobalEnabled: boolean;
  billingDunningCronEnabled: boolean;
  rawEnv: Record<string, string | undefined>;
};

const STAGING_FORBIDDEN_PROVIDER_VARIABLES = [
  "RESEND_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "APPLE_CLIENT_ID",
  "APPLE_TEAM_ID",
  "APPLE_KEY_ID",
  "APPLE_PRIVATE_KEY",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_REGION",
  "S3_PUBLIC_BASE_URL"
] as const;

const hasConfiguredValue = (value?: string) => typeof value === "string" && value.trim().length > 0;

const assertStagingDatabaseUrl = (databaseUrl: string) => {
  const invalid = () => {
    throw new Error("Invalid staging DATABASE_URL: expected the dedicated Compose PostgreSQL database");
  };

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return invalid();
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") invalid();
  if (parsed.hostname !== "postgres") invalid();
  if (parsed.port !== "" && parsed.port !== "5432") invalid();
  if (parsed.pathname !== "/fleetum_staging") invalid();
  if (parsed.username !== "fleetum_staging" || parsed.password.length === 0) invalid();
  if (parsed.hash !== "") invalid();

  const query = Array.from(parsed.searchParams.entries());
  const allowedQuery = query.length === 0 || (query.length === 1 && query[0][0] === "schema" && query[0][1] === "public");
  if (!allowedQuery) invalid();
};

export const assertStagingIsolation = (config: StagingIsolationConfig): void => {
  if (config.environment !== "staging") return;

  const exactValues: Array<[string, string, string]> = [
    ["APP_URL", config.appUrl, STAGING_CANONICAL.appUrl],
    ["BACKEND_PUBLIC_URL", config.backendPublicUrl, STAGING_CANONICAL.backendPublicUrl],
    ["CORS_ORIGIN", config.corsOrigin, STAGING_CANONICAL.corsOrigin],
    ["PLATFORM_CORS_ORIGIN", config.platformCorsOrigin, STAGING_CANONICAL.platformCorsOrigin]
  ];
  for (const [name, actual, expected] of exactValues) {
    if (actual !== expected) throw new Error(`${name} must use the canonical staging origin`);
  }

  assertStagingDatabaseUrl(config.databaseUrl);

  if (config.emailProvider !== "disabled") {
    throw new Error("EMAIL_PROVIDER must be disabled in staging");
  }
  if (config.storageProvider !== "local") {
    throw new Error("STORAGE_PROVIDER must be local in staging");
  }
  if (config.privacyRetentionCronEnabled) {
    throw new Error("PRIVACY_RETENTION_CRON_ENABLED must be false in staging");
  }
  if (config.privacyRetentionGlobalEnabled) {
    throw new Error("PRIVACY_RETENTION_GLOBAL_ENABLED must be false in staging");
  }
  if (config.billingDunningCronEnabled) {
    throw new Error("BILLING_DUNNING_CRON_ENABLED must be false in staging");
  }

  for (const name of STAGING_FORBIDDEN_PROVIDER_VARIABLES) {
    if (hasConfiguredValue(config.rawEnv[name])) {
      // Only the variable name is reported. Provider credential values must
      // never be copied into startup errors or logs.
      throw new Error(`${name} must not be configured in staging`);
    }
  }
};
