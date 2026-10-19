import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { resolveFleetumEnvironment, resolveEmailProvider } from "../src/shared/config/staging-safety.js";
import { startAutomaticCronTasks } from "../src/infrastructure/cron/cron-bootstrap.js";
import { createEmailSender } from "../src/infrastructure/email/email-sender.js";
import { assertProviderQaIsolation } from "../src/shared/config/provider-qa-safety.js";
import type { StagingIsolationConfig } from "../src/shared/config/staging-safety.js";

test("provider QA is an explicit environment, with outbound email disabled", () => {
  assert.equal(resolveFleetumEnvironment("provider-qa"), "provider-qa");
  assert.equal(resolveEmailProvider("provider-qa" as any), "disabled");
  assert.throws(() => resolveEmailProvider("provider-qa" as any, "resend"));
});

test("provider QA cannot start any automatic worker", () => {
  let calls = 0;
  const starter = () => { calls += 1; return { stop() {} }; };
  assert.deepEqual(startAutomaticCronTasks("provider-qa" as any, {
    reminder: starter, emailQueue: starter, reports: starter,
    privacyRetention: starter, billingDunning: starter
  }), []);
  assert.equal(calls, 0);
});

test("provider QA denies email even with a mismatched sender configuration", async () => {
  let constructed = 0;
  const sender = createEmailSender({ environment: "provider-qa" as any, provider: "resend",
    resendApiKey: "synthetic-not-a-real-provider-key", resendFrom: "sender@example.invalid" },
  () => { constructed += 1; throw new Error("SDK must never be constructed"); });
  await assert.rejects(sender.send({ to: "recipient@example.invalid", subject: "Fixture", text: "Fixture" }),
    (error: any) => error.code === "PROVIDER_QA_EMAIL_DISABLED");
  assert.equal(constructed, 0);
});

const qaEnvironment = () => ({
  PATH: process.env.PATH ?? "", NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null",
  FLEETUM_ENVIRONMENT: "provider-qa", FLEETUM_PROVIDER_QA_MODE: "offline",
  FLEETUM_PROVIDER_QA_RUN_ID: "testabcd00000001",
  APP_URL: "http://localhost:5273", CORS_ORIGIN: "http://localhost:5273",
  BACKEND_PUBLIC_URL: "http://localhost:4200", PLATFORM_CORS_ORIGIN: "http://localhost:5274",
  PORT: "4200", PLATFORM_PORT: "4300", PLATFORM_BIND_HOST: "127.0.0.1", TRUST_PROXY: "false",
  DATABASE_URL: "postgresql://fleetum_provider_qa:syntheticpassword000@127.0.0.1:35431/fleetum_provider_qa?schema=public",
  UPLOAD_DIR: `${process.platform === "darwin" ? "/private/tmp" : "/tmp"}/fleetum-provider-qa-testabcd00000001/uploads`,
  EMAIL_PROVIDER: "disabled", STORAGE_PROVIDER: "local",
  PRIVACY_RETENTION_CRON_ENABLED: "false", PRIVACY_RETENTION_GLOBAL_ENABLED: "false",
  BILLING_DUNNING_CRON_ENABLED: "false"
});

const config = (rawEnv: Record<string, string | undefined> = qaEnvironment()): StagingIsolationConfig => ({
  environment: "provider-qa", appUrl: rawEnv.APP_URL!, backendPublicUrl: rawEnv.BACKEND_PUBLIC_URL!,
  corsOrigin: rawEnv.CORS_ORIGIN!, platformCorsOrigin: rawEnv.PLATFORM_CORS_ORIGIN!,
  databaseUrl: rawEnv.DATABASE_URL!, emailProvider: rawEnv.EMAIL_PROVIDER as "disabled",
  storageProvider: rawEnv.STORAGE_PROVIDER!,
  privacyRetentionCronEnabled: rawEnv.PRIVACY_RETENTION_CRON_ENABLED === "true",
  privacyRetentionGlobalEnabled: rawEnv.PRIVACY_RETENTION_GLOBAL_ENABLED === "true",
  billingDunningCronEnabled: rawEnv.BILLING_DUNNING_CRON_ENABLED === "true", rawEnv
});

test("provider QA rejects production targets, reused storage and unsafe background activity", async t => {
  const cases: Array<[string, string, string]> = [
    ["NODE_ENV", "production", "NODE_ENV"], ["DOTENV_CONFIG_PATH", "/opt/fleetum/.env", "DOTENV"],
    ["APP_URL", "https://fleetum.it", "APP_URL"],
    ["BACKEND_PUBLIC_URL", "https://api-staging.fleetum.it", "BACKEND_PUBLIC_URL"],
    ["CORS_ORIGIN", "http://localhost:5273,https://fleetum.it", "CORS_ORIGIN"],
    ["PLATFORM_CORS_ORIGIN", "https://platform.fleetum.it", "PLATFORM_CORS_ORIGIN"],
    ["DATABASE_URL", "postgresql://fleetum_provider_qa:sentinelpassword000@57.131.47.124:5432/fleetum_provider_qa", "DATABASE_URL"],
    ["DATABASE_URL", "postgresql://fleetum_staging:sentinelpassword000@127.0.0.1:35431/fleetum_staging", "DATABASE_URL"],
    ["DATABASE_URL", "postgresql://fleetum_provider_qa:sentinelpassword000@127.0.0.1:35431/fleetum_provider_qa?options=unsafe", "DATABASE_URL"],
    ["UPLOAD_DIR", "/opt/fleetum-staging/uploads", "UPLOAD_DIR"],
    ["FLEETUM_PROVIDER_QA_RUN_ID", "../escape", "RUN_ID"],
    ["PORT", "4000", "PORTS"], ["PLATFORM_BIND_HOST", "0.0.0.0", "BINDING"],
    ["TRUST_PROXY", "true", "BINDING"], ["EMAIL_PROVIDER", "resend", "EMAIL_PROVIDER"],
    ["STORAGE_PROVIDER", "s3", "STORAGE_PROVIDER"],
    ["PRIVACY_RETENTION_CRON_ENABLED", "true", "AUTOMATIC_JOBS"],
    ["PRIVACY_RETENTION_GLOBAL_ENABLED", "true", "AUTOMATIC_JOBS"],
    ["BILLING_DUNNING_CRON_ENABLED", "true", "AUTOMATIC_JOBS"],
    ["RESEND_API_KEY", "sentinel-secret-not-for-logs", "FORBIDDEN_PROVIDER"],
    ["APPLE_PRIVATE_KEY", "sentinel-secret-not-for-logs", "FORBIDDEN_PROVIDER"],
    ["S3_SECRET_ACCESS_KEY", "sentinel-secret-not-for-logs", "FORBIDDEN_PROVIDER"],
    ["STRIPE_SECRET_KEY", "sentinel-secret-not-for-logs", "STRIPE_DISABLED"],
    ["GOOGLE_CLIENT_SECRET", "sentinel-secret-not-for-logs", "GOOGLE_DISABLED"],
    ["FLEETUM_PROVIDER_QA_MODE", "production", "MODE"]
  ];
  for (const [field, value, expected] of cases) await t.test(`${field}: ${expected}`, () => {
    assert.throws(() => assertProviderQaIsolation(config({ ...qaEnvironment(), [field]: value })), error => {
      assert.match((error as Error).message, new RegExp(expected));
      assert(!String(error).includes("sentinel"));
      return true;
    });
  });
});

test("only test Stripe keys and the declared Google client can enter their selected mode", () => {
  const stripe = { ...qaEnvironment(), FLEETUM_PROVIDER_QA_MODE: "stripe",
    STRIPE_SECRET_KEY: ["sk", "test", "s".repeat(32)].join("_"),
    STRIPE_WEBHOOK_SECRET: ["whsec", "s".repeat(32)].join("_"),
    FLEETUM_PROVIDER_QA_STRIPE_ACCOUNT_ID: "acct_synthetic000" };
  assert.doesNotThrow(() => assertProviderQaIsolation(config(stripe)));
  assert.throws(() => assertProviderQaIsolation(config({ ...stripe,
    STRIPE_SECRET_KEY: ["sk", "live", "sentinel".repeat(4)].join("_") })), /STRIPE_SECRET_KEY/);
  assert.throws(() => assertProviderQaIsolation(config({ ...stripe,
    STRIPE_PORTAL_RETURN_URL: "https://fleetum.it/billing" })), /STRIPE_PORTAL_RETURN_URL/);
  const google = { ...qaEnvironment(), FLEETUM_PROVIDER_QA_MODE: "google",
    GOOGLE_CLIENT_ID: "123456-synthetic.apps.googleusercontent.com",
    FLEETUM_PROVIDER_QA_GOOGLE_CLIENT_ID: "123456-synthetic.apps.googleusercontent.com",
    FLEETUM_PROVIDER_QA_GOOGLE_PROJECT_ID: "fleetum-provider-qa-fixture",
    GOOGLE_CLIENT_SECRET: "synthetic-not-a-real-google-secret",
    GOOGLE_REDIRECT_URI: "http://localhost:4200/api/auth/google/callback" };
  assert.doesNotThrow(() => assertProviderQaIsolation(config(google)));
  assert.throws(() => assertProviderQaIsolation(config({ ...google,
    FLEETUM_PROVIDER_QA_GOOGLE_CLIENT_ID: "other-client" })), /GOOGLE_CLIENT_BINDING/);
  assert.throws(() => assertProviderQaIsolation(config({ ...google,
    GOOGLE_REDIRECT_URI: "https://api.fleetum.it/api/auth/google/callback" })), /GOOGLE_REDIRECT_URI/);
});

test("provider QA loads its own configuration without requiring email credentials", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    'const {env}=await import("./src/shared/config/env.ts");console.log(JSON.stringify({environment:env.FLEETUM_ENVIRONMENT,email:env.EMAIL_PROVIDER}));'],
  { cwd: process.cwd(), env: qaEnvironment(), encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { environment: "provider-qa", email: "disabled" });
});
