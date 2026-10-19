import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { GOOGLE_QA_BINDING as binding, GOOGLE_QA_SYNTHETIC_SECRET, verifyGoogleQa } from "../provider-qa/google-preflight.mjs";

const fixture = () => ({ FLEETUM_ENVIRONMENT: "provider-qa", NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null",
  FLEETUM_PROVIDER_QA_MODE: "google", FLEETUM_PROVIDER_QA_GOOGLE_STAGE: "offline-proof",
  FLEETUM_PROVIDER_QA_GOOGLE_PROJECT_ID: binding.projectId, GOOGLE_CLIENT_ID: binding.clientId,
  FLEETUM_PROVIDER_QA_GOOGLE_CLIENT_ID: binding.clientId, GOOGLE_REDIRECT_URI: binding.redirectUri,
  OAUTH_CALLBACK_URL: binding.appCallback, GOOGLE_CLIENT_SECRET: GOOGLE_QA_SYNTHETIC_SECRET,
  FLEETUM_PROVIDER_QA_MAX_SECONDS: "60" });

test("offline Google preparation accepts only its synthetic secret and keeps external networking off", () => {
  const result = verifyGoogleQa(fixture());
  assert.equal(result.networkMode, "offline");
  assert.equal(result.providerRequestsDuringPreflight, 0);
  assert.equal(result.projectId, "fleetum-qa-20261018");
  assert(!JSON.stringify(result).includes(GOOGLE_QA_SYNTHETIC_SECRET));
});

test("foreign project/client, live callbacks and ordinary environments are refused before app import", async t => {
  const changes = [
    { FLEETUM_ENVIRONMENT: "production" }, { NODE_ENV: "production" }, { DOTENV_CONFIG_PATH: "/real.env" },
    { FLEETUM_PROVIDER_QA_MODE: "offline" }, { FLEETUM_PROVIDER_QA_MODE: "stripe" }, { FLEETUM_PROVIDER_QA_MODE: "both" },
    { FLEETUM_PROVIDER_QA_GOOGLE_STAGE: "unbounded" }, { FLEETUM_PROVIDER_QA_GOOGLE_PROJECT_ID: "fleetum-499812" },
    { GOOGLE_CLIENT_ID: "foreign.apps.googleusercontent.com" }, { FLEETUM_PROVIDER_QA_GOOGLE_CLIENT_ID: "foreign" },
    { GOOGLE_REDIRECT_URI: "https://api.fleetum.it/api/auth/google/callback" },
    { OAUTH_CALLBACK_URL: "https://fleetum.it/auth/social-callback" }
  ];
  for (const change of changes) await t.test(Object.keys(change)[0] + "=" + Object.values(change)[0], () => {
    assert.throws(() => verifyGoogleQa({ ...fixture(), ...change }), /PROVIDER_QA_GOOGLE_/);
    const child = spawnSync(process.execPath, ["ops/provider-qa/serve-google.mts"], {
      cwd: new URL("../..", import.meta.url), env: { PATH: "/usr/bin:/bin", ...fixture(), ...change },
      encoding: "utf8", timeout: 10000
    });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /PROVIDER_QA_GOOGLE_/);
    assert(!child.stderr.includes("GOOGLE_CLIENT_SECRET="));
  });
});

test("a provider secret cannot enter offline-proof and a placeholder cannot enter interactive mode", () => {
  const syntheticProviderSecret = "GOCSPX-" + "fixture_only_".repeat(3);
  assert.throws(() => verifyGoogleQa({ ...fixture(), GOOGLE_CLIENT_SECRET: syntheticProviderSecret }), /SECRET_REFUSED/);
  assert.throws(() => verifyGoogleQa({ ...fixture(), FLEETUM_PROVIDER_QA_GOOGLE_STAGE: "interactive" }), /SECRET_REFUSED/);
  const checked = verifyGoogleQa({ ...fixture(), FLEETUM_PROVIDER_QA_GOOGLE_STAGE: "interactive", GOOGLE_CLIENT_SECRET: syntheticProviderSecret });
  assert.equal(checked.networkMode, "google");
  assert(!JSON.stringify(checked).includes(syntheticProviderSecret));
});

test("stage leases are bounded and other providers are refused", async t => {
  for (const duration of ["0", "14", "121", "1501", "NaN", "60.5"]) await t.test(duration, () => {
    assert.throws(() => verifyGoogleQa({ ...fixture(), FLEETUM_PROVIDER_QA_MAX_SECONDS: duration }), /DURATION_REFUSED/);
  });
  for (const key of ["STRIPE_SECRET_KEY", "APPLE_PRIVATE_KEY", "S3_SECRET_ACCESS_KEY"]) {
    assert.throws(() => verifyGoogleQa({ ...fixture(), [key]: "synthetic-must-not-leak" }), error => {
      assert.match(error.message, /OTHER_PROVIDER_REFUSED/);
      assert(!error.message.includes("synthetic-must-not-leak"));
      return true;
    });
  }
});
