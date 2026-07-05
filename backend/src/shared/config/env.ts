import "dotenv/config";

const required = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

const isCiOrTest = process.env.NODE_ENV === "test" || process.env.CI === "true";
const TEST_JWT_SECRET = "test-jwt-secret-for-ci-only-0000000000000000";
const TEST_PLATFORM_JWT_SECRET =
  "test-platform-jwt-secret-for-ci-only-000000000000000000000000000000000000000000";
const TEST_PLATFORM_ADMIN_PASSWORD_HASH = "$2a$12$1kW0dHz8CuORBMdsqDk9Z.HEJFh/IofTBgmMuBA43F8VUoCgX0Bde";
const TEST_DATABASE_URL = "postgresql://fleetum:fleetum_dev@localhost:5433/fleetum_ci?schema=public";
const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER ?? "resend").toLowerCase();
const STORAGE_PROVIDER = (process.env.STORAGE_PROVIDER ?? "local").toLowerCase();
const PLATFORM_IP_ALLOWLIST_MODE = (process.env.PLATFORM_IP_ALLOWLIST_MODE ?? "optional").toLowerCase();

const toInt = (value: string, name: string) => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: ${value}`);
  return n;
};

const toBool = (value: string) => ["1", "true", "yes", "on"].includes(value.toLowerCase());

const toCsvList = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const parseTrustProxy = (value?: string): boolean | number | string => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return 1;
  const asNumber = Number(normalized);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
  return value;
};

const JWT_SECRET = required("JWT_SECRET", isCiOrTest ? TEST_JWT_SECRET : undefined);
const PLATFORM_JWT_SECRET = required("PLATFORM_JWT_SECRET", isCiOrTest ? TEST_PLATFORM_JWT_SECRET : undefined);
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL ?? "http://127.0.0.1:4000";
const PLATFORM_ADMIN_PASSWORD_HASH = required(
  "PLATFORM_ADMIN_PASSWORD_HASH",
  isCiOrTest ? TEST_PLATFORM_ADMIN_PASSWORD_HASH : undefined
);

if (JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 chars");
}

if (JWT_SECRET === PLATFORM_JWT_SECRET) {
  throw new Error("PLATFORM_JWT_SECRET must be different from JWT_SECRET");
}

if (PLATFORM_JWT_SECRET.length < 64) {
  throw new Error("PLATFORM_JWT_SECRET must be at least 64 chars");
}

if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(PLATFORM_ADMIN_PASSWORD_HASH)) {
  throw new Error("PLATFORM_ADMIN_PASSWORD_HASH must be a complete bcrypt hash generated with bcryptjs");
}

if (EMAIL_PROVIDER !== "resend") {
  throw new Error("EMAIL_PROVIDER must be resend");
}

if (!["local", "s3"].includes(STORAGE_PROVIDER)) {
  throw new Error("STORAGE_PROVIDER must be local or s3");
}

if (!["strict", "optional", "disabled"].includes(PLATFORM_IP_ALLOWLIST_MODE)) {
  throw new Error("PLATFORM_IP_ALLOWLIST_MODE must be strict, optional or disabled");
}

if (STORAGE_PROVIDER === "s3") {
  for (const name of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
    if (!process.env[name]) throw new Error(`Missing required env var for S3 storage: ${name}`);
  }
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: toInt(process.env.PORT ?? "4000", "PORT"),
  PLATFORM_PORT: toInt(process.env.PLATFORM_PORT ?? "4100", "PLATFORM_PORT"),
  SHUTDOWN_GRACE_MS: toInt(process.env.SHUTDOWN_GRACE_MS ?? "15000", "SHUTDOWN_GRACE_MS"),
  PLATFORM_BIND_HOST: process.env.PLATFORM_BIND_HOST ?? "127.0.0.1",
  TRUST_PROXY: parseTrustProxy(process.env.TRUST_PROXY),

  DATABASE_URL: required("DATABASE_URL", isCiOrTest ? TEST_DATABASE_URL : undefined),
  JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "15m",
  PLATFORM_JWT_SECRET,
  PLATFORM_JWT_EXPIRES_IN: process.env.PLATFORM_JWT_EXPIRES_IN ?? "15m",

  APP_URL,
  BACKEND_PUBLIC_URL,
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  PLATFORM_CORS_ORIGIN: process.env.PLATFORM_CORS_ORIGIN ?? "http://localhost:5174",
  OAUTH_CALLBACK_URL: process.env.OAUTH_CALLBACK_URL ?? `${APP_URL}/auth/social-callback`,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI ?? `${BACKEND_PUBLIC_URL}/api/auth/google/callback`,
  GOOGLE_WORKSPACE_REDIRECT_URI:
    process.env.GOOGLE_WORKSPACE_REDIRECT_URI ?? `${BACKEND_PUBLIC_URL}/api/calendar/google/callback`,
  APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
  APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
  APPLE_KEY_ID: process.env.APPLE_KEY_ID,
  APPLE_PRIVATE_KEY: process.env.APPLE_PRIVATE_KEY,
  APPLE_REDIRECT_URI: process.env.APPLE_REDIRECT_URI ?? `${BACKEND_PUBLIC_URL}/api/auth/apple/callback`,

  UPLOAD_DIR: process.env.UPLOAD_DIR ?? "uploads",
  STORAGE_PROVIDER: STORAGE_PROVIDER as "local" | "s3",
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  S3_REGION: process.env.S3_REGION,
  S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL,
  S3_SIGNED_URL_EXPIRES_SECONDS: toInt(process.env.S3_SIGNED_URL_EXPIRES_SECONDS ?? "300", "S3_SIGNED_URL_EXPIRES_SECONDS"),
  PRISMA_SLOW_QUERY_MS: process.env.PRISMA_SLOW_QUERY_MS
    ? toInt(process.env.PRISMA_SLOW_QUERY_MS, "PRISMA_SLOW_QUERY_MS")
    : undefined,
  METRICS_ENABLED: toBool(process.env.METRICS_ENABLED ?? "true"),
  METRICS_TOKEN: process.env.METRICS_TOKEN,
  PRIVACY_RETENTION_CRON_ENABLED: toBool(process.env.PRIVACY_RETENTION_CRON_ENABLED ?? "false"),
  PRIVACY_RETENTION_CRON_SCHEDULE: process.env.PRIVACY_RETENTION_CRON_SCHEDULE ?? "30 3 * * *",

  EMAIL_PROVIDER: "resend" as const,
  RESEND_API_KEY: required("RESEND_API_KEY", isCiOrTest ? "re_ci_placeholder" : undefined),
  RESEND_FROM: required("RESEND_FROM", isCiOrTest ? "Fleetum <onboarding@resend.dev>" : undefined),
  DEMO_LEAD_RECIPIENT_EMAIL: process.env.DEMO_LEAD_RECIPIENT_EMAIL,

  CRON_REMINDER_SCHEDULE: process.env.CRON_REMINDER_SCHEDULE ?? "*/10 * * * *",
  SLA_PRIORITY_THRESHOLDS:
    process.env.SLA_PRIORITY_THRESHOLDS ?? '{"LOW":15,"MEDIUM":10,"HIGH":5,"CRITICAL":2}',

  PLATFORM_ADMIN_EMAIL: required("PLATFORM_ADMIN_EMAIL", isCiOrTest ? "ci-admin@example.local" : undefined),
  PLATFORM_ADMIN_PASSWORD_HASH,
  PLATFORM_ADMIN_OTP: process.env.PLATFORM_ADMIN_OTP,
  PLATFORM_ALLOWED_IPS_CSV: process.env.PLATFORM_ALLOWED_IPS ?? "",
  PLATFORM_IP_ALLOWLIST_MODE: PLATFORM_IP_ALLOWLIST_MODE as "strict" | "optional" | "disabled",
  PLATFORM_TRUSTED_DEVICE_ENABLED: toBool(process.env.PLATFORM_TRUSTED_DEVICE_ENABLED ?? "true"),
  PLATFORM_TRUSTED_DEVICE_TTL_DAYS: toInt(process.env.PLATFORM_TRUSTED_DEVICE_TTL_DAYS ?? "90", "PLATFORM_TRUSTED_DEVICE_TTL_DAYS"),
  PLATFORM_ALERT_EMAILS: toCsvList(process.env.PLATFORM_ALERT_EMAILS),
  PLATFORM_LOGIN_MAX_ATTEMPTS: toInt(process.env.PLATFORM_LOGIN_MAX_ATTEMPTS ?? "5", "PLATFORM_LOGIN_MAX_ATTEMPTS"),
  PLATFORM_LOGIN_WINDOW_MS: toInt(process.env.PLATFORM_LOGIN_WINDOW_MS ?? String(15 * 60 * 1000), "PLATFORM_LOGIN_WINDOW_MS"),
  PLATFORM_LOGIN_LOCK_MS: toInt(process.env.PLATFORM_LOGIN_LOCK_MS ?? String(30 * 60 * 1000), "PLATFORM_LOGIN_LOCK_MS"),

  BILLING_TRIAL_DAYS: toInt(process.env.BILLING_TRIAL_DAYS ?? "14", "BILLING_TRIAL_DAYS"),
  BILLING_PAST_DUE_GRACE_DAYS: toInt(process.env.BILLING_PAST_DUE_GRACE_DAYS ?? "7", "BILLING_PAST_DUE_GRACE_DAYS"),
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_STARTER_MONTHLY: process.env.STRIPE_PRICE_STARTER_MONTHLY,
  STRIPE_PRICE_STARTER_YEARLY: process.env.STRIPE_PRICE_STARTER_YEARLY,
  STRIPE_PRICE_PRO_MONTHLY: process.env.STRIPE_PRICE_PRO_MONTHLY,
  STRIPE_PRICE_PRO_YEARLY: process.env.STRIPE_PRICE_PRO_YEARLY,
  STRIPE_PRICE_ENTERPRISE_MONTHLY: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
  STRIPE_PRICE_ENTERPRISE_YEARLY: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY,
  STRIPE_PORTAL_RETURN_URL: process.env.STRIPE_PORTAL_RETURN_URL,
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID: process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID
} as const;
