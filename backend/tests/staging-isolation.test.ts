import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  assertStagingIsolation,
  environmentDefaults,
  resolveEmailProvider,
  resolveFleetumEnvironment,
  STAGING_CANONICAL
} from "../src/shared/config/staging-safety.js";
import { startAutomaticCronTasks, stopAutomaticCronTasks } from "../src/infrastructure/cron/cron-bootstrap.js";
import { createEmailSender } from "../src/infrastructure/email/email-sender.js";

const stagingConfig = (overrides: Record<string, unknown> = {}) => ({
  environment: "staging" as const,
  appUrl: STAGING_CANONICAL.appUrl,
  backendPublicUrl: STAGING_CANONICAL.backendPublicUrl,
  corsOrigin: STAGING_CANONICAL.corsOrigin,
  platformCorsOrigin: STAGING_CANONICAL.platformCorsOrigin,
  databaseUrl: "postgresql://fleetum_staging:synthetic-password@postgres:5432/fleetum_staging?schema=public",
  emailProvider: "disabled" as const,
  storageProvider: "local",
  privacyRetentionCronEnabled: false,
  privacyRetentionGlobalEnabled: false,
  billingDunningCronEnabled: false,
  rawEnv: {},
  ...overrides
});

test("staging-specific defaults are fail-closed while production defaults stay unchanged", () => {
  assert.equal(resolveFleetumEnvironment(undefined), "production");
  assert.equal(resolveFleetumEnvironment("staging"), "staging");
  assert.throws(() => resolveFleetumEnvironment("preview"), /FLEETUM_ENVIRONMENT/);

  assert.deepEqual(environmentDefaults("production"), {
    emailProvider: "resend",
    privacyRetentionCronEnabled: false,
    billingDunningCronEnabled: true
  });
  assert.deepEqual(environmentDefaults("staging"), {
    emailProvider: "disabled",
    privacyRetentionCronEnabled: false,
    billingDunningCronEnabled: false
  });
  assert.equal(resolveEmailProvider("production", undefined), "resend");
  assert.equal(resolveEmailProvider("staging", undefined), "disabled");
  assert.throws(() => resolveEmailProvider("production", "disabled"), /staging/);
  assert.throws(() => resolveEmailProvider("staging", "resend"), /disabled/);
});

test("staging accepts only canonical local and provider-free configuration", () => {
  assert.doesNotThrow(() => assertStagingIsolation(stagingConfig()));

  const invalidCases: Array<[string, Record<string, unknown>]> = [
    ["APP_URL", { appUrl: "https://fleetum.it" }],
    ["BACKEND_PUBLIC_URL", { backendPublicUrl: "https://api.fleetum.it" }],
    ["CORS_ORIGIN", { corsOrigin: "https://staging.fleetum.it,https://fleetum.it" }],
    ["PLATFORM_CORS_ORIGIN", { platformCorsOrigin: "https://platform.fleetum.it" }],
    ["EMAIL_PROVIDER", { emailProvider: "resend" }],
    ["STORAGE_PROVIDER", { storageProvider: "s3" }],
    ["PRIVACY_RETENTION_CRON_ENABLED", { privacyRetentionCronEnabled: true }],
    ["PRIVACY_RETENTION_GLOBAL_ENABLED", { privacyRetentionGlobalEnabled: true }],
    ["BILLING_DUNNING_CRON_ENABLED", { billingDunningCronEnabled: true }]
  ];

  for (const [name, overrides] of invalidCases) {
    assert.throws(() => assertStagingIsolation(stagingConfig(overrides)), new RegExp(name));
  }

  const syntheticSecret = "synthetic-provider-credential-never-print";
  for (const name of [
    "RESEND_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "GOOGLE_CLIENT_SECRET",
    "APPLE_PRIVATE_KEY",
    "S3_SECRET_ACCESS_KEY"
  ]) {
    assert.throws(
      () => assertStagingIsolation(stagingConfig({ rawEnv: { [name]: syntheticSecret } })),
      (error: any) => {
        assert.match(error.message, new RegExp(name));
        assert.equal(error.message.includes(syntheticSecret), false);
        return true;
      }
    );
  }
});

test("staging database guard accepts only the dedicated Compose PostgreSQL database", () => {
  const invalidUrls = [
    "mysql://fleetum_staging:synthetic@postgres/fleetum_staging",
    "postgresql://fleetum_staging:synthetic@localhost:5432/fleetum_staging?schema=public",
    "postgresql://fleetum_staging:synthetic@postgres:5433/fleetum_staging?schema=public",
    "postgresql://fleetum:synthetic@postgres:5432/fleetum_staging?schema=public",
    "postgresql://fleetum_staging:synthetic@postgres:5432/fleetum?schema=public",
    "postgresql://fleetum_staging@postgres:5432/fleetum_staging?schema=public",
    "postgresql://fleetum_staging:synthetic@postgres:5432/fleetum_staging?schema=other",
    "postgresql://fleetum_staging:synthetic@postgres:5432/fleetum_staging?schema=public&sslmode=require",
    "postgresql://fleetum_staging:synthetic@postgres:5432/fleetum_staging?schema=public#fragment"
  ];

  for (const databaseUrl of invalidUrls) {
    assert.throws(() => assertStagingIsolation(stagingConfig({ databaseUrl })), /DATABASE_URL/);
  }
  assert.doesNotThrow(() =>
    assertStagingIsolation(
      stagingConfig({ databaseUrl: "postgres://fleetum_staging:synthetic@postgres/fleetum_staging" })
    )
  );
});

test("staging email fails before constructing or calling the provider SDK", async () => {
  let sdkConstructed = 0;
  let sdkCalls = 0;
  const sender = createEmailSender(
    {
      environment: "staging",
      provider: "disabled",
      resendApiKey: undefined,
      resendFrom: undefined
    },
    () => {
      sdkConstructed += 1;
      return {
        emails: {
          send: async () => {
            sdkCalls += 1;
            return { data: { id: "must-not-exist" }, error: null };
          }
        }
      } as any;
    }
  );

  await assert.rejects(
    sender.send({
      to: "synthetic@example.invalid",
      subject: "Synthetic staging email",
      text: "Synthetic body"
    }),
    (error: any) => error?.statusCode === 503 && error?.code === "STAGING_EMAIL_DISABLED"
  );
  assert.equal(sdkConstructed, 0);
  assert.equal(sdkCalls, 0);
});

test("production email still calls Resend and returns the provider id", async () => {
  let sdkCalls = 0;
  const sender = createEmailSender(
    {
      environment: "production",
      provider: "resend",
      resendApiKey: "synthetic-resend-key",
      resendFrom: "Fleetum <sender@example.invalid>"
    },
    () => ({
      emails: {
        send: async (payload: any, options: any) => {
          sdkCalls += 1;
          assert.equal(payload.to[0], "recipient@example.invalid");
          assert.equal(options.idempotencyKey, "synthetic-idempotency-key");
          return { data: { id: "synthetic-provider-id" }, error: null };
        }
      }
    } as any)
  );

  const result = await sender.send({
    to: "recipient@example.invalid",
    subject: "Synthetic production email",
    text: "Synthetic body",
    idempotencyKey: "synthetic-idempotency-key"
  });
  assert.deepEqual(result, { provider: "resend", id: "synthetic-provider-id" });
  assert.equal(sdkCalls, 1);
});

test("automatic cron bootstrap starts five tasks in production and none in staging", () => {
  const starts: string[] = [];
  const stops: string[] = [];
  const starter = (name: string) => () => {
    starts.push(name);
    return { stop: () => stops.push(name) };
  };
  const starters = {
    reminder: starter("reminder"),
    emailQueue: starter("emailQueue"),
    reports: starter("reports"),
    privacyRetention: starter("privacyRetention"),
    billingDunning: starter("billingDunning")
  };

  const stagingTasks = startAutomaticCronTasks("staging", starters);
  assert.deepEqual(stagingTasks, []);
  assert.deepEqual(starts, []);

  const productionTasks = startAutomaticCronTasks("production", starters);
  assert.equal(productionTasks.length, 5);
  assert.deepEqual(starts, ["reminder", "emailQueue", "reports", "privacyRetention", "billingDunning"]);
  stopAutomaticCronTasks(productionTasks);
  assert.deepEqual(stops, starts);
});

test("env integration loads staging without provider keys and rejects secret-bearing staging", () => {
  const baseEnv = {
    PATH: process.env.PATH ?? "",
    NODE_ENV: "test",
    DOTENV_CONFIG_PATH: "/dev/null",
    FLEETUM_ENVIRONMENT: "staging",
    APP_URL: STAGING_CANONICAL.appUrl,
    BACKEND_PUBLIC_URL: STAGING_CANONICAL.backendPublicUrl,
    CORS_ORIGIN: STAGING_CANONICAL.corsOrigin,
    PLATFORM_CORS_ORIGIN: STAGING_CANONICAL.platformCorsOrigin,
    DATABASE_URL: "postgresql://fleetum_staging:synthetic-password@postgres:5432/fleetum_staging?schema=public",
    EMAIL_PROVIDER: "disabled",
    STORAGE_PROVIDER: "local"
  };
  const script =
    'const { env } = await import("./src/shared/config/env.ts"); process.stdout.write(JSON.stringify({ environment: env.FLEETUM_ENVIRONMENT, provider: env.EMAIL_PROVIDER, retention: env.PRIVACY_RETENTION_CRON_ENABLED, globalRetention: env.PRIVACY_RETENTION_GLOBAL_ENABLED, dunning: env.BILLING_DUNNING_CRON_ENABLED }));';
  const accepted = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: baseEnv,
    encoding: "utf8"
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(JSON.parse(accepted.stdout), {
    environment: "staging",
    provider: "disabled",
    retention: false,
    globalRetention: false,
    dunning: false
  });

  const rejectedGlobalRetention = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: process.cwd(),
      env: { ...baseEnv, PRIVACY_RETENTION_GLOBAL_ENABLED: "true" },
      encoding: "utf8"
    }
  );
  assert.notEqual(rejectedGlobalRetention.status, 0);
  assert.match(rejectedGlobalRetention.stderr, /PRIVACY_RETENTION_GLOBAL_ENABLED/);

  const syntheticSecret = "synthetic-secret-must-not-be-printed";
  const rejected = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...baseEnv, STRIPE_SECRET_KEY: syntheticSecret },
    encoding: "utf8"
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /STRIPE_SECRET_KEY/);
  assert.equal(rejected.stderr.includes(syntheticSecret), false);
  assert.equal(rejected.stdout.includes(syntheticSecret), false);

  const databaseMarker = "synthetic-database-password-must-not-be-printed";
  const rejectedDatabase = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: process.cwd(),
      env: {
        ...baseEnv,
        DATABASE_URL: `postgresql://fleetum_staging:${databaseMarker}@production-db.invalid/fleetum_staging?schema=public`
      },
      encoding: "utf8"
    }
  );
  assert.notEqual(rejectedDatabase.status, 0);
  assert.match(rejectedDatabase.stderr, /DATABASE_URL/);
  assert.equal(rejectedDatabase.stderr.includes(databaseMarker), false);
  assert.equal(rejectedDatabase.stdout.includes(databaseMarker), false);
});
