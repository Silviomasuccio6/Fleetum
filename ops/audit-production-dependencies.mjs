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

const result = spawnSync(command.executable, command.args, {
  cwd: process.cwd(),
  encoding: "utf8",
  env: process.env,
  maxBuffer: 16 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("Production dependency audit did not return valid JSON.");
  if (result.stderr) {
    console.error(result.stderr.trim());
  }
  process.exit(1);
}

const vulnerabilities = Object.entries(report.vulnerabilities ?? {});
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
