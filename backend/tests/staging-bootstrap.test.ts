import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  assertStagingBootstrapEnvironment,
  parseStagingBootstrapCredentials,
  runStagingBootstrap,
  StagingBootstrapError,
  STAGING_BOOTSTRAP_MIGRATION_PERMISSIONS
} from "../src/scripts/staging-bootstrap-policy.js";

const environment = () => ({
  NODE_ENV: "production",
  FLEETUM_ENVIRONMENT: "staging",
  DATABASE_URL: "postgresql://fleetum_staging:synthetic-fixture@postgres:5432/fleetum_staging?schema=public",
  APP_URL: "https://staging.fleetum.it",
  BACKEND_PUBLIC_URL: "https://api-staging.fleetum.it",
  CORS_ORIGIN: "https://staging.fleetum.it",
  PLATFORM_CORS_ORIGIN: "https://platform-staging.fleetum.it",
  EMAIL_PROVIDER: "disabled",
  STORAGE_PROVIDER: "local",
  PRIVACY_RETENTION_CRON_ENABLED: "false",
  PRIVACY_RETENTION_GLOBAL_ENABLED: "false",
  BILLING_DUNNING_CRON_ENABLED: "false"
});
const credentials = () => ({ tenantA: "Synthetic test fixture A 2026", tenantB: "Synthetic test fixture B 2026" });

const runCli = (input: string, raw = environment(), args: string[] = []) => spawnSync(process.execPath,
  ["--import", "tsx", fileURLToPath(new URL("../src/scripts/staging-bootstrap.ts", import.meta.url)), ...args],
  { input, encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, DOTENV_CONFIG_PATH: "/dev/null", ...raw } });

test("existing demo seed cannot prepare production-mode staging or two operational tenants", async () => {
  const source = await readFile(new URL("../prisma/seed.ts", import.meta.url), "utf8");
  assert.match(source, /process\.env\.NODE_ENV === "production"/);
  assert.match(source, /id: "demo_tenant"/);
  assert.doesNotMatch(source, /tenantSubscription\.(create|upsert)/);
  const signup = await readFile(new URL("../src/application/usecases/auth/signup-usecase.ts", import.meta.url), "utf8");
  assert.match(signup, /status: "PENDING"/);
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../prisma/seed.ts", import.meta.url))], {
    encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, DOTENV_CONFIG_PATH: "/dev/null", ...environment() }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Seed demo disabilitato in produzione/);
});

test("CLI rejects production before input or a database connection", () => {
  const result = runCli(JSON.stringify(credentials()), { ...environment(), FLEETUM_ENVIRONMENT: "production" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "STAGING_BOOTSTRAP_ENVIRONMENT_REFUSED\n");
});

test("CLI rejects passwords or tokens passed as arguments without echoing them", () => {
  const result = runCli("", environment(), [credentials().tenantA]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "STAGING_BOOTSTRAP_INPUT_REFUSED\n");
});

test("CLI rejects oversized stdin before contacting PostgreSQL", () => {
  const result = runCli(" ".repeat(8193));
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "STAGING_BOOTSTRAP_INPUT_REFUSED\n");
});

test("invalid credentials refuse before client construction", async () => {
  let constructions = 0;
  await assert.rejects(runStagingBootstrap(environment(), { ...credentials(), tenantA: "short" }, () => {
    constructions += 1;
    throw new Error("client must not be constructed");
  }), StagingBootstrapError);
  assert.equal(constructions, 0);
});

test("connection factory failures expose only a stable error code", async () => {
  await assert.rejects(runStagingBootstrap(environment(), credentials(), () => {
    throw new Error("postgresql://synthetic confidential credentials and SQL values");
  }), (error) => {
    assert.ok(error instanceof StagingBootstrapError);
    assert.equal(error.message, "STAGING_BOOTSTRAP_DATABASE_FAILED");
    return true;
  });
});

test("bootstrap accepts only the complete canonical staging baseline", () => {
  assert.doesNotThrow(() => assertStagingBootstrapEnvironment(environment()));
});

test("the accepted preexisting catalog comes from the exact two permission migrations", async () => {
  const migrations = await Promise.all([
    readFile(new URL("../prisma/migrations/20260620090000_sensitive_permission_boundaries/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20260702143000_rental_payment_permissions/migration.sql", import.meta.url), "utf8")
  ]);
  const catalog = migrations.flatMap((source) => Array.from(source.matchAll(/\('perm_' \|\| md5\('([^']+)'\), '([^']+)', '([^']+)'/g))
    .map((match) => ({ key: match[1], description: match[3] })));
  assert.equal(catalog.length, 10);
  assert.deepEqual(STAGING_BOOTSTRAP_MIGRATION_PERMISSIONS.map(({ key, description }) => ({ key, description })), catalog);
  assert.ok(Object.isFrozen(STAGING_BOOTSTRAP_MIGRATION_PERMISSIONS));
});

for (const key of Object.keys(environment()) as Array<keyof ReturnType<typeof environment>>) {
  test(`missing ${key} refuses before client construction`, async () => {
    const raw: Record<string, string> = environment();
    delete raw[key];
    let constructions = 0;
    await assert.rejects(runStagingBootstrap(raw, credentials(), () => {
      constructions += 1;
      throw new Error("client should never be created");
    }), StagingBootstrapError);
    assert.equal(constructions, 0);
  });
}

for (const [key, value] of [
  ["FLEETUM_ENVIRONMENT", "production"], ["NODE_ENV", "test"], ["NODE_ENV", "development"],
  ["EMAIL_PROVIDER", "resend"], ["STORAGE_PROVIDER", "s3"],
  ["PRIVACY_RETENTION_CRON_ENABLED", "true"], ["PRIVACY_RETENTION_GLOBAL_ENABLED", "true"],
  ["BILLING_DUNNING_CRON_ENABLED", "true"], ["BILLING_DUNNING_CRON_ENABLED", "garbage"],
  ["APP_URL", "https://fleetum.it"], ["CORS_ORIGIN", "https://fleetum.it"],
  ["PLATFORM_CORS_ORIGIN", "https://platform.fleetum.it"], ["BACKEND_PUBLIC_URL", "https://api.fleetum.it"]
] as const) {
  test(`unsafe ${key} refuses`, () => {
    assert.throws(() => assertStagingBootstrapEnvironment({ ...environment(), [key]: value }), StagingBootstrapError);
  });
}

for (const databaseUrl of [
  "postgresql://fleetum_staging:synthetic-fixture@127.0.0.1:5432/fleetum_staging",
  "postgresql://fleetum_staging:synthetic-fixture@postgres:5432/fleetum",
  "postgresql://fleetum:synthetic-fixture@postgres:5432/fleetum_staging",
  "postgresql://fleetum_staging:synthetic-fixture@postgres:5433/fleetum_staging",
  "postgresql://fleetum_staging@postgres:5432/fleetum_staging",
  "postgresql://fleetum_staging:synthetic-fixture@postgres:5432/fleetum_staging?options=unsafe",
  "postgresql://fleetum_staging:synthetic-fixture@postgres:5432/fleetum_staging#other",
  "invalid database including confidential text"
]) {
  test("noncanonical database refuses without disclosing its value", () => {
    assert.throws(() => assertStagingBootstrapEnvironment({ ...environment(), DATABASE_URL: databaseUrl }), (error) => {
      assert.ok(error instanceof StagingBootstrapError);
      assert.equal(error.message.includes(databaseUrl), false);
      assert.equal(error.message.includes("synthetic-fixture"), false);
      return true;
    });
  });
}

for (const key of [
  "RESEND_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY", "S3_ENDPOINT", "S3_BUCKET",
  "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_REGION", "S3_PUBLIC_BASE_URL"
]) {
  test(`provider configuration ${key} refuses without disclosure`, () => {
    assert.throws(() => assertStagingBootstrapEnvironment({ ...environment(), [key]: "synthetic confidential provider fixture" }), (error) => {
      assert.ok(error instanceof StagingBootstrapError);
      assert.equal(error.message.includes("synthetic confidential"), false);
      return true;
    });
  });
}

test("credentials accept exactly two distinct strong inputs", () => {
  const parsed = parseStagingBootstrapCredentials(JSON.stringify(credentials()));
  assert.ok(parsed.tenantA === credentials().tenantA && parsed.tenantB === credentials().tenantB);
});

for (const input of ["null", "[]", "{}", "not JSON", JSON.stringify({ ...credentials(), extra: "unexpected" }),
  JSON.stringify({ tenantA: "short", tenantB: credentials().tenantB }),
  JSON.stringify({ tenantA: credentials().tenantA, tenantB: credentials().tenantA }),
  JSON.stringify({ tenantA: "界".repeat(30), tenantB: credentials().tenantB }),
  JSON.stringify({ tenantA: "x".repeat(73), tenantB: credentials().tenantB }),
  JSON.stringify({ tenantA: "\u0000" + credentials().tenantA, tenantB: credentials().tenantB }),
  " ".repeat(8193)
]) {
  test("invalid credential payload is refused without disclosure", () => {
    assert.throws(() => parseStagingBootstrapCredentials(input), (error) => {
      assert.ok(error instanceof StagingBootstrapError);
      assert.equal(error.message.includes(credentials().tenantA), false);
      return true;
    });
  });
}
