import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateE2EConfig } from "../e2e/validate-config.mjs";
import {
  REQUIRED_CRITICAL_CASES,
  REQUIRED_CRITICAL_FLOWS,
  verifyE2EReport
} from "../e2e/verify-report.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const validEnvironment = {
  E2E_BASE_URL: "https://staging.fleetum.it",
  E2E_API_URL: "https://api-staging.fleetum.it/api",
  E2E_TENANT_EMAIL: "tenant-a@example.test",
  E2E_TENANT_PASSWORD: "synthetic-password-a",
  E2E_OTHER_TENANT_EMAIL: "tenant-b@example.test",
  E2E_OTHER_TENANT_PASSWORD: "synthetic-password-b"
};

const criticalCaseId = ({ file, title }) => `${file}::${title}`;

function reportFor(statusByCase = {}) {
  return {
    suites: REQUIRED_CRITICAL_CASES.map(({ file, title }) => ({
      file,
      specs: [
        {
          file,
          title,
          tests: [
            {
              expectedStatus: "passed",
              results: [{ status: statusByCase[criticalCaseId({ file, title })] ?? "passed" }]
            }
          ]
        }
      ]
    })),
    errors: []
  };
}

test("configuration requires complete credentials for two distinct tenants", () => {
  assert.equal(validateE2EConfig(validEnvironment).ok, true);

  const incomplete = { ...validEnvironment };
  delete incomplete.E2E_OTHER_TENANT_PASSWORD;
  const missingResult = validateE2EConfig(incomplete);
  assert.equal(missingResult.ok, false);
  assert.match(missingResult.errors.join("\n"), /E2E_OTHER_TENANT_PASSWORD/);

  const sameTenant = validateE2EConfig({
    ...validEnvironment,
    E2E_OTHER_TENANT_EMAIL: "TENANT-A@example.test"
  });
  assert.equal(sameTenant.ok, false);
  assert.match(sameTenant.errors.join("\n"), /different accounts/);
});

test("configuration rejects production and insecure targets", () => {
  const production = validateE2EConfig({
    ...validEnvironment,
    E2E_BASE_URL: "https://fleetum.it",
    E2E_API_URL: "https://api.fleetum.it/api"
  });
  assert.equal(production.ok, false);
  assert.equal(production.errors.filter((error) => error.includes("not Fleetum production")).length, 2);

  const insecure = validateE2EConfig({ ...validEnvironment, E2E_BASE_URL: "http://staging.example.test" });
  assert.equal(insecure.ok, false);
  assert.match(insecure.errors.join("\n"), /must use HTTPS/);

  const productionWithTrailingDot = validateE2EConfig({
    ...validEnvironment,
    E2E_BASE_URL: "https://fleetum.it."
  });
  assert.equal(productionWithTrailingDot.ok, false);
  assert.match(productionWithTrailingDot.errors.join("\n"), /not Fleetum production/);
});

test("configuration CLI fails closed without revealing credential values", () => {
  const secretMarker = "DO-NOT-PRINT-THIS-SECRET";
  const result = spawnSync(process.execPath, ["ops/e2e/validate-config.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      E2E_BASE_URL: "https://fleetum.it",
      E2E_API_URL: "https://api.fleetum.it/api",
      E2E_TENANT_EMAIL: "same@example.test",
      E2E_TENANT_PASSWORD: secretMarker,
      E2E_OTHER_TENANT_EMAIL: "same@example.test",
      E2E_OTHER_TENANT_PASSWORD: secretMarker
    }
  });

  assert.equal(result.status, 1);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(secretMarker));
});

test("configuration accepts only the canonical staging origins and exact API paths", () => {
  assert.equal(validateE2EConfig(validEnvironment).ok, true);
  assert.equal(validateE2EConfig({ ...validEnvironment, E2E_API_URL: "https://staging.fleetum.it/api" }).ok, true);
  for (const E2E_BASE_URL of [
    "https://other.example.test", "https://platform.fleetum.it", "https://staging.fleetum.it.",
    "https://staging.fleetum.it:444", "https://staging.fleetum.it/extra", "https://staging.fleetum.it/",
    "https://staging.fleetum.it?next=/", "https://staging.fleetum.it#fragment", "https://user:secret@staging.fleetum.it",
    "https://staging.fleetum.it/extra/..", " https://staging.fleetum.it", "https://STAGING.fleetum.it"
  ]) assert.equal(validateE2EConfig({ ...validEnvironment, E2E_BASE_URL }).ok, false, E2E_BASE_URL);
  for (const E2E_API_URL of [
    "https://other.example.test/api", "https://api-staging.fleetum.it./api", "https://api-staging.fleetum.it:444/api",
    "https://api-staging.fleetum.it/other/api", "https://api-staging.fleetum.it/api/", "https://api-staging.fleetum.it/api?x=1",
    "https://api-staging.fleetum.it/api#fragment", "https://api-staging.fleetum.it/%61pi", "https://api-staging.fleetum.it/x/../api",
    "https://user:secret@api-staging.fleetum.it/api"
  ]) assert.equal(validateE2EConfig({ ...validEnvironment, E2E_API_URL }).ok, false, E2E_API_URL);
  assert.equal(validateE2EConfig({ ...validEnvironment, E2E_TARGET_MODE: "anything" }).ok, false);
});

test("local rehearsal requires explicit test-only loopback HTTPS and a common explicit-port origin", () => {
  const local = { ...validEnvironment, E2E_TARGET_MODE: "local-rehearsal", NODE_ENV: "test", E2E_BASE_URL: "https://127.0.0.1:4443", E2E_API_URL: "https://127.0.0.1:4443/api" };
  assert.equal(validateE2EConfig(local).ok, true);
  assert.equal(validateE2EConfig({ ...local, CI: "false" }).ok, true);
  for (const change of [
    { E2E_TARGET_MODE: undefined }, { NODE_ENV: "production" }, { CI: "true" }, { GITHUB_ACTIONS: "true", CI: "false" },
    { GITHUB_RUN_ID: "12", CI: "false" }, { E2E_BASE_URL: "http://127.0.0.1:4443" },
    { E2E_BASE_URL: "https://localhost:4443" }, { E2E_BASE_URL: "https://127.0.0.1" },
    { E2E_API_URL: "https://127.0.0.1:5555/api" }, { E2E_BASE_URL: "https://127.0.0.1:4443/other" },
    { E2E_BASE_URL: "https://127.0.0.1:65536" }, { E2E_BASE_URL: "https://127.0.0.1:04443" },
    { E2E_BASE_URL: "https://staging.fleetum.it", E2E_API_URL: "https://api-staging.fleetum.it/api" }
  ]) assert.equal(validateE2EConfig({ ...local, ...change }).ok, false, JSON.stringify(change));
});

test("report gate accepts exactly seven required tests across five critical flows", () => {
  assert.equal(REQUIRED_CRITICAL_CASES.length, 7);
  assert.deepEqual(REQUIRED_CRITICAL_CASES.at(-1), {
    file: "05-vehicle-pagination.spec.ts",
    title: "keeps API totals and page rows accurate through search and IT/EN language changes"
  });
  const result = verifyE2EReport(reportFor(), { minExecuted: 7 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, {
    executed: 7,
    passed: 7,
    failed: 0,
    skipped: 0,
    attempts: 7,
    executedFlows: [...REQUIRED_CRITICAL_FLOWS],
    executedCases: REQUIRED_CRITICAL_CASES.map(criticalCaseId).sort()
  });
});

test("report gate rejects skips, failures, missing flows, and an unmet threshold", () => {
  const tenantIsolationCase = criticalCaseId(REQUIRED_CRITICAL_CASES[5]);
  const bookingCase = criticalCaseId(REQUIRED_CRITICAL_CASES[2]);
  const skipped = verifyE2EReport(reportFor({ [tenantIsolationCase]: "skipped" }));
  assert.equal(skipped.ok, false);
  assert.match(skipped.errors.join("\n"), /were skipped/);
  assert.match(skipped.errors.join("\n"), /04-tenant-isolation\.spec\.ts/);

  const failed = verifyE2EReport(reportFor({ [bookingCase]: "failed" }));
  assert.equal(failed.ok, false);
  assert.match(failed.errors.join("\n"), /tests failed/);

  const missingReport = reportFor();
  missingReport.suites = missingReport.suites.filter((suite) => suite.file !== "04-tenant-isolation.spec.ts");
  const missing = verifyE2EReport(missingReport);
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join("\n"), /04-tenant-isolation\.spec\.ts/);

  const threshold = verifyE2EReport(reportFor(), { minExecuted: 8 });
  assert.equal(threshold.ok, false);
  assert.match(threshold.errors.join("\n"), /at least 8/);

  const notRun = reportFor();
  notRun.suites[0].specs[0].tests[0].results = [];
  const notRunResult = verifyE2EReport(notRun);
  assert.equal(notRunResult.ok, false);
  assert.equal(notRunResult.summary.executed, 6);
  assert.match(notRunResult.errors.join("\n"), /01-login\.spec\.ts/);

  const unexpectedPass = reportFor();
  unexpectedPass.suites[0].specs[0].tests[0].status = "unexpected";
  const unexpectedResult = verifyE2EReport(unexpectedPass);
  assert.equal(unexpectedResult.ok, false);
  assert.equal(unexpectedResult.summary.failed, 1);
});

test("report gate rejects a missing pagination case, extra cases, and duplicate cases", () => {
  const missing = reportFor();
  missing.suites = missing.suites.filter((suite) => suite.file !== "05-vehicle-pagination.spec.ts");
  assert.equal(verifyE2EReport(missing).ok, false);

  const extra = reportFor();
  extra.suites.push({ file: "extra.spec.ts", specs: [{ file: "extra.spec.ts", title: "extra", tests: [{ results: [{ status: "passed" }] }] }] });
  assert.equal(verifyE2EReport(extra).ok, false);

  const duplicate = reportFor();
  duplicate.suites.push(structuredClone(duplicate.suites[0]));
  assert.equal(verifyE2EReport(duplicate).ok, false);
});

test("report gate rejects flaky outcomes and passes recovered through retries", () => {
  const flaky = reportFor();
  flaky.suites[0].specs[0].tests[0].status = "flaky";
  assert.equal(verifyE2EReport(flaky).ok, false);

  const recovered = reportFor();
  recovered.suites[0].specs[0].tests[0].results = [{ status: "failed" }, { status: "passed" }];
  assert.equal(verifyE2EReport(recovered).ok, false);
});

test("report gate rejects removal of the authenticated cross-tenant case", () => {
  const report = reportFor();
  report.suites = report.suites.filter(
    (suite) => suite.specs[0].title !== "another tenant cannot read or mutate this tenant booking"
  );

  const result = verifyE2EReport(report);
  assert.equal(result.ok, false);
  assert.equal(result.summary.executedFlows.includes("04-tenant-isolation.spec.ts"), true);
  assert.match(result.errors.join("\n"), /another tenant cannot read or mutate this tenant booking/);
});

test("nightly workflow fails closed and always verifies execution evidence", () => {
  const workflow = readFileSync(path.join(repositoryRoot, ".github/workflows/e2e-nightly.yml"), "utf8");

  assert.doesNotMatch(workflow, /https:\/\/(?:www\.)?fleetum\.it|https:\/\/api\.fleetum\.it/);
  assert.doesNotMatch(workflow, /Skipping critical-flow tests|exit 0/);
  assert.doesNotMatch(workflow, /if:\s*env\.E2E_TENANT_EMAIL/);
  assert.match(workflow, /baseUrl:[\s\S]*?required: true/);
  assert.match(workflow, /apiUrl:[\s\S]*?required: true/);
  assert.match(workflow, /node \.fleetum-control\/ops\/e2e\/validate-config\.mjs/);
  assert.match(workflow, /E2E_OTHER_TENANT_EMAIL:\s*\$\{\{ secrets\.E2E_OTHER_TENANT_EMAIL \}\}/);
  assert.match(workflow, /E2E_OTHER_TENANT_PASSWORD:\s*\$\{\{ secrets\.E2E_OTHER_TENANT_PASSWORD \}\}/);
  assert.match(workflow, /PLAYWRIGHT_JSON_OUTPUT_FILE:\s*test-results\/e2e\/e2e-results\.json/);
  assert.match(workflow, /--reporter=line,html,json/);
  assert.match(workflow, /node \.fleetum-control\/ops\/e2e\/verify-report\.mjs test-results\/e2e\/e2e-results\.json/);
  assert.match(workflow, /E2E_MIN_EXECUTED_TESTS:\s*"7"/);
  assert.match(workflow, /if:\s*always\(\) && steps\.playwright\.outcome != 'skipped'/);
  assert.match(workflow, /releaseSha:[\s\S]*?required: true/);
  assert.match(workflow, /stagingRunId:[\s\S]*?required: true/);
  assert.match(workflow, /vars\.E2E_RELEASE_SHA/);
  assert.match(workflow, /vars\.E2E_STAGING_RUN_ID/);
  assert.match(workflow, /actions:\s*read/);
  assert.match(workflow, /environment:\s*staging/);
  assert.match(workflow, /group:\s*fleetum-staging\s+cancel-in-progress:\s*false/);
  assert.match(workflow, /actions\/download-artifact@v4/);
  assert.match(workflow, /run-id:\s*\$\{\{ steps\.binding\.outputs\.staging_run_id \}\}/);
  assert.match(workflow, /github-token:\s*\$\{\{ github\.token \}\}/);
  assert.match(workflow, /FLEETUM_STAGING_KNOWN_HOSTS/);
  assert.doesNotMatch(workflow, /ssh-keyscan/);
  assert.match(workflow, /--retries=0/);
  assert.match(workflow, /capture-staging-runtime\.mjs before/);
  assert.match(workflow, /capture-staging-runtime\.mjs after/);
});
