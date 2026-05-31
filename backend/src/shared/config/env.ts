import "dotenv/config";
import { z } from "zod";

const isCiOrTest =
  process.env.NODE_ENV === "test" || process.env.CI === "true" || process.env.npm_lifecycle_event === "test";

const TEST_DEFAULTS = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/fermi_ci?schema=public",
  JWT_SECRET: "test-jwt-secret-for-ci-only-0000000000000000",
  PLATFORM_JWT_SECRET: "test-platform-jwt-secret-for-ci-only-000000000000000000000000000000000000000000",
  PLATFORM_ADMIN_EMAIL: "ci-admin@example.local",
  PLATFORM_ADMIN_PASSWORD: "ci-platform-admin-password-0000"
} as const;

const withTestDefault = (name: keyof typeof TEST_DEFAULTS) => process.env[name] ?? (isCiOrTest ? TEST_DEFAULTS[name] : undefined);

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const optionalString = z.preprocess(emptyToUndefined, z.string().trim().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().trim().url().optional());
const optionalEmail = z.preprocess(emptyToUndefined, z.string().trim().email().optional());

const intFromString = (fallback: number, name: string) =>
  z.preprocess(
    (value) => emptyToUndefined(value) ?? String(fallback),
    z.coerce.number({ invalid_type_error: `${name} must be a number` }).int().nonnegative()
  );

const boolFromString = (fallback: boolean) =>
  z.preprocess((value) => {
    const normalized = String(emptyToUndefined(value) ?? fallback).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return value;
  }, z.boolean());

const csvList = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  z.array(z.string())
);

const trustProxySchema = z.preprocess((value) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || ["0", "false", "no", "off"].includes(raw.toLowerCase())) return false;
  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) return 1;
  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
  return raw;
}, z.union([z.boolean(), z.number().int().nonnegative(), z.string()]));

const jwtExpirySchema = z.string().trim().min(1).regex(/^\d+[smhd]$/, "Use a compact duration such as 15m, 1h, 7d");
const cronSchema = z.string().trim().min(5);
const jsonObjectStringSchema = z.string().trim().refine((value) => {
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}, "Must be a valid JSON object string");

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: intFromString(4000, "PORT"),
  PLATFORM_PORT: intFromString(4100, "PLATFORM_PORT"),
  PLATFORM_BIND_HOST: z.string().trim().default("127.0.0.1"),
  TRUST_PROXY: trustProxySchema.default(false),
  SHUTDOWN_GRACE_MS: intFromString(15000, "SHUTDOWN_GRACE_MS"),

  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required" })
    .trim()
    .regex(/^postgres(?:ql)?:\/\//, "DATABASE_URL must be a PostgreSQL Prisma URL"),

  JWT_SECRET: z.string({ required_error: "JWT_SECRET is required" }).min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: jwtExpirySchema.default("1d"),
  REFRESH_TOKEN_EXPIRES_IN: jwtExpirySchema.default("30d"),

  PLATFORM_JWT_SECRET: z
    .string({ required_error: "PLATFORM_JWT_SECRET is required" })
    .min(64, "PLATFORM_JWT_SECRET must be at least 64 characters"),
  PLATFORM_JWT_EXPIRES_IN: jwtExpirySchema.default("15m"),

  APP_URL: z.string().trim().url().default("http://localhost:5173"),
  FRONTEND_URL: z.string().trim().url().optional(),
  API_URL: z.string().trim().url().optional(),
  BACKEND_PUBLIC_URL: z.string().trim().url().default("http://127.0.0.1:4000"),
  CORS_ORIGIN: z.string().trim().default("http://localhost:5173"),
  PLATFORM_CORS_ORIGIN: z.string().trim().default("http://localhost:5174"),
  OAUTH_CALLBACK_URL: optionalUrl,

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: optionalUrl,
  GOOGLE_WORKSPACE_REDIRECT_URI: optionalUrl,
  APPLE_CLIENT_ID: optionalString,
  APPLE_TEAM_ID: optionalString,
  APPLE_KEY_ID: optionalString,
  APPLE_PRIVATE_KEY: optionalString,
  APPLE_REDIRECT_URI: optionalUrl,

  UPLOAD_DIR: z.string().trim().default("uploads"),
  MAX_FILE_SIZE_BYTES: intFromString(10485760, "MAX_FILE_SIZE_BYTES"),
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: optionalUrl,
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_REGION: optionalString,
  S3_PUBLIC_BASE_URL: optionalUrl,

  PRIVACY_RETENTION_CRON_ENABLED: boolFromString(false),
  PRIVACY_RETENTION_CRON_SCHEDULE: cronSchema.default("30 3 * * *"),
  CRON_REMINDER_SCHEDULE: cronSchema.default("*/10 * * * *"),
  SLA_PRIORITY_THRESHOLDS: jsonObjectStringSchema.default('{"LOW":15,"MEDIUM":10,"HIGH":5,"CRITICAL":2}'),

  EMAIL_PROVIDER: z.enum(["smtp", "resend"]).default("smtp"),
  SMTP_HOST: optionalString,
  SMTP_PORT: intFromString(465, "SMTP_PORT"),
  SMTP_SECURE: boolFromString(true),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_FROM: optionalString,
  RESEND_API_KEY: optionalString,
  RESEND_FROM: optionalString,
  DEMO_LEAD_RECIPIENT_EMAIL: optionalEmail,

  PLATFORM_ADMIN_EMAIL: z.string({ required_error: "PLATFORM_ADMIN_EMAIL is required" }).trim().email(),
  PLATFORM_ADMIN_PASSWORD: z
    .string({ required_error: "PLATFORM_ADMIN_PASSWORD is required" })
    .min(20, "PLATFORM_ADMIN_PASSWORD must be at least 20 characters"),
  PLATFORM_ADMIN_OTP: optionalString,
  PLATFORM_OTP_SECRET: optionalString,
  PLATFORM_OTP_EXPIRES_MINUTES: intFromString(10, "PLATFORM_OTP_EXPIRES_MINUTES"),
  PLATFORM_ALLOWED_IPS: z.string().trim().default(""),
  PLATFORM_ALERT_EMAILS: csvList.default([]),
  PLATFORM_LOGIN_MAX_ATTEMPTS: intFromString(5, "PLATFORM_LOGIN_MAX_ATTEMPTS"),
  PLATFORM_LOGIN_WINDOW_MS: intFromString(900000, "PLATFORM_LOGIN_WINDOW_MS"),
  PLATFORM_LOGIN_LOCK_MS: intFromString(1800000, "PLATFORM_LOGIN_LOCK_MS"),

  BILLING_TRIAL_DAYS: intFromString(14, "BILLING_TRIAL_DAYS"),
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_PRICE_STARTER_MONTHLY: optionalString,
  STRIPE_PRICE_STARTER_YEARLY: optionalString,
  STRIPE_PRICE_PRO_MONTHLY: optionalString,
  STRIPE_PRICE_PRO_YEARLY: optionalString,
  STRIPE_PRICE_ENTERPRISE_MONTHLY: optionalString,
  STRIPE_PRICE_ENTERPRISE_YEARLY: optionalString,
  STRIPE_PRICE_ID: optionalString,

  FLEETUM_BILLING_LEGAL_NAME: optionalString,
  FLEETUM_BILLING_VAT: optionalString,
  FLEETUM_BILLING_ADDRESS: optionalString,
  FLEETUM_BILLING_EMAIL: optionalEmail,
  FLEETUM_BILLING_PEC: optionalString,
  FLEETUM_BILLING_SDI: optionalString,
  FLEETUM_BILLING_IBAN: optionalString
});

const envSchema = baseEnvSchema
  .superRefine((value, ctx) => {
    if (value.JWT_SECRET === value.PLATFORM_JWT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PLATFORM_JWT_SECRET"],
        message: "PLATFORM_JWT_SECRET must be different from JWT_SECRET"
      });
    }

    if (!isCiOrTest && value.EMAIL_PROVIDER === "smtp") {
      for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const) {
        if (!value[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when EMAIL_PROVIDER=smtp` });
        }
      }
    }

    if (!isCiOrTest && value.EMAIL_PROVIDER === "resend") {
      for (const key of ["RESEND_API_KEY", "RESEND_FROM"] as const) {
        if (!value[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when EMAIL_PROVIDER=resend` });
        }
      }
    }

    if (!isCiOrTest && value.STORAGE_PROVIDER === "s3") {
      for (const key of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_REGION"] as const) {
        if (!value[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when STORAGE_PROVIDER=s3` });
        }
      }
    }
  })
  .transform((value) => ({
    ...value,
    FRONTEND_URL: value.FRONTEND_URL ?? value.APP_URL,
    API_URL: value.API_URL ?? value.BACKEND_PUBLIC_URL,
    OAUTH_CALLBACK_URL: value.OAUTH_CALLBACK_URL ?? `${value.APP_URL}/auth/social-callback`,
    GOOGLE_REDIRECT_URI: value.GOOGLE_REDIRECT_URI ?? `${value.BACKEND_PUBLIC_URL}/api/auth/google/callback`,
    GOOGLE_WORKSPACE_REDIRECT_URI:
      value.GOOGLE_WORKSPACE_REDIRECT_URI ?? `${value.BACKEND_PUBLIC_URL}/api/calendar/google/callback`,
    APPLE_REDIRECT_URI: value.APPLE_REDIRECT_URI ?? `${value.BACKEND_PUBLIC_URL}/api/auth/apple/callback`,
    SMTP_FROM: value.SMTP_FROM ?? "",
    RESEND_FROM: value.RESEND_FROM ?? value.SMTP_FROM ?? "Fleetum <onboarding@resend.dev>",
    PLATFORM_ALLOWED_IPS_CSV: value.PLATFORM_ALLOWED_IPS
  }));

const rawEnv = {
  ...process.env,
  DATABASE_URL: withTestDefault("DATABASE_URL"),
  JWT_SECRET: withTestDefault("JWT_SECRET"),
  PLATFORM_JWT_SECRET: withTestDefault("PLATFORM_JWT_SECRET"),
  PLATFORM_ADMIN_EMAIL: withTestDefault("PLATFORM_ADMIN_EMAIL"),
  PLATFORM_ADMIN_PASSWORD: withTestDefault("PLATFORM_ADMIN_PASSWORD")
};

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => {
      const path = issue.path.join(".") || "env";
      return `- ${path}: ${issue.message}`;
    })
    .join("\n");

  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;
export type Env = typeof env;
