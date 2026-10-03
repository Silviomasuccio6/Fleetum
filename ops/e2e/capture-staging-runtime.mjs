import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { READONLY_INSPECT_COMMAND, validateSshTarget, requireReleaseBinding, verifyRuntimeSnapshot, verifyRuntimeContinuity } from "./staging-release-binding.mjs";

export function captureRuntime(proof, { env = process.env, execute = spawnSync } = {}) {
  const target = validateSshTarget(env.FLEETUM_STAGING_HOST, env.FLEETUM_STAGING_USER);
  if (!target.ok) throw new Error(target.errors.join(" "));
  if (!env.FLEETUM_STAGING_SSH_KEY?.trim() || !env.FLEETUM_STAGING_KNOWN_HOSTS?.trim()) throw new Error("Staging observation requires a protected SSH key and pinned known_hosts secret.");
  const directory = mkdtempSync(path.join(tmpdir(), "fleetum-staging-observer-"));
  try {
    const keyPath = path.join(directory, "key");
    const knownHostsPath = path.join(directory, "known_hosts");
    writeFileSync(keyPath, `${env.FLEETUM_STAGING_SSH_KEY.replace(/\\n/g, "\n").trim()}\n`, { mode: 0o600 });
    writeFileSync(knownHostsPath, `${env.FLEETUM_STAGING_KNOWN_HOSTS.trim()}\n`, { mode: 0o600 });
    const observed = execute("ssh", [
      "-F", "/dev/null", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
      "-o", `UserKnownHostsFile=${knownHostsPath}`, "-o", "GlobalKnownHostsFile=/dev/null",
      "-o", "ConnectTimeout=20", "-o", "ConnectionAttempts=1", "-o", "IdentitiesOnly=yes",
      "-o", "LogLevel=ERROR", "-i", keyPath,
      `${env.FLEETUM_STAGING_USER}@${env.FLEETUM_STAGING_HOST}`, READONLY_INSPECT_COMMAND
    ], { encoding: "utf8", timeout: 30_000, maxBuffer: 65_536, env: { PATH: env.PATH ?? process.env.PATH, LC_ALL: "C" } });
    if (observed.status !== 0 || observed.error || observed.signal) throw new Error("Readonly staging container observation failed.");
    let inspections;
    try { inspections = observed.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line)); }
    catch { throw new Error("Readonly staging observation did not return valid container identities."); }
    const verification = verifyRuntimeSnapshot(inspections, proof);
    if (!verification.ok) throw new Error(verification.errors.join(" "));
    return verification.snapshot;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export function runCapture({ args = process.argv.slice(2), env = process.env, output = console, execute = spawnSync } = {}) {
  try {
    // During deploy the caller already binds checkout and digests; no completed-run
    // proof exists yet. Observation must succeed before health checks/publishing it.
    if (args[0] === "deploy" && args.length === 2) {
      const snapshot = captureRuntime({ releaseSha: env.RELEASE_SHA, backendImage: env.BACKEND_IMAGE, frontendImage: env.FRONTEND_IMAGE }, { env, execute });
      writeFileSync(args[1], `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
      output.log("Observed staging containers satisfy isolation policy version 1.");
      return 0;
    }
    const [phase, proofPath, runMetadataPath, snapshotPath, baselinePath] = args;
    if (!["before", "after"].includes(phase) || args.length !== (phase === "after" ? 5 : 4)) throw new Error("Usage: capture-staging-runtime.mjs <before|after> <release-proof> <verified-run-proof> <snapshot> [baseline]");
    const proof = requireReleaseBinding(proofPath, runMetadataPath, env);
    const snapshot = captureRuntime(proof, { env, execute });
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    if (phase === "after") {
      let baseline;
      try { baseline = JSON.parse(readFileSync(baselinePath, "utf8")); }
      catch { throw new Error("Unable to read the pre-test runtime identity baseline."); }
      const continuity = verifyRuntimeContinuity(baseline, snapshot);
      if (!continuity.ok) throw new Error(continuity.errors.join(" "));
    }
    output.log(`Staging runtime ${phase} E2E execution matches the bound release.`);
    return 0;
  } catch (error) { output.error(error.message); return 1; }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = runCapture();
