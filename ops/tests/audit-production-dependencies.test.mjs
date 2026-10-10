import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = fs.readFileSync(new URL("../audit-production-dependencies.mjs", import.meta.url), "utf8");
const importLine = 'import { spawnSync } from "node:child_process";';
assert.ok(script.startsWith(importLine), "The VM runs the real audit script with only its process-spawn import intercepted");
const executableScript = script.slice(importLine.length);

const report = (severities = []) => {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: severities.length };
  const vulnerabilities = Object.fromEntries(severities.map((severity, index) => {
    counts[severity] += 1;
    return [`synthetic-package-${index}`, { name: `synthetic-package-${index}`, severity }];
  }));
  return { auditReportVersion: 2, vulnerabilities,
    metadata: { vulnerabilities: counts, dependencies: { prod: 4, dev: 2, optional: 0, peer: 0, peerOptional: 0, total: 6 } } };
};

const execute = (auditReport = report(), override = {}, options = {}) => {
  const exit = Symbol("controlled process.exit");
  const calls = [];
  const output = [];
  let status = 0;
  let runtimeError;
  const env = options.env ?? {};
  try {
    vm.runInNewContext(executableScript, {
      spawnSync: (...args) => {
        calls.push(args);
        if (options.spawnThrows) throw options.spawnThrows;
        return { status: 0, signal: null, stdout: JSON.stringify(auditReport), stderr: "", ...override };
      },
      process: { env, execPath: "/synthetic/node", cwd: () => "/synthetic/workspace",
        exit: (code) => { status = code; throw exit; } },
      console: { log: (...values) => output.push(values.join(" ")), error: (...values) => output.push(values.join(" ")) }
    }, { timeout: 1000 });
  } catch (error) {
    if (error !== exit) { status = 1; runtimeError = error; }
  }
  return { status, calls, output, runtimeError };
};

const mustFail = (value) => {
  assert.equal(value.status, 1, "Unusable audit evidence must fail the release gate");
  assert.equal(value.runtimeError, undefined, "The script must deliberately reject evidence rather than crash");
  assert.equal(value.output.some((line) => line.includes("passed")), false);
};

test("npm JSON error cannot pass as an empty vulnerability report", () => {
  mustFail(execute({ error: { code: "ENOAUDIT", summary: "Synthetic audit unavailable" } }, { status: 1 }));
});

test("npm error field is rejected even alongside otherwise valid audit data", () => {
  mustFail(execute({ ...report(["moderate"]), error: { code: "ETIMEDOUT" } }, { status: 1 }));
  mustFail(execute({ ...report(), error: null }));
});

test("spawn errors, termination signals and unexpected exit statuses fail closed even with valid stdout", () => {
  for (const override of [{ error: new Error("Synthetic spawn failure") }, { signal: "SIGTERM", status: null },
    { status: null }, { status: undefined }, { status: 2 }, { status: 127 }, { status: -1 }]) {
    mustFail(execute(report(), override));
  }
});

test("a thrown spawn failure is caught without exposing its diagnostic contents", () => {
  const result = execute(report(), {}, { spawnThrows: new Error("SYNTHETIC_PRIVATE_DIAGNOSTIC") });
  mustFail(result);
  assert.equal(result.output.some((line) => line.includes("SYNTHETIC_PRIVATE_DIAGNOSTIC")), false);
});

test("invalid JSON is rejected without publishing raw process stderr", () => {
  const result = execute(report(), { stdout: "not-json", stderr: "SYNTHETIC_PRIVATE_DIAGNOSTIC" });
  mustFail(result);
  assert.equal(result.output.some((line) => line.includes("SYNTHETIC_PRIVATE_DIAGNOSTIC")), false);
});

test("missing version, metadata, vulnerabilities and malformed root reports cannot pass", () => {
  for (const value of [{}, null, [], "report", { auditReportVersion: 2 },
    { ...report(), auditReportVersion: 1 }, { ...report(), auditReportVersion: "2" },
    { ...report(), metadata: undefined }, { ...report(), vulnerabilities: undefined },
    { ...report(), vulnerabilities: [] }, { ...report(), vulnerabilities: null },
    { ...report(), metadata: [] }, { ...report(), metadata: { vulnerabilities: [] } }]) mustFail(execute(value));
});

test("every vulnerability requires a recognized severity and a record value", () => {
  for (const value of [null, [], {}, { severity: "unknown" }, { severity: "HIGH" }, { severity: 3 }]) {
    mustFail(execute({ ...report(["moderate"]), vulnerabilities: { synthetic: value } }, { status: 1 }));
  }
});

test("aggregate vulnerability counts must be complete, nonnegative integers and agree with entries", () => {
  for (const counts of [{}, { ...report().metadata.vulnerabilities, moderate: -1 },
    { ...report().metadata.vulnerabilities, low: 0.5 }, { ...report().metadata.vulnerabilities, high: "0" },
    { ...report().metadata.vulnerabilities, total: 1 }, { ...report().metadata.vulnerabilities, high: 1, total: 1 }]) {
    mustFail(execute({ ...report(), metadata: { vulnerabilities: counts } }));
  }
  mustFail(execute({ ...report(["moderate"]), metadata: report().metadata }, { status: 1 }));
});

test("valid empty reports pass with status zero", () => {
  const result = execute();
  assert.equal(result.status, 0); assert.equal(result.runtimeError, undefined);
  assert.ok(result.output.some((line) => line.includes("passed")));
});

test("valid info, low and moderate reports remain permitted including npm advisory exit one", () => {
  for (const status of [0, 1]) {
    const result = execute(report(["info", "low", "moderate"]), { status });
    assert.equal(result.status, 0); assert.equal(result.runtimeError, undefined);
    assert.ok(result.output.some((line) => line.includes("passed")));
  }
});

test("high and critical remain blocking regardless of the npm advisory exit convention", () => {
  for (const status of [0, 1]) {
    const result = execute(report(["moderate", "high", "critical"]), { status });
    mustFail(result);
    assert.ok(result.output.some((line) => line.includes("synthetic-package-1: high")));
    assert.ok(result.output.some((line) => line.includes("synthetic-package-2: critical")));
  }
});

test("the actual audit spawn is bounded to 120 seconds and preserves production-only JSON options", () => {
  const result = execute();
  assert.equal(result.calls.length, 1);
  const [executable, args, options] = result.calls[0];
  assert.equal(executable, "npm"); assert.deepEqual(Array.from(args), ["audit", "--omit=dev", "--json"]);
  assert.equal(options.timeout, 120_000); assert.equal(options.cwd, "/synthetic/workspace");
  assert.equal(options.maxBuffer, 16 * 1024 * 1024); assert.equal(options.encoding, "utf8");
});

test("npm_execpath is invoked through Node with argument boundaries preserved", () => {
  const cli = "/synthetic/path with spaces/npm-cli.js";
  const result = execute(report(), {}, { env: { npm_execpath: cli } });
  assert.equal(result.status, 0);
  const [executable, args] = result.calls[0];
  assert.equal(executable, "/synthetic/node");
  assert.deepEqual(Array.from(args), [cli, "audit", "--omit=dev", "--json"]);
});
