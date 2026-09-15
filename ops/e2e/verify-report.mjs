import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const REQUIRED_CRITICAL_CASES = [
  { file: "01-login.spec.ts", title: "tenant can login from UI and reach dashboard" },
  { file: "01-login.spec.ts", title: "tenant API session exposes authenticated profile" },
  { file: "02-booking-contract.spec.ts", title: "creates vehicle and booking, generates PDF and signs contract" },
  { file: "03-vehicle-report.spec.ts", title: "exports vehicle profitability report as PDF, XLSX and CSV" },
  { file: "04-tenant-isolation.spec.ts", title: "unauthenticated users cannot read tenant booking details" },
  { file: "04-tenant-isolation.spec.ts", title: "another tenant cannot read or mutate this tenant booking" }
];
export const REQUIRED_CRITICAL_FLOWS = [...new Set(REQUIRED_CRITICAL_CASES.map(({ file }) => file))];

const caseId = ({ file, title }) => `${file}::${title}`;

function collectTests(suites, collected = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      const file = path.basename(spec.file || suite.file || "unknown");
      for (const test of spec.tests ?? []) {
        const results = Array.isArray(test.results) ? test.results : [];
        const finalResult = results.at(-1);
        let status = finalResult?.status;

        if (!status && test.expectedStatus === "skipped") status = "skipped";
        if (!status) status = "not-run";

        collected.push({ file, title: spec.title || "unknown", status, outcome: test.status, attempts: results.length });
      }
    }
    collectTests(suite.suites, collected);
  }
  return collected;
}

function finalStatusGroup(test) {
  if (test.outcome === "skipped" || test.status === "skipped") return "skipped";
  if (test.outcome === "unexpected") return "failed";
  if (test.status === "passed") return "passed";
  return "failed";
}

export function summarizeE2EReport(report) {
  const tests = collectTests(report?.suites);
  const summary = {
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    attempts: 0,
    executedFlows: [],
    executedCases: []
  };
  const executedFlows = new Set();
  const executedCases = new Set();

  for (const test of tests) {
    summary.attempts += test.attempts;
    const group = finalStatusGroup(test);
    summary[group] += 1;
    if (group !== "skipped" && test.attempts > 0) {
      summary.executed += 1;
      executedFlows.add(test.file);
      executedCases.add(caseId(test));
    }
  }

  summary.executedFlows = [...executedFlows].sort();
  summary.executedCases = [...executedCases].sort();
  return summary;
}

export function verifyE2EReport(report, { minExecuted = REQUIRED_CRITICAL_CASES.length } = {}) {
  const summary = summarizeE2EReport(report);
  const errors = [];
  const missingFlows = REQUIRED_CRITICAL_FLOWS.filter((file) => !summary.executedFlows.includes(file));
  const missingCases = REQUIRED_CRITICAL_CASES.filter((requiredCase) => !summary.executedCases.includes(caseId(requiredCase)));

  if (!Number.isInteger(minExecuted) || minExecuted < REQUIRED_CRITICAL_CASES.length) {
    errors.push(`Minimum executed-test threshold must be an integer of at least ${REQUIRED_CRITICAL_CASES.length}.`);
  } else if (summary.executed < minExecuted) {
    errors.push(`Only ${summary.executed} tests executed; at least ${minExecuted} are required.`);
  }
  if (missingFlows.length > 0) {
    errors.push(`Critical flows without an executed test: ${missingFlows.join(", ")}.`);
  }
  if (missingCases.length > 0) {
    errors.push(`Required critical tests did not execute: ${missingCases.map(caseId).join(", ")}.`);
  }
  if (summary.skipped > 0) {
    errors.push(`${summary.skipped} tests were skipped; scheduled critical-flow E2E runs allow no skips.`);
  }
  if (summary.failed > 0) {
    errors.push(`${summary.failed} tests failed or did not produce a successful final result.`);
  }
  if (Array.isArray(report?.errors) && report.errors.length > 0) {
    errors.push(`The Playwright report contains ${report.errors.length} top-level errors.`);
  }

  return { ok: errors.length === 0, errors, summary };
}

export function formatSummary(result) {
  const { summary } = result;
  return [
    "E2E critical-flow evidence",
    `executed=${summary.executed}`,
    `passed=${summary.passed}`,
    `failed=${summary.failed}`,
    `skipped=${summary.skipped}`,
    `flows=${summary.executedFlows.length}/${REQUIRED_CRITICAL_FLOWS.length}`,
    `cases=${summary.executedCases.length}/${REQUIRED_CRITICAL_CASES.length}`,
    `attempts=${summary.attempts}`
  ].join(" ");
}

function writeGitHubSummary(result, summaryPath) {
  if (!summaryPath) return;
  const { summary } = result;
  appendFileSync(
    summaryPath,
    [
      "## E2E critical-flow evidence",
      "",
      "| Executed | Passed | Failed | Skipped | Critical flows | Required tests | Attempts |",
      "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      `| ${summary.executed} | ${summary.passed} | ${summary.failed} | ${summary.skipped} | ${summary.executedFlows.length}/${REQUIRED_CRITICAL_FLOWS.length} | ${summary.executedCases.length}/${REQUIRED_CRITICAL_CASES.length} | ${summary.attempts} |`,
      "",
      result.ok ? "Gate passed." : `Gate failed: ${result.errors.join(" ")}`,
      ""
    ].join("\n")
  );
}

export function runReportVerification({
  reportPath = process.argv[2],
  minExecuted = Number(process.env.E2E_MIN_EXECUTED_TESTS ?? String(REQUIRED_CRITICAL_CASES.length)),
  githubSummaryPath = process.env.GITHUB_STEP_SUMMARY,
  output = console
} = {}) {
  if (!reportPath) {
    output.error("Usage: node ops/e2e/verify-report.mjs <playwright-json-report>");
    return 1;
  }

  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    output.error("Unable to read a valid Playwright JSON report.");
    return 1;
  }

  const result = verifyE2EReport(report, { minExecuted });
  output.log(formatSummary(result));
  for (const error of result.errors) output.error(`- ${error}`);
  writeGitHubSummary(result, githubSummaryPath);
  return result.ok ? 0 : 1;
}

const isCli = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isCli) {
  process.exitCode = runReportVerification();
}
