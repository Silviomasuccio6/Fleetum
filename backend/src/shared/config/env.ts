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
const TEST_PLATFORM_ADMIN_PASSWORD = "ci-platform-admin-password-0000";
const TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/fermi_ci?schema=public";
const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER ?? "smtp").toLowerCase();

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
const PLATFORM_ADMIN_PASSWORD = required(
  "PLATFORM_ADMIN_PASSWORD",
  isCiOrTest ? TEST_PLATFORM_ADMIN_PASSWORD : undefined
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

if (PLATFORM_ADMIN_PASSWORD.length < 20) {
  throw new Error("PLATFORM_ADMIN_PASSWORD must be at least 20 chars");
}

if (!["smtp", "resend"].includes(EMAIL_PROVIDER)) {
  throw new Error("EMAIL_PROVIDER must be smtp or resend");
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
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "1d",
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
  PRIVACY_RETENTION_CRON_ENABLED: toBool(process.env.PRIVACY_RETENTION_CRON_ENABLED ?? "false"),
  PRIVACY_RETENTION_CRON_SCHEDULE: process.env.PRIVACY_RETENTION_CRON_SCHEDULE ?? "30 3 * * *",

  EMAIL_PROVIDER: EMAIL_PROVIDER as "smtp" | "resend",
  SMTP_HOST: required("SMTP_HOST", EMAIL_PROVIDER === "resend" || isCiOrTest ? "localhost" : undefined),
  SMTP_PORT: toInt(process.env.SMTP_PORT ?? "465", "SMTP_PORT"),
  SMTP_SECURE: toBool(process.env.SMTP_SECURE ?? "true"),
  SMTP_USER: required("SMTP_USER", EMAIL_PROVIDER === "resend" || isCiOrTest ? "ci@example.local" : undefined),
  SMTP_PASS: required("SMTP_PASS", EMAIL_PROVIDER === "resend" || isCiOrTest ? "ci-smtp-pass-placeholder" : undefined),
  SMTP_FROM: process.env.SMTP_FROM ?? "",
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM: process.env.RESEND_FROM ?? process.env.SMTP_FROM ?? "Fleetum <onboarding@resend.dev>",
  DEMO_LEAD_RECIPIENT_EMAIL: process.env.DEMO_LEAD_RECIPIENT_EMAIL,

  CRON_REMINDER_SCHEDULE: process.env.CRON_REMINDER_SCHEDULE ?? "*/10 * * * *",
  SLA_PRIORITY_THRESHOLDS:
    process.env.SLA_PRIORITY_THRESHOLDS ?? '{"LOW":15,"MEDIUM":10,"HIGH":5,"CRITICAL":2}',

  PLATFORM_ADMIN_EMAIL: required("PLATFORM_ADMIN_EMAIL", isCiOrTest ? "ci-admin@example.local" : undefined),
  PLATFORM_ADMIN_PASSWORD,
  PLATFORM_ADMIN_OTP: process.env.PLATFORM_ADMIN_OTP,
  PLATFORM_ALLOWED_IPS_CSV: process.env.PLATFORM_ALLOWED_IPS ?? "",
  PLATFORM_ALERT_EMAILS: toCsvList(process.env.PLATFORM_ALERT_EMAILS),
  PLATFORM_LOGIN_MAX_ATTEMPTS: toInt(process.env.PLATFORM_LOGIN_MAX_ATTEMPTS ?? "5", "PLATFORM_LOGIN_MAX_ATTEMPTS"),
  PLATFORM_LOGIN_WINDOW_MS: toInt(process.env.PLATFORM_LOGIN_WINDOW_MS ?? String(15 * 60 * 1000), "PLATFORM_LOGIN_WINDOW_MS"),
  PLATFORM_LOGIN_LOCK_MS: toInt(process.env.PLATFORM_LOGIN_LOCK_MS ?? String(30 * 60 * 1000), "PLATFORM_LOGIN_LOCK_MS"),

  BILLING_TRIAL_DAYS: toInt(process.env.BILLING_TRIAL_DAYS ?? "14", "BILLING_TRIAL_DAYS"),
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_STARTER_MONTHLY: process.env.STRIPE_PRICE_STARTER_MONTHLY,
  STRIPE_PRICE_STARTER_YEARLY: process.env.STRIPE_PRICE_STARTER_YEARLY,
  STRIPE_PRICE_PRO_MONTHLY: process.env.STRIPE_PRICE_PRO_MONTHLY,
  STRIPE_PRICE_PRO_YEARLY: process.env.STRIPE_PRICE_PRO_YEARLY,
  STRIPE_PRICE_ENTERPRISE_MONTHLY: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
  STRIPE_PRICE_ENTERPRISE_YEARLY: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY
} as const;
