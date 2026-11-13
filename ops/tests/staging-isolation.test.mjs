import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyIsolationSource } from "../e2e/staging-release-binding.mjs";
const source = (name) => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");

test("staging compose fixes isolated runtime policy independently of env files", () => {
  const compose = source("docker-compose.staging.yml");
  for (const line of ["FLEETUM_ENVIRONMENT: staging", "EMAIL_PROVIDER: disabled", 'BILLING_DUNNING_CRON_ENABLED: "false"', 'PRIVACY_RETENTION_CRON_ENABLED: "false"', 'PRIVACY_RETENTION_GLOBAL_ENABLED: "false"', "POSTGRES_USER: fleetum_staging", "POSTGRES_DB: fleetum_staging"]) assert.ok(compose.includes(line), line);
});

test("staging Caddy covers app, API, Platform and denies robots and sitemap discovery", () => {
  const caddy = source("deploy/caddy/Caddyfile.staging");
  assert.match(caddy, /X-Robots-Tag "noindex, nofollow, noarchive"/);
  for (const host of ["staging.fleetum.it", "api-staging.fleetum.it", "platform-staging.fleetum.it"]) {
    assert.ok(caddy.includes(`${host} {\n\timport security_headers\n\timport staging_errors\n\troute {\n\t\timport staging_discovery`), host);
  }
  assert.match(caddy, /route \/robots\.txt[\s\S]*respond 200 \{[\s\S]*body <<ROBOTS\nUser-agent: \*\nDisallow: \/\nROBOTS/);
  assert.match(caddy, /path \/sitemap\.xml \/sitemap-\*\.xml/);
  assert.match(caddy, /route @staging_sitemaps[\s\S]*respond 404/);
});

test("staging migration validates runtime env before Prisma and observes safety before proof", () => {
  const workflow = source(".github/workflows/deploy-staging.yml");
  const trustedDeploy = source("ops/staging/run-deploy.sh");
  assert.match(trustedDeploy, /node dist\/shared\/config\/env\.js && npx prisma migrate deploy/);
  assert.match(workflow, /\.fleetum-control\/ops\/staging\/run-deploy\.sh/);
  assert.match(workflow, /name: Verify observed staging isolation/);
  assert.match(workflow, /capture-staging-runtime\.mjs deploy staging-runtime-isolation\.json/);
  assert.match(workflow, /isolationPolicyVersion: 1/);
  assert.doesNotMatch(workflow, /ssh-keyscan/);
  assert.match(workflow, /FLEETUM_STAGING_KNOWN_HOSTS/);
});


test("backend staging network is internal and only Caddy receives the edge network", () => {
  const compose = source("docker-compose.staging.yml");
  assert.match(compose, /fleetum_staging_private:\n    name: fleetum_staging_private\n    internal: true/);
  assert.match(compose, /fleetum_staging_edge:\n    name: fleetum_staging_edge/);
  const backend = compose.split("  backend:")[1].split("  caddy:")[0];
  assert.doesNotMatch(backend, /fleetum_staging_edge/);
});


test("candidate capability gate rejects missing historical isolation implementation", () => {
  assert.equal(verifyIsolationSource(new URL("../..", import.meta.url).pathname).ok, true);
  assert.equal(verifyIsolationSource(new URL("../..", import.meta.url).pathname, "shared", "true").ok, true);
  assert.equal(verifyIsolationSource(new URL("../..", import.meta.url).pathname, "unknown", "false").ok, false);
  assert.equal(verifyIsolationSource(new URL("../..", import.meta.url).pathname, "shared", "unknown").ok, false);
  assert.equal(verifyIsolationSource(new URL("../../ops/tests", import.meta.url).pathname).ok, false);
  const workflow = source(".github/workflows/deploy-staging.yml");
  assert.ok(workflow.indexOf("staging-release-binding.mjs policy-preflight") < workflow.indexOf("  build-images:"));
});
