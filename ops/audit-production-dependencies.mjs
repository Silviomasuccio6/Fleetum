import { spawnSync } from "node:child_process";

const npmExecutable =
  process.env.npm_execpath && process.env.npm_execpath.trim()
    ? process.env.npm_execpath
    : "npm";
const command =
  npmExecutable === "npm"
    ? { executable: npmExecutable, args: ["audit", "--omit=dev", "--json"] }
    : {
        executable: process.execPath,
        args: [npmExecutable, "audit", "--omit=dev", "--json"],
      };

const failAudit = (reason) => {
  console.error(`Production dependency audit failed: ${reason}.`);
  process.exit(1);
};

let result;
try {
  result = spawnSync(command.executable, command.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
} catch {
  failAudit("npm could not be executed");
}

// npm uses exit one for valid advisory reports. Other process failures are
// unusable evidence even if stdout happens to contain an earlier valid report.
if (
  !result || result.error || result.signal ||
  (result.status !== 0 && result.status !== 1)
) {
  failAudit("npm did not complete normally");
}

let report;
try {
  if (typeof result.stdout !== "string") failAudit("npm returned no JSON report");
  report = JSON.parse(result.stdout);
} catch {
  failAudit("npm did not return valid JSON");
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const severities = ["info", "low", "moderate", "high", "critical"];
if (
  !isRecord(report) || Object.hasOwn(report, "error") || report.auditReportVersion !== 2 ||
  !isRecord(report.vulnerabilities) || !isRecord(report.metadata) ||
  !isRecord(report.metadata.vulnerabilities)
) {
  failAudit("npm returned an unsupported or incomplete audit report");
}

const vulnerabilities = Object.entries(report.vulnerabilities);
const observedCounts = Object.fromEntries(severities.map((severity) => [severity, 0]));
for (const [name, vulnerability] of vulnerabilities) {
  if (!name.trim() || !isRecord(vulnerability) || !severities.includes(vulnerability.severity)) {
    failAudit("npm returned an invalid vulnerability entry");
  }
  observedCounts[vulnerability.severity] += 1;
}
const counts = report.metadata.vulnerabilities;
for (const severity of [...severities, "total"]) {
  const expected = severity === "total" ? vulnerabilities.length : observedCounts[severity];
  if (!Number.isSafeInteger(counts[severity]) || counts[severity] < 0 || counts[severity] !== expected) {
    failAudit("npm returned invalid or inconsistent vulnerability counts");
  }
}

const blocking = vulnerabilities.filter(([, vulnerability]) =>
  ["high", "critical"].includes(vulnerability.severity),
);

if (blocking.length > 0) {
  console.error("Production dependency audit failed.");
  for (const [name, vulnerability] of blocking) {
    console.error(`- ${name}: ${vulnerability.severity}`);
  }
  process.exit(1);
} else {
  console.log("Production dependency audit passed with no high or critical findings.");
}
