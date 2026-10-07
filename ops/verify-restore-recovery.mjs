import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertRestoreMoneySnapshot, buildRestoreMoneySnapshotSql } from "./fixtures/restore-recovery-money.mjs";
import { exerciseApplicationRecovery } from "./recovery/exercise-application-recovery.mjs";
import { materializeRegisteredUploads } from "./fixtures/restore-recovery-storage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const usage = "Usage: node ops/verify-restore-recovery.mjs --source-sha <40 lowercase hex> --baseline-sha <40 lowercase hex> --evidence-dir <new absolute directory> [--git-dir <absolute Git directory>] [--docker-host unix:///absolute/local/socket] [--application-recovery --recovery-source-sha <40 lowercase hex> [--production-build]]";
const canonicalAbsolute = (value) => /^\/[A-Za-z0-9._/-]+$/.test(value) && value !== "/" && !value.endsWith("/") && path.posix.normalize(value) === value;

// Validation is pure and completes before any directory, process or Docker allocation.
export function parseRestoreRecoveryOptions(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new Error("Invalid restore rehearsal arguments");
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const options = {}; const seen = new Set();
  const fields = { "--recovery-source-sha": "recoverySourceSha", "--source-sha": "sourceSha", "--baseline-sha": "baselineSha", "--evidence-dir": "evidenceDirectory", "--git-dir": "gitDirectory", "--docker-host": "dockerHost" };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--application-recovery") {
      if (seen.has(flag)) throw new Error("Duplicate application recovery option");
      seen.add(flag); options.applicationRecovery = true; continue;
    }
    if (flag === "--production-build") {
      if (seen.has(flag)) throw new Error("Duplicate production build option");
      seen.add(flag); options.productionBuild = true; continue;
    }
    if (!Object.hasOwn(fields, flag)) throw new Error("Unsupported restore rehearsal option or positional argument");
    if (seen.has(flag)) throw new Error(`Duplicate restore rehearsal option: ${flag}`);
    seen.add(flag);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (flag.endsWith("-sha")) {
      if (!/^[a-f0-9]{40}$/.test(value)) throw new Error(`${flag} must be a full lowercase 40-character Git SHA`);
    } else if (flag === "--docker-host") {
      if (!value.startsWith("unix://") || !canonicalAbsolute(value.slice(7))) throw new Error("--docker-host must identify a canonical local Unix socket; TCP, SSH and remote contexts are forbidden");
    } else if (!canonicalAbsolute(value)) throw new Error(`${flag} must be a canonical absolute non-root path`);
    options[fields[flag]] = value;
  }
  for (const field of ["sourceSha", "baselineSha", "evidenceDirectory"]) if (!options[field]) throw new Error("--source-sha, --baseline-sha and --evidence-dir are required");
  if (options.sourceSha === options.baselineSha) throw new Error("Source and historical baseline must be different commits");
  if (Boolean(options.applicationRecovery) !== Boolean(options.recoverySourceSha)) throw new Error("Application recovery requires an explicit pinned recovery source and opt-in");
  if (options.productionBuild && !options.applicationRecovery) throw new Error("Production build requires explicit application recovery");
  if (options.recoverySourceSha === options.baselineSha) throw new Error("Historical migration baseline is not an approved application recovery source");
  return options;
}

// NODE_ENV changes only for these two compilations. Installation, generation,
// database operations and every application/HTTP fixture retain the test env.
export async function buildApplicationRecoveryPair({ run, directory, engines = {}, databaseUrl, productionBuild = false }) {
  assert.equal(typeof productionBuild, "boolean");
  const nodeEnv = productionBuild ? "production" : "test";
  await run("npm", ["run", "build", "-w", "backend"], "reserve-exact-source-backend-build", { cwd: directory, extraEnv: { ...engines, DATABASE_URL: databaseUrl, NODE_ENV: nodeEnv } });
  await run("npm", ["run", "build", "-w", "frontend"], "reserve-exact-source-frontend-build", { cwd: directory, extraEnv: { VITE_API_BASE_URL: "/api", VITE_PLATFORM_API_BASE_URL: "/platform-api", NODE_ENV: nodeEnv } });
  return { nodeEnv, completed: true };
}

export function parseRestoreSecurityReceipt(output, phase) {
  if (!["seed", "check"].includes(phase)) throw new Error("Invalid security fixture phase");
  const marker = "FLEETUM_RESTORE_SECURITY_JSON ";
  const rows = output.split("\n").filter((line) => line.startsWith(marker));
  let value;
  try { if (rows.length === 1) value = JSON.parse(rows[0].slice(marker.length)); } catch { /* Invalid untrusted receipt. */ }
  if (value?.format !== "fleetum-restore-security-v1" || value.phase !== phase || value.localOnly !== true || value.revocationRecords !== 1 || value.siblingRevocationRecords !== 0 || !/^[a-f0-9]{64}$/.test(value.sha256 ?? "") || typeof value.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.expiresAt) || !Number.isFinite(Date.parse(value.expiresAt)) || new Date(value.expiresAt).toISOString() !== value.expiresAt) throw new Error("Security fixture returned an invalid receipt");
  return { format: value.format, phase, localOnly: true, revocationRecords: 1, siblingRevocationRecords: 0, expiresAt: value.expiresAt, sha256: value.sha256 };
}

export async function runRestoreRecoverySecurityFixture({ run, directory, engines = {}, databaseUrl, phase, label, expectedReceipt }) {
  if (!["seed", "check"].includes(phase)) throw new Error("Invalid security fixture phase");
  if (phase === "check" && (!/^[a-f0-9]{64}$/.test(expectedReceipt?.sha256 ?? "") || typeof expectedReceipt?.expiresAt !== "string")) throw new Error("Security check requires the pre-backup seeded event identity");
  const receipt = await run(process.execPath, ["--import", "tsx", "restore-recovery-security.mjs", phase, directory], label, { cwd: directory, extraEnv: { ...engines, DATABASE_URL: databaseUrl, NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null" } });
  const security = parseRestoreSecurityReceipt(receipt.stdout.toString("utf8"), phase);
  if (phase === "check" && (security.sha256 !== expectedReceipt.sha256 || security.expiresAt !== expectedReceipt.expiresAt)) throw new Error("Restored security event differs from the pre-backup seeded event");
  return security;
}

export function extractCompatibilityFixture(script) {
  const match = script.match(/cat > "\$PREVIOUS_DIR\/compat-fixture\.mjs" <<'FIXTURE'\n([\s\S]*?)\nFIXTURE(?:\n|$)/);
  if (!match) throw new Error("The source commit has no recognizable historical compatibility fixture");
  return `${match[1]}\n`;
}
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const jsonLogRows = (output) => output.split("\n").flatMap((line) => {
  try { const value = JSON.parse(line); return value && typeof value === "object" ? [value] : []; }
  catch { return []; }
});

export function parseMoneyReconciliation(output, registry) {
  assert.equal(registry.length, 35);
  const logs = jsonLogRows(output);
  const completed = logs.filter((row) => row.msg === "Exact money reconciliation completed");
  assert.equal(completed.length, 1); assert.equal(completed[0].checkedFields, 35); assert.equal(completed[0].mismatchCount, 0);
  const fields = logs.filter((row) => row.msg === "Exact money reconciliation field checked");
  assert.equal(fields.length, 35);
  return { checkedFields: 35, mismatchCount: 0, fields: registry.map((field) => {
    const matches = fields.filter((row) => row.model === field.model && row.field === field.legacyField);
    assert.equal(matches.length, 1); const row = matches[0];
    assert(Number.isSafeInteger(row.rowCount) && row.rowCount > 0); assert.equal(row.mismatchCount, 0);
    return { fieldKey: `${field.model}.${field.legacyField}`, rowCount: row.rowCount, mismatchCount: 0 };
  }) };
}

export function parseDualWriteReceipt(output) {
  const completed = jsonLogRows(output).filter((row) => row.msg === "Exact money insert and update triggers verified");
  assert.equal(completed.length, 1); assert.equal(completed[0].checkedFields, 35); assert.equal(completed[0].checkedTables, 13);
  return { checkedFields: 35, checkedTables: 13 };
}

const httpDiagnosticSteps = new Set(["import-app", "import-prisma", "listen", "ready", "ready-body", "login-a", "login-a-cookies", "login-a-csrf", "login-b", "login-b-cookies", "login-b-csrf", "read-a", "read-a-fixture", "read-b", "read-b-isolation", "write-without-csrf", "write-with-csrf", "download-owner", "download-owner-bytes", "download-other-tenant", "download-anonymous", "download-modern-owner", "download-modern-owner-bytes", "download-modern-other-tenant", "download-modern-anonymous", "platform-session-revocation", "cleanup", "unknown"]);
const httpDiagnosticErrors = new Set(["Error", "AssertionError", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "TimeoutError", "AbortError", "PrismaClientInitializationError", "PrismaClientKnownRequestError", "PrismaClientValidationError"]);

// Treat subprocess diagnostics as untrusted: accept only constant labels and
// bounded numbers, never an error message, response body, token or command.
export function safeHttpFailure(value) {
  const diagnostic = {
    stepLabel: httpDiagnosticSteps.has(value?.stepLabel) ? value.stepLabel : "unknown",
    errorName: httpDiagnosticErrors.has(value?.errorName) ? value.errorName : "Error"
  };
  for (const field of ["actual", "expected", "status"]) if (typeof value?.[field] === "number" && Number.isFinite(value[field]) && Math.abs(value[field]) <= 2147483647) diagnostic[field] = value[field];
  return diagnostic;
}

export function parseHttpFailure(output) {
  const line = output.split("\n").find((value) => value.startsWith("FLEETUM_RESTORE_HTTP_FAILURE "));
  if (!line) return null;
  try { return safeHttpFailure(JSON.parse(line.slice("FLEETUM_RESTORE_HTTP_FAILURE ".length))); }
  catch { return { stepLabel: "unknown", errorName: "SyntaxError" }; }
}

export function assertArchiveHasNoRuntimeDotenv(files) {
  for (const file of files) {
    const name = path.posix.basename(file);
    if (name.startsWith(".env") && !/\.(example|sample|template)$/.test(name)) throw new Error("Git archive contains a runtime dotenv file; Prisma CLI must not load archived environment secrets");
  }
}

async function noSymlinkParents(file) {
  let current = file;
  while (current !== path.dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error("Symlinks are not accepted for backup/evidence paths"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    current = path.dirname(current);
  }
}

export async function verifyBackupBundle({ dumpPath, uploadRoot, manifest }) {
  if (!manifest || manifest.format !== "fleetum-synthetic-restore-v1" || !/^[a-f0-9]{64}$/.test(manifest.dump?.sha256 ?? "") || !Array.isArray(manifest.uploads) || !manifest.uploads.length) throw new Error("Invalid backup manifest");
  await noSymlinkParents(dumpPath); await noSymlinkParents(uploadRoot);
  const dumpStat = await lstat(dumpPath);
  if (!dumpStat.isFile() || dumpStat.size !== manifest.dump.sizeBytes || dumpStat.size < 1 || sha256(await readFile(dumpPath)) !== manifest.dump.sha256) throw new Error("Backup digest or size mismatch");
  const seen = new Set();
  for (const file of manifest.uploads) {
    if (typeof file.key !== "string" || !/^[A-Za-z0-9._/-]+$/.test(file.key) || file.key.startsWith("/") || path.posix.normalize(file.key) !== file.key || file.key.split("/").some((part) => part === ".." || part === ".") || seen.has(file.key) || !/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) throw new Error("Invalid upload manifest key or digest");
    seen.add(file.key);
    const target = path.join(uploadRoot, file.key); await noSymlinkParents(target);
    let fileStat;
    try { fileStat = await lstat(target); } catch { throw new Error("Registered upload missing"); }
    if (!fileStat.isFile() || fileStat.size !== file.sizeBytes || sha256(await readFile(target)) !== file.sha256) throw new Error("Registered upload digest or size mismatch");
  }
  return true;
}

async function selectLocalDockerHost(explicit, originalHome) {
  const candidates = explicit ? [explicit] : ["unix:///var/run/docker.sock", `unix://${path.join(originalHome, ".docker/run/docker.sock")}`];
  for (const candidate of candidates) {
    try { if ((await stat(candidate.slice(7))).isSocket()) return candidate; } catch { /* Try the next local Unix socket. */ }
  }
  throw new Error("No local Docker Unix socket found; provide --docker-host unix:///absolute/local/socket");
}

export async function runRestoreRecovery(options) {
  if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") throw new Error("This rehearsal is local-only and refuses hosted CI");
  if (!/^22\.23\./.test(process.versions.node)) throw new Error("Use the pinned Node 22.23 runtime for this rehearsal");
  await noSymlinkParents(options.evidenceDirectory);
  try { if ((await readdir(options.evidenceDirectory)).length) throw new Error("Evidence directory must be new or empty"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const originalHome = homedir();
  const dockerHost = await selectLocalDockerHost(options.dockerHost, originalHome);
  const id = randomUUID().replaceAll("-", "");
  const scratch = await mkdtemp("/private/tmp/fleetum-restore-recovery-");
  const container = `fleetum_restore_${id}`; const network = `fleetum_restore_network_${id}`;
  const dbUser = "fleetum_restore"; const dbName = `fleetum_restore_${id}_source`;
  const password = randomBytes(24).toString("hex"); const loginPassword = `Synthetic-${randomBytes(24).toString("hex")}`;
  const baselineDirectory = path.join(scratch, "baseline"); const sourceDirectory = path.join(scratch, "source");
  const reserveDirectory = path.join(scratch, "reserve");
  const uploadDirectory = path.join(scratch, "upload-tree");
  const env = {
    PATH: process.env.PATH, HOME: path.join(scratch, "home"), TMPDIR: scratch,
    NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null", CHECKPOINT_DISABLE: "1",
    npm_config_userconfig: "/dev/null", npm_config_globalconfig: path.join(scratch, "npmrc"),
    npm_config_cache: path.join(scratch, "npm-cache"), npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false",
    DOCKER_HOST: dockerHost, DOCKER_CONFIG: path.join(scratch, "docker-config"),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    PRISMA_ENGINES_MIRROR: "http://127.0.0.1:9", PRISMA_HIDE_UPDATE_MESSAGE: "1",
    DEMO_ADMIN_PASSWORD: loginPassword, STORAGE_PROVIDER: "local", UPLOAD_DIR: "uploads", SYNTHETIC_UPLOAD_TREE: uploadDirectory,
    PRIVACY_RETENTION_CRON_ENABLED: "false", PRIVACY_RETENTION_GLOBAL_ENABLED: "false", BILLING_DUNNING_CRON_ENABLED: "false"
  };
  const started = performance.now(); const deadline = started + 300000;
  const result = {
    format: "fleetum-synthetic-restore-result-v1", success: false, localOnly: true,
    sourceSha: options.sourceSha, historicalBaselineSha: options.baselineSha,
    baselineIsApprovedReleaseFallback: false, approvedRollback: false, approvedRtoRpo: false,
    ...(options.applicationRecovery ? { applicationBuild: { nodeEnv: options.productionBuild ? "production" : "test", completed: false } } : {}),
    claims: "Local synthetic restore and schema-compatibility evidence only; no production data, provider replay or down migration",
    isolation: { dockerHost, container, network, loopbackDatabase: true, internalNetwork: false, dedicatedBridge: true, containerEgressDenied: false, imagePulls: false, inheritedProviderEnvironment: false, dotenv: "/dev/null", fixtureNodeEnv: env.NODE_ENV, workersStarted: false,
      limitation: "The dedicated local bridge permits container egress; application fixture blocks provider HTTP. This does not prove staging egress isolation." },
    checks: [], steps: [], backupManifests: [], toolingHashes: {}, engineHashes: [], snapshots: {}, money: {}, http: {}, cleanup: {},
    coverage: { moneyFields: [], additionalIntegerField: "RentalDeposit.amountCents", allMoneyFieldsExercised: false, productionRtoRpoMeasured: false, externalGatesPassed: false }
  };
  const children = new Set(); let interrupted = false; let containerCreated = false; let networkCreated = false;
  const kill = (child, signal = "SIGTERM") => {
    try { if (child.pid) process.kill(-child.pid, signal); } catch { /* Owned child already exited. */ }
  };
  const signalHandler = () => { interrupted = true; for (const child of children) kill(child); };
  process.on("SIGINT", signalHandler); process.on("SIGTERM", signalHandler);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function run(command, args, label, { cwd = root, extraEnv = {}, input, allowFailure = false, timeoutMs = 90000, cleaning = false, background = false } = {}) {
    if (interrupted && !cleaning) throw new Error("Restore rehearsal interrupted");
    const remaining = cleaning ? timeoutMs : Math.min(timeoutMs, deadline - performance.now());
    if (remaining <= 0) throw new Error("Restore rehearsal exceeded its five-minute execution bound");
    const t = performance.now();
    const child = spawn(command, args, { cwd, env: { ...env, ...extraEnv }, stdio: ["pipe", "pipe", "pipe"], detached: true });
    children.add(child); const out = []; const err = []; let totalBytes = 0; let timedOut = false;
    for (const [stream, chunks] of [[child.stdout, out], [child.stderr, err]]) stream.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > 32 * 1024 * 1024) kill(child, "SIGKILL"); else chunks.push(chunk);
    });
    child.stdin.on("error", () => {}); child.stdin.end(input);
    const timer = setTimeout(() => { timedOut = true; kill(child, "SIGKILL"); }, remaining);
    const completion = new Promise((resolve, reject) => {
      child.once("error", (error) => { clearTimeout(timer); children.delete(child); reject(new Error(`${label}: ${error.code ?? "process error"}`)); });
      child.once("close", (code) => {
        clearTimeout(timer); children.delete(child);
        const output = { code, stdout: Buffer.concat(out), stderr: Buffer.concat(err) };
        result.steps.push({ label, success: code === 0 && !timedOut, exitCode: code, timedOut, durationMs: Math.round(performance.now() - t) });
        if ((code !== 0 || timedOut) && !allowFailure) reject(new Error(`${label} failed (${timedOut ? "timeout" : `exit ${code}`}); subprocess output is withheld to avoid credential/token logs`)); else resolve(output);
      });
    });
    if (background) return { child, completion };
    return completion;
  }
  const check = (name, details = {}) => result.checks.push({ name, passed: true, ...details });
  const git = (args, label, more) => run("git", ["--no-replace-objects", ...(options.gitDirectory ? [`--git-dir=${options.gitDirectory}`] : []), ...args], label, more);
  const docker = (args, label, more) => run("docker", ["--host", dockerHost, ...args], label, more);
  const sql = async (database, text, label = "sql-query", more = {}) => (await docker(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-U", dbUser, "-d", database], label, { input: text, ...more })).stdout.toString("utf8").trim();
  let databaseUrl;
  const urlFor = (name) => databaseUrl.replace(`/${dbName}?`, `/${name}?`);
  const clients = new Map();
  async function installAndGenerate(directory, label) {
    await run("npm", ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], `${label}-exact-lock-offline-install`, { cwd: directory });
    const version = JSON.parse(await readFile(path.join(directory, "node_modules/@prisma/engines-version/package.json"), "utf8")).prisma.enginesVersion;
    const platform = (await run(process.execPath, ["--input-type=module", "-e", "import platform from '@prisma/get-platform'; console.log(await platform.getBinaryTargetForCurrentPlatform());"], `${label}-prisma-platform`, { cwd: directory })).stdout.toString("utf8").trim();
    if (!/^[a-z0-9.-]+$/.test(platform) || !/^[a-f0-9]{40}$/.test(version)) throw new Error("Unrecognized cached Prisma engine identity");
    const engines = {};
    for (const [binary, variable] of [["schema-engine", "PRISMA_SCHEMA_ENGINE_BINARY"], ["libquery-engine", "PRISMA_QUERY_ENGINE_LIBRARY"]]) {
      const cachePath = path.join(originalHome, ".cache/prisma/master", version, platform, binary);
      const bytes = await readFile(cachePath);
      const digest = (await readFile(`${cachePath}.sha256`, "utf8")).trim();
      if (!/^[a-f0-9]{64}$/.test(digest) || sha256(bytes) !== digest) throw new Error("Cached Prisma engine digest mismatch");
      const destination = path.join(directory, `${binary}-${platform}${binary.startsWith("lib") ? (platform.startsWith("darwin") ? ".dylib.node" : ".so.node") : ""}`);
      await writeFile(destination, bytes, { mode: 0o700 }); await chmod(destination, 0o700);
      engines[variable] = destination; result.engineHashes.push({ release: label, version, platform, binary, sha256: digest });
    }
    clients.set(directory, engines);
    await run(process.execPath, ["node_modules/prisma/build/index.js", "generate", "--schema", "backend/prisma/schema.prisma"], `${label}-prisma-generate`, { cwd: directory, extraEnv: { ...engines, DATABASE_URL: databaseUrl } });
  }
  const migrate = (directory, name, label, more = {}) => run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "backend/prisma/schema.prisma"], label, { cwd: directory, extraEnv: { ...clients.get(directory), DATABASE_URL: urlFor(name) }, ...more });
  async function snapshot(name) {
    const tables = (await sql(name, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;", "snapshot-table-inventory")).split("\n").filter(Boolean);
    const statements = tables.map((table) => {
      if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error("Unexpected synthetic table identifier");
      return `SELECT jsonb_build_object('table', '${table}', 'rows', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb))::text FROM "${table}" t`;
    });
    const output = await sql(name, `${statements.join(" UNION ALL ")};`, "canonical-all-table-snapshot");
    const summary = output.split("\n").filter(Boolean).map((line) => {
      const value = JSON.parse(line); return { table: value.table, rowCount: value.rows.length, sha256: sha256(JSON.stringify(value.rows)) };
    }).sort((a, b) => a.table.localeCompare(b.table));
    return { tableCount: summary.length, sha256: sha256(JSON.stringify(summary)), tables: summary };
  }
  let moneyRegistry;
  async function verifyMoney(directory, name, phase) {
    const rows = (await sql(name, buildRestoreMoneySnapshotSql(moneyRegistry), `${phase}-all-money-values`)).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const money = assertRestoreMoneySnapshot(moneyRegistry, rows, phase);
    if (result.money.schema42) assert.equal(money.sha256, result.money.schema42.sha256);
    const before = await snapshot(name);
    const reconciliation = await run("npm", ["run", "money:reconcile", "-w", "backend"], `${phase}-official-money-reconciliation`, { cwd: directory, extraEnv: { ...clients.get(directory), DATABASE_URL: urlFor(name) } });
    money.reconciliation = parseMoneyReconciliation(reconciliation.stdout.toString("utf8"), moneyRegistry);
    const triggers = await run("npm", ["run", "money:verify-dual-write", "-w", "backend"], `${phase}-official-money-dual-write`, { cwd: directory, extraEnv: { ...clients.get(directory), DATABASE_URL: urlFor(name) } });
    money.dualWrite = { ...parseDualWriteReceipt(triggers.stdout.toString("utf8")), insertFields: 35, updateFields: ["VehicleCost.amount"], limitation: "The official verifier checks INSERT for every field; UPDATE is exercised on VehicleCost.amount only." };
    assert.deepEqual(await snapshot(name), before, "Official trigger verifier must clean its synthetic rows");
    result.money[phase] = money;
    check(`${phase}-all-35-money-fields-and-dual-write`, { checkedFields: money.checkedFields, fieldRowPairs: money.checkedRows, checkedTables: money.dualWrite.checkedTables });
  }
  const preservedQuery = `SELECT jsonb_build_object(
    'tenants',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY id) FROM "Tenant"),
    'vehicles',(SELECT jsonb_agg(jsonb_build_object('id',id,'tenantId',"tenantId",'plate',plate,'purchasePrice',"purchasePrice",'monthlyFixedCost',"monthlyFixedCost",'purchasePriceExact',"purchasePriceExact",'monthlyFixedCostExact',"monthlyFixedCostExact") ORDER BY id) FROM "Vehicle"),
    'booking',(SELECT jsonb_agg(jsonb_build_object('id',id,'tenantId',"tenantId",'expectedTotal',"expectedTotal",'expectedTotalExact',"expectedTotalExact") ORDER BY id) FROM "RentalBooking"),
    'deposit',(SELECT jsonb_agg(jsonb_build_object('id',id,'tenantId',"tenantId",'bookingId',"bookingId",'amountCents',"amountCents",'status',status) ORDER BY id) FROM "RentalDeposit"),
    'email',(SELECT jsonb_agg(jsonb_build_object('id',id,'tenantId',"tenantId",'body',body,'status',status) ORDER BY id) FROM "EmailQueue"),
    'files',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "StoredFileObject" t)
  )::text;`;
  async function manifestFor(name, dumpFile, uploadRoot, migrationCount) {
    const dump = (await docker(["exec", container, "pg_dump", "-U", dbUser, "-d", name, "--format=plain", "--no-owner", "--no-privileges"], `dump-${migrationCount}`)).stdout;
    await writeFile(dumpFile, dump, { mode: 0o600 });
    const uploads = JSON.parse(await sql(name, `SELECT COALESCE(jsonb_agg(jsonb_build_object('key',"storageKey",'sizeBytes',"sizeBytes",'sha256',"checksumSha256",'tenantId',"tenantId",'resourceType',"resourceType",'resourceId',"resourceId") ORDER BY "storageKey"),'[]') FROM "StoredFileObject" WHERE "deletedAt" IS NULL;`, "registered-upload-inventory"));
    const manifest = { format: "fleetum-synthetic-restore-v1", sourceSha: options.sourceSha, historicalBaselineSha: options.baselineSha, localOnly: true, migrationCount, dump: { file: path.basename(dumpFile), sha256: sha256(dump), sizeBytes: dump.length }, uploads };
    await verifyBackupBundle({ dumpPath: dumpFile, uploadRoot, manifest });
    await writeFile(`${dumpFile}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    result.backupManifests.push(manifest); return manifest;
  }
  const restore = async (dumpPath, manifest, name, uploadRoot, destination) => {
    await verifyBackupBundle({ dumpPath, manifest, uploadRoot });
    await run("bash", [path.join(root, "ops/restore-db-test.sh"), dumpPath, container, name, dbUser], `restore-${name.split("_").at(-1)}`);
    if (destination) {
      await cp(uploadRoot, destination, { recursive: true });
      await verifyBackupBundle({ dumpPath, manifest, uploadRoot: destination });
    }
  };
  async function smoke(directory, name, uploads, label, manifest, { uploadMode = "relative", includeModern = false } = {}) {
    // Both archive directories and source trees were allocated by this runner.
    // The old app resolves its legacy key against cwd, while the current app
    // recognizes the same 'uploads/' prefix. Never rewrite keys in the database.
    if (![baselineDirectory, sourceDirectory].includes(directory) || path.dirname(uploads) !== scratch || ![uploadDirectory, path.join(scratch, "uploads-first"), path.join(scratch, "uploads-second")].includes(uploads)) throw new Error("Refusing synthetic uploads outside owned archive/task trees");
    assert(["relative", "absolute"].includes(uploadMode));
    const destination = path.join(directory, "uploads");
    await noSymlinkParents(directory); await noSymlinkParents(destination); await noSymlinkParents(uploads);
    if (!(await lstat(directory)).isDirectory() || !(await lstat(uploads)).isDirectory()) throw new Error("Synthetic upload source and archive must be regular task-owned directories");
    await rm(destination, { recursive: true, force: true });
    const materialized = await materializeRegisteredUploads({ manifest, uploadTree: uploads, destination });
    const response = await run(process.execPath, ["--import", "tsx", "restore-recovery-http.mjs"], label, { cwd: directory, extraEnv: { ...clients.get(directory), DATABASE_URL: urlFor(name), UPLOAD_DIR: uploadMode === "absolute" ? destination : "uploads", SYNTHETIC_UPLOAD_TREE: uploads, SYNTHETIC_INCLUDE_MODERN_FILES: includeModern ? "true" : "false" }, timeoutMs: 45000, allowFailure: true });
    const failure = parseHttpFailure(Buffer.concat([response.stdout, response.stderr]).toString("utf8"));
    if (response.code !== 0 || failure) {
      const diagnostic = failure ?? { stepLabel: "unknown", errorName: "Error" };
      result.http[label] = { success: false, exitCode: response.code, diagnostic };
      const numbers = ["status", "actual", "expected"].filter((key) => Object.hasOwn(diagnostic, key)).map((key) => `${key}=${diagnostic[key]}`).join(", ");
      throw new Error(`${label} failed at ${diagnostic.stepLabel}: ${diagnostic.errorName}${numbers ? ` (${numbers})` : ""}`);
    }
    const line = response.stdout.toString("utf8").split("\n").find((value) => value.startsWith("FLEETUM_RESTORE_HTTP_RESULT "));
    if (!line) throw new Error("HTTP compatibility fixture produced no result");
    result.http[label] = { ...JSON.parse(line.slice("FLEETUM_RESTORE_HTTP_RESULT ".length)), uploadMode, materializedFiles: materialized.fileCount }; check(label, result.http[label]);
  }
  try {
    await mkdir(options.evidenceDirectory, { recursive: true, mode: 0o700 });
    await mkdir(env.HOME, { recursive: true }); await mkdir(env.DOCKER_CONFIG, { recursive: true }); await mkdir(uploadDirectory, { recursive: true });
    await writeFile(env.npm_config_globalconfig, "");
    for (const [label, sha] of [["baseline", options.baselineSha], ["source", options.sourceSha]]) {
      assert.equal((await git(["rev-parse", "--verify", `${sha}^{commit}`], `${label}-commit-identity`)).stdout.toString("utf8").trim(), sha);
    }
    await git(["merge-base", "--is-ancestor", options.baselineSha, options.sourceSha], "historical-baseline-ancestor");
    if (options.applicationRecovery) {
      assert.equal((await git(["rev-parse", "--verify", `${options.recoverySourceSha}^{commit}`], "reserve-commit-identity")).stdout.toString("utf8").trim(), options.recoverySourceSha);
      await git(["merge-base", "--is-ancestor", options.recoverySourceSha, options.sourceSha], "pinned-reserve-ancestor");
      const applicationPaths = ["backend/src", "backend/prisma", "backend/package.json", "backend/tsconfig.json", "frontend", "packages", "package.json", "package-lock.json"];
      const changes = (await git(["diff", "--name-only", options.recoverySourceSha, options.sourceSha, "--", ...applicationPaths], "reserve-current-application-equivalence")).stdout.toString("utf8").trim();
      assert.equal(changes, "", "Reserve must preserve all current application/security fixes");
      result.reserve = { sourceSha: options.recoverySourceSha, applicationPaths, applicationMatchesCurrentSource: true, distinctPreviousProductionRelease: false, approvedFallback: false, claims: "The reserve archive preserves the current application/security fixes; this exercises a rebuilt application pair, not switching to a distinct previous production release or approved OCI images" };
      check("pinned-reserve-preserves-current-application-and-security-fixes");
    }
    const diff = (await git(["diff", "--name-status", options.baselineSha, options.sourceSha, "--", "backend/prisma/migrations"], "immutable-migration-history")).stdout.toString("utf8").trim().split("\n").filter(Boolean);
    if (!diff.length || diff.some((line) => !/^A\tbackend\/prisma\/migrations\/[A-Za-z0-9_]+\/migration\.sql$/.test(line))) throw new Error("Existing migration history must be immutable and the delta additive");
    result.migrationDelta = diff.map((line) => line.split("\t")[1]); check("additive-immutable-migration-history", { addedMigrations: diff.length });
    await cp(path.join(originalHome, ".npm/_cacache"), path.join(env.npm_config_cache, "_cacache"), { recursive: true });
    for (const [label, sha, directory] of [["baseline", options.baselineSha, baselineDirectory], ["source", options.sourceSha, sourceDirectory], ...(options.applicationRecovery ? [["reserve", options.recoverySourceSha, reserveDirectory]] : [])]) {
      const archivedPaths = (await git(["ls-tree", "-r", "--name-only", sha], `${label}-archive-dotenv-path-guard`)).stdout.toString("utf8").trim().split("\n");
      assertArchiveHasNoRuntimeDotenv(archivedPaths); check(`${label}-archive-has-no-runtime-dotenv`);
      const archive = (await git(["archive", "--format=tar", sha], `${label}-git-archive`)).stdout;
      const archiveFile = path.join(scratch, `${label}.tar`); await writeFile(archiveFile, archive); await mkdir(directory);
      await run("tar", ["-xf", archiveFile, "-C", directory], `${label}-archive-extract`);
      result[`${label}LockfileSha256`] = sha256(await readFile(path.join(directory, "package-lock.json")));
      await cp(path.join(root, "ops/fixtures/restore-recovery-http.mjs"), path.join(directory, "restore-recovery-http.mjs"));
      await cp(path.join(root, "ops/fixtures/restore-recovery-money.mjs"), path.join(directory, "restore-recovery-money.mjs"));
      if (options.applicationRecovery && label !== "baseline") await cp(path.join(root, "ops/fixtures/restore-recovery-security.mjs"), path.join(directory, "restore-recovery-security.mjs"));
    }
    const inventory = async (directory) => (await readdir(path.join(directory, "backend/prisma/migrations"))).filter((name) => /^\d/.test(name)).sort();
    const baselineMigrations = await inventory(baselineDirectory); const sourceMigrations = await inventory(sourceDirectory);
    assert.equal(baselineMigrations.length, 42, "this historical rehearsal expects 42 baseline migrations");
    assert.equal(sourceMigrations.length, 48, "this source rehearsal expects 48 migrations");
    result.migrationCounts = { baseline: baselineMigrations.length, source: sourceMigrations.length };
    const compatibilityFixture = extractCompatibilityFixture(await readFile(path.join(sourceDirectory, "ops/verify-migration-compatibility.sh"), "utf8"));
    await writeFile(path.join(baselineDirectory, "compat-fixture.mjs"), compatibilityFixture);
    await cp(path.join(root, "ops/fixtures/restore-recovery-seed.mjs"), path.join(baselineDirectory, "restore-recovery-seed.mjs"));
    for (const file of ["ops/verify-restore-recovery.mjs", "ops/restore-db-test.sh", "ops/fixtures/restore-recovery-seed.mjs", "ops/fixtures/restore-recovery-http.mjs", "ops/fixtures/restore-recovery-money.mjs", "ops/fixtures/restore-recovery-storage.mjs", ...(options.applicationRecovery ? ["ops/recovery/exercise-application-recovery.mjs", "ops/recovery/application-recovery-policy.mjs", "ops/fixtures/application-recovery-server.mjs", "ops/fixtures/restore-recovery-security.mjs"] : [])]) result.toolingHashes[file] = sha256(await readFile(path.join(root, file)));
    result.toolingHashes.compatibilityFixture = sha256(compatibilityFixture);
    await docker(["info", "--format", "{{.ServerVersion}}"], "local-docker-info");
    const image = JSON.parse((await docker(["image", "inspect", "postgres:16-alpine", "--format", "{{json .}}"], "preexisting-postgres16-image")).stdout.toString("utf8"));
    result.postgresImage = { tag: "postgres:16-alpine", id: image.Id, repoDigests: image.RepoDigests };
    // Track attempts before daemon calls so an interrupted allocation is also cleaned.
    networkCreated = true;
    await docker(["network", "create", "--driver", "bridge", "--label", `fleetum.restore.owner=${id}`, network], "owned-dedicated-bridge-create");
    assert.equal((await docker(["network", "inspect", network, "--format", "{{.Internal}}"], "bridge-network-mode-proof")).stdout.toString("utf8").trim(), "false");
    assert.equal((await docker(["network", "inspect", network, "--format", "{{.Driver}}"], "bridge-network-driver-proof")).stdout.toString("utf8").trim(), "bridge");
    containerCreated = true;
    await docker(["run", "--pull=never", "--rm", "-d", "--name", container, "--label", `fleetum.restore.owner=${id}`, "--network", network, "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,size=512m", "-e", `POSTGRES_USER=${dbUser}`, "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_DB=${dbName}`, "-p", "127.0.0.1::5432", "postgres:16-alpine"], "owned-postgres16-start");
    assert.equal((await docker(["container", "inspect", container, "--format", "{{.Image}}"], "running-postgres-image-proof")).stdout.toString("utf8").trim(), image.Id);
    const networks = JSON.parse((await docker(["container", "inspect", container, "--format", "{{json .NetworkSettings.Networks}}"], "owned-container-network-proof")).stdout.toString("utf8"));
    assert.deepEqual(Object.keys(networks), [network]);
    const peers = JSON.parse((await docker(["network", "inspect", network, "--format", "{{json .Containers}}"], "dedicated-bridge-sole-member-proof")).stdout.toString("utf8"));
    assert.deepEqual(Object.values(peers).map((peer) => peer.Name), [container]);
    result.isolation.soleNetworkMember = container;
    const mounts = JSON.parse((await docker(["container", "inspect", container, "--format", "{{json .Mounts}}"], "temporary-postgres-storage-proof")).stdout.toString("utf8"));
    assert(mounts.every((mount) => mount.Type === "tmpfs"), "database has no persistent volume or host mount");
    result.isolation.persistentVolumes = false; check("postgres-dedicated-bridge-image-and-temporary-storage");
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      // initdb's temporary server listens only on its Unix socket. Requiring TCP
      // prevents that temporary process from satisfying the final readiness gate.
      ready = (await docker(["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", dbUser, "-d", dbName], "postgres-final-tcp-readiness", { allowFailure: true, timeoutMs: 5000 })).code === 0;
      if (!ready) await sleep(500);
    }
    if (!ready) throw new Error("Synthetic PostgreSQL did not become ready");
    const binding = (await docker(["port", container, "5432/tcp"], "loopback-postgres-binding")).stdout.toString("utf8").trim();
    if (!/^127\.0\.0\.1:[0-9]+$/.test(binding)) throw new Error("PostgreSQL must bind exclusively to loopback");
    databaseUrl = `postgresql://${dbUser}:${password}@${binding}/${dbName}?schema=public`;
    result.postgresVersion = await sql(dbName, "SHOW server_version;", "postgres-version"); assert.match(result.postgresVersion, /^16\./);
    await installAndGenerate(baselineDirectory, "baseline"); await installAndGenerate(sourceDirectory, "source");
    for (const directory of [baselineDirectory, sourceDirectory]) {
      const receipt = await run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "import { EXACT_NUMERIC_FIELDS } from './backend/src/domain/money/exact-money-fields.ts'; console.log(JSON.stringify(EXACT_NUMERIC_FIELDS));"], "official-money-registry", { cwd: directory });
      const registry = JSON.parse(receipt.stdout.toString("utf8"));
      if (moneyRegistry) assert.deepEqual(registry, moneyRegistry); else moneyRegistry = registry;
    }
    result.coverage.moneyFields = moneyRegistry.map((field) => `${field.model}.${field.legacyField}`);
    result.moneyRegistrySha256 = sha256(JSON.stringify(moneyRegistry));
    const matrixRoot = path.join(scratch, "storage-matrix"); await mkdir(matrixRoot);
    const matrix = await run(process.execPath, [path.join(root, "ops/fixtures/restore-recovery-storage.mjs"), "--source-root", sourceDirectory, "--owned-root", matrixRoot], "current-source-eight-layout-storage-matrix");
    result.storageMatrix = JSON.parse(matrix.stdout.toString("utf8")); assert.equal(result.storageMatrix.success, true);
    check("current-source-eight-layout-storage-matrix", { combinations: result.storageMatrix.cases.length });
    await migrate(baselineDirectory, dbName, "baseline-42-migrations");
    assert.equal(Number(await sql(dbName, 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;', "baseline-applied-count")), 42);
    await run("npm", ["run", "prisma:seed", "-w", "backend"], "historical-synthetic-demo-seed", { cwd: baselineDirectory, extraEnv: { ...clients.get(baselineDirectory), DATABASE_URL: databaseUrl } });
    for (const fixture of ["compat-fixture.mjs", "restore-recovery-seed.mjs"]) await run(process.execPath, ["--import", "tsx", fixture], fixture, { cwd: baselineDirectory, extraEnv: { ...clients.get(baselineDirectory), DATABASE_URL: databaseUrl } });
    await verifyMoney(baselineDirectory, dbName, "schema42");
    result.snapshots.baseline42 = await snapshot(dbName);
    const beforeMigration = await sql(dbName, preservedQuery, "baseline-money-tenant-file-projection");
    const beforeJson = JSON.parse(beforeMigration);
    assert.equal(beforeJson.tenants.length, 2); assert.equal(beforeJson.files.length, 2);
    assert.equal(beforeJson.vehicles.find((item) => item.id === "compat_vehicle").purchasePriceExact, 1234.56);
    assert.equal(beforeJson.booking.find((item) => item.id === "compat_booking").expectedTotalExact, 240.12);
    check("historical-two-tenant-exact-money-registered-file-fixture");
    const backupUploads = path.join(options.evidenceDirectory, "uploads"); await cp(uploadDirectory, backupUploads, { recursive: true });
    const dump42 = path.join(options.evidenceDirectory, "synthetic-schema42.sql"); const manifest42 = await manifestFor(dbName, dump42, backupUploads, 42);
    await migrate(sourceDirectory, dbName, "source-42-to-48-migrations");
    assert.equal(Number(await sql(dbName, 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;', "source-applied-count")), 48);
    assert.equal(await sql(dbName, preservedQuery, "migrated-money-tenant-file-projection"), beforeMigration);
    await verifyMoney(sourceDirectory, dbName, "schema48");
    await verifyBackupBundle({ dumpPath: dump42, uploadRoot: uploadDirectory, manifest: manifest42 });
    check("42-to-48-preserves-money-tenants-and-upload-registration");
    await sql(dbName, `UPDATE "EmailQueue" SET "deduplicationKey"='synthetic-restore-pending-dedup', "processingToken"='synthetic-worker-lease', "processingStartedAt"='2026-01-09 10:00:00', "leaseExpiresAt"='2026-01-09 10:05:00' WHERE id='restore_pending_email';
      INSERT INTO "ScheduledReportCursor" ("tenantId","settingsAuditLogId","timeZone","nextRunAt","lastQueuedFor","updatedAt") VALUES ('restore_tenant_b','synthetic_restore_settings','Europe/Rome','2026-01-10 10:00:00','2026-01-09 10:00:00','2026-01-09 10:00:00');`, "synthetic-schema48-lease-dedup-cursor-fixture");
    const stateQuery = `SELECT jsonb_build_object('suspended',(SELECT status FROM "User" WHERE id='restore_suspended_user'),'revoked',(SELECT "revokedAt" FROM "RefreshSession" WHERE id='restore_revoked_session'),'pending',(SELECT jsonb_build_object('status',status,'deduplicationKey',"deduplicationKey",'processingToken',"processingToken",'processingStartedAt',"processingStartedAt",'leaseExpiresAt',"leaseExpiresAt") FROM "EmailQueue" WHERE id='restore_pending_email'),'cursor',(SELECT to_jsonb(c) FROM "ScheduledReportCursor" c WHERE "tenantId"='restore_tenant_b'))::text;`;
    const expectedStates = await sql(dbName, stateQuery, "auth-worker-report-state-before-smoke");
    assert.equal(JSON.parse(expectedStates).suspended, "SUSPENDED"); assert(JSON.parse(expectedStates).revoked); assert.equal(JSON.parse(expectedStates).pending.status, "PENDING");
    result.coverage.storageLayout = "Current source: modern tenants/<tenant>/... and historical uploads/<tenant>/... under relative and absolute roots. Historical app: legacy relative keys only; modern-key fallback is not proven or approved.";
    await smoke(baselineDirectory, dbName, uploadDirectory, "historical-app-on-schema48", manifest42);
    assert.equal(await sql(dbName, stateQuery, "historical-app-keeps-suspended-revoked-pending-cursor-state"), expectedStates);
    check("historical-app-keeps-suspended-revoked-pending-lease-dedup-cursor-state");
    for (const [suffix, tenantId] of [["a", "demo_tenant"], ["b", "restore_tenant_b"]]) {
      const key = `tenants/${tenantId}/vehicle-booklets/restore-${suffix}-modern.pdf`;
      const bytes = await readFile(path.join(uploadDirectory, `uploads/${tenantId}/vehicle-booklets/restore-${suffix}.pdf`));
      await mkdir(path.dirname(path.join(uploadDirectory, key)), { recursive: true }); await writeFile(path.join(uploadDirectory, key), bytes, { flag: "wx" });
      await sql(dbName, `INSERT INTO "VehicleBooklet" SELECT (jsonb_populate_record(NULL::"VehicleBooklet", to_jsonb(b) || jsonb_build_object('id','restore_booklet_${suffix}_modern','vehicleId','restore_money_${suffix}_zero_Vehicle','filePath','${key}','fileName','restore-${suffix}-modern.pdf'))).* FROM "VehicleBooklet" b WHERE id='restore_booklet_${suffix}';
        INSERT INTO "StoredFileObject" SELECT (jsonb_populate_record(NULL::"StoredFileObject", to_jsonb(f) || jsonb_build_object('id','restore_file_${suffix}_modern','storageKey','${key}','resourceId','restore_booklet_${suffix}_modern','originalName','restore-${suffix}-modern.pdf'))).* FROM "StoredFileObject" f WHERE id='restore_file_${suffix}';`, `register-synthetic-modern-file-${suffix}`);
    }
    await cp(uploadDirectory, backupUploads, { recursive: true });
    if (options.applicationRecovery) {
      result.platformSessionSecurity = { seed: await runRestoreRecoverySecurityFixture({ run, directory: sourceDirectory, engines: clients.get(sourceDirectory), databaseUrl, phase: "seed", label: "platform-session-revocation-seed-before-backup48" }) };
      check("platform-session-revocation-seeded-before-backup48", result.platformSessionSecurity.seed);
    }
    // Snapshot before each restored app starts, since login/audits legitimately add rows.
    result.snapshots.migrated48 = await snapshot(dbName);
    const dump48 = path.join(options.evidenceDirectory, "synthetic-schema48.sql"); const manifest48 = await manifestFor(dbName, dump48, backupUploads, 48);
    for (const suffix of ["first", "second"]) {
      const name = `fleetum_restore_${id}_${suffix}`; const uploads = path.join(scratch, `uploads-${suffix}`);
      await restore(dump48, manifest48, name, backupUploads, uploads);
      result.snapshots[suffix] = await snapshot(name); assert.deepEqual(result.snapshots[suffix], result.snapshots.migrated48);
      if (options.applicationRecovery) {
        const security = await runRestoreRecoverySecurityFixture({ run, directory: sourceDirectory, engines: clients.get(sourceDirectory), databaseUrl: urlFor(name), phase: "check", label: `platform-session-revocation-check-${suffix}-restore`, expectedReceipt: result.platformSessionSecurity.seed });
        result.platformSessionSecurity[`${suffix}Restore`] = security;
        check(`platform-session-revocation-preserved-after-${suffix}-restore`, security);
      }
      check(`restore-${suffix}-canonical-all-tables-and-files-match`);
      await verifyMoney(sourceDirectory, name, `${suffix}-restore`);
      for (const uploadMode of ["relative", "absolute"]) await smoke(sourceDirectory, name, uploads, `source-app-after-${suffix}-restore-${uploadMode}`, manifest48, { uploadMode, includeModern: true });
      assert.equal(await sql(name, stateQuery, `${suffix}-restored-auth-worker-report-state`), expectedStates);
      check(`${suffix}-restore-keeps-suspended-revoked-pending-lease-dedup-cursor-state`);
    }
    const first = `fleetum_restore_${id}_first`;
    if (options.applicationRecovery) {
      await installAndGenerate(reserveDirectory, "reserve");
      result.applicationBuild = await buildApplicationRecoveryPair({ run, directory: reserveDirectory, engines: clients.get(reserveDirectory), databaseUrl: urlFor(first), productionBuild: options.productionBuild ?? false });
      const registered = await materializeRegisteredUploads({ manifest: manifest48, uploadTree: backupUploads, destination: path.join(reserveDirectory, "uploads") });
      const verifyReserveFiles = async () => {
        for (const file of registered.files) {
          const actual = await readFile(path.join(reserveDirectory, "uploads", file.targetKey));
          assert.equal(sha256(actual), file.sha256); assert.equal(actual.length, file.sizeBytes);
        }
      };
      const runHttpSmoke = async (base, label) => {
        const response = await run(process.execPath, ["restore-recovery-http.mjs"], `application-${label}`, { cwd: reserveDirectory, extraEnv: { ...clients.get(reserveDirectory), DATABASE_URL: urlFor(first), SYNTHETIC_APPLICATION_RECOVERY: "true", SYNTHETIC_HTTP_BASE: `${base}/api`, SYNTHETIC_PLATFORM_SECURITY: "true", SYNTHETIC_PLATFORM_HTTP_BASE: `${base}/platform-api`, SYNTHETIC_WRITE_NOTE: `Synthetic recovery ${label}`, SYNTHETIC_UPLOAD_TREE: backupUploads, SYNTHETIC_INCLUDE_MODERN_FILES: "true" }, timeoutMs: 30000, allowFailure: true });
        const failure = parseHttpFailure(Buffer.concat([response.stdout, response.stderr]).toString("utf8"));
        if (response.code !== 0 || failure) { result.http[`application-${label}`] = { success: false, exitCode: response.code, diagnostic: failure }; throw new Error(`Application HTTP smoke failed at ${failure?.stepLabel ?? "unknown"}: ${failure?.errorName ?? "Error"}`); }
        const line = response.stdout.toString("utf8").split("\n").find((value) => value.startsWith("FLEETUM_RESTORE_HTTP_RESULT ")); assert(line);
        const receipt = JSON.parse(line.slice("FLEETUM_RESTORE_HTTP_RESULT ".length));
        for (const name of ["platform-revoked-valid-bearer-denied", "platform-independent-bearer-authorized"]) assert(receipt.checks?.includes(name), "Compiled HTTP fixture must verify persisted Platform session revocation and an independent valid bearer");
        result.http[`application-${label}`] = { ...receipt, uploadMode: "absolute", materializedFiles: registered.fileCount, existingCompiledApplication: true }; check(`application-${label}`, result.http[`application-${label}`]);
      };
      // The budget is a fixed local test bound, selected before observation; it is not an externally approved SLA.
      result.applicationRecovery = await exerciseApplicationRecovery({ archiveRoot: reserveDirectory, sourceSha: options.recoverySourceSha, buildNodeEnv: result.applicationBuild.nodeEnv, env: { ...env, ...clients.get(reserveDirectory), DATABASE_URL: urlFor(first), UPLOAD_DIR: path.join(reserveDirectory, "uploads") }, snapshot: () => snapshot(first), runHttpSmoke, budgetMs: 30000 });
      assert.equal(result.applicationRecovery.success, true);
      for (const scenario of result.applicationRecovery.scenarios) check(`application-recovery-${scenario.mode}`, { recoveryMs: scenario.recoveryMs, acknowledgedDataLoss: scenario.acknowledgedDataLoss });
      await verifyReserveFiles(); await verifyBackupBundle({ dumpPath: dump48, uploadRoot: backupUploads, manifest: manifest48 });
      await verifyMoney(sourceDirectory, first, "after-application-recovery");
      assert.equal(await sql(first, stateQuery, "recovery-keeps-suspended-revoked-pending-cursor-state"), expectedStates);
      check("application-recovery-preserves-money-registered-files-auth-and-worker-states");
    }
    const existingBefore = await snapshot(first);
    const existing = await run("bash", [path.join(root, "ops/restore-db-test.sh"), dump48, container, first, dbUser], "existing-target-refusal", { allowFailure: true });
    assert.notEqual(existing.code, 0); assert.deepEqual(await snapshot(first), existingBefore); check("existing-target-refused-with-all-tables-unchanged");
    const sqlErrorFile = path.join(scratch, "synthetic-sql-error.sql");
    await writeFile(sqlErrorFile, "CREATE TABLE synthetic_before_error (id integer);\nINSERT INTO definitely_missing_rehearsal_table VALUES (1);\n");
    const errorDb = `fleetum_restore_${id}_sqlerror`;
    const sqlError = await run("bash", [path.join(root, "ops/restore-db-test.sh"), sqlErrorFile, container, errorDb, dbUser], "sql-error-restore-refusal", { allowFailure: true });
    assert.notEqual(sqlError.code, 0);
    assert.equal(await sql(errorDb, "SELECT count(*) FROM pg_tables WHERE schemaname='public';", "sql-error-single-transaction-no-partial-tables"), "0"); check("sql-error-nonzero-and-single-transaction-rolls-back");
    for (const [label, bytes] of [["tampered", Buffer.from(`${await readFile(dump48, "utf8")}\n-- tamper\n`)], ["truncated", (await readFile(dump48)).subarray(0, 100)]]) {
      const invalid = path.join(scratch, `${label}.sql`); await writeFile(invalid, bytes);
      await assert.rejects(verifyBackupBundle({ dumpPath: invalid, uploadRoot: backupUploads, manifest: manifest48 }), /digest or size mismatch/); check(`${label}-backup-rejected-before-restore`);
    }
    const brokenUploads = path.join(scratch, "broken-uploads"); await cp(backupUploads, brokenUploads, { recursive: true });
    const upload = manifest48.uploads[0]; const filePath = path.join(brokenUploads, upload.key); const original = await readFile(filePath);
    await rm(filePath); await assert.rejects(verifyBackupBundle({ dumpPath: dump48, uploadRoot: brokenUploads, manifest: manifest48 }), /missing/); check("missing-registered-upload-rejected");
    await writeFile(filePath, Buffer.from("tampered synthetic upload")); await assert.rejects(verifyBackupBundle({ dumpPath: dump48, uploadRoot: brokenUploads, manifest: manifest48 }), /digest or size mismatch/); check("tampered-registered-upload-rejected"); await writeFile(filePath, original);
    const duplicateDb = `fleetum_restore_${id}_duplicate`; await restore(dump42, manifest42, duplicateDb, backupUploads);
    await sql(duplicateDb, `INSERT INTO "RentalDeposit" SELECT (jsonb_populate_record(NULL::"RentalDeposit",to_jsonb(d) || '{"id":"restore_duplicate_deposit","stripePaymentIntentId":"pi_restore_duplicate"}'::jsonb)).* FROM "RentalDeposit" d WHERE id='compat_deposit';`, "synthetic-duplicate-active-deposit-insert");
    const depositQuery = 'SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY id),\'[]\')::text FROM "RentalDeposit" d;';
    const duplicateBefore = await sql(duplicateDb, depositQuery, "duplicate-deposit-before");
    const duplicateMigration = await migrate(sourceDirectory, duplicateDb, "duplicate-active-deposit-migration-refusal", { allowFailure: true });
    assert.notEqual(duplicateMigration.code, 0); assert.match(Buffer.concat([duplicateMigration.stdout, duplicateMigration.stderr]).toString("utf8"), /duplicate active deposits exist/);
    assert.equal(await sql(duplicateDb, depositQuery, "duplicate-deposit-after"), duplicateBefore);
    assert.equal(await sql(duplicateDb, `SELECT to_regclass('public."RentalDeposit_one_active_per_booking_uidx"') IS NULL;`, "duplicate-index-absent"), "t"); check("duplicate-authorized-deposits-stop-migration-with-rows-preserved");
    const lockDb = `fleetum_restore_${id}_lock`; await restore(dump42, manifest42, lockDb, backupUploads);
    const lockBefore = await sql(lockDb, depositQuery, "lock-deposit-before");
    const activeMigration = await readFile(path.join(sourceDirectory, "backend/prisma/migrations/20260914143000_rental_deposit_active_claim/migration.sql"), "utf8");
    const lockApplication = `restore_lock_${id}`;
    const holder = await docker(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", dbUser, "-d", lockDb], "synthetic-lock-holder", { input: `SET application_name='${lockApplication}'; BEGIN; LOCK TABLE "RentalDeposit" IN ROW EXCLUSIVE MODE; SELECT pg_sleep(15); ROLLBACK;`, background: true, allowFailure: true, timeoutMs: 20000 });
    try {
      let locked = false;
      for (let i = 0; i < 20 && !locked; i++) {
        locked = (await sql(lockDb, `SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='${lockApplication}' AND l.mode='RowExclusiveLock' AND l.granted);`, "wait-owned-synthetic-lock")) === "t";
        if (!locked) await sleep(100);
      }
      assert(locked, "synthetic table lock acquired");
      for (const [name, settings, pattern] of [["lock-timeout", "SET LOCAL lock_timeout='750ms'; SET LOCAL statement_timeout='3s';", /lock timeout/], ["statement-timeout", "SET LOCAL lock_timeout='0'; SET LOCAL statement_timeout='250ms';", /statement timeout/]]) {
        const attempt = await docker(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "--single-transaction", "--file=-", "-U", dbUser, "-d", lockDb], `active-index-${name}`, { input: `${settings}\n${activeMigration}`, allowFailure: true, timeoutMs: 5000 });
        assert.notEqual(attempt.code, 0); assert.match(attempt.stderr.toString("utf8"), pattern);
        assert.equal(await sql(lockDb, depositQuery, `${name}-rows-preserved`), lockBefore);
        assert.equal(await sql(lockDb, `SELECT to_regclass('public."RentalDeposit_one_active_per_booking_uidx"') IS NULL;`, `${name}-index-absent`), "t"); check(`active-index-${name}-stops-with-rows-preserved`);
      }
    } finally {
      await sql(lockDb, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='${lockApplication}' AND datname='${lockDb}';`, "terminate-owned-synthetic-lock"); await holder.completion;
    }
    result.coverage.allMoneyFieldsExercised = true;
    result.success = true;
  } catch (error) {
    result.failure = error.message; process.exitCode = 1;
  } finally {
    for (const child of children) kill(child); await sleep(100); for (const child of children) kill(child, "SIGKILL");
    if (containerCreated) {
      const removed = await docker(["rm", "-f", container], "owned-container-cleanup", { allowFailure: true, cleaning: true, timeoutMs: 15000 }).catch(() => ({ code: 1 }));
      const absent = await docker(["container", "inspect", container], "owned-container-absence", { allowFailure: true, cleaning: true, timeoutMs: 5000 }).catch(() => ({ code: 0 }));
      result.cleanup.container = removed.code === 0 && absent.code !== 0 ? "removed-and-verified" : "cleanup-failed";
    } else result.cleanup.container = "not-created";
    if (networkCreated) {
      const removed = await docker(["network", "rm", network], "owned-network-cleanup", { allowFailure: true, cleaning: true, timeoutMs: 10000 }).catch(() => ({ code: 1 }));
      const absent = await docker(["network", "inspect", network], "owned-network-absence", { allowFailure: true, cleaning: true, timeoutMs: 5000 }).catch(() => ({ code: 0 }));
      result.cleanup.network = removed.code === 0 && absent.code !== 0 ? "removed-and-verified" : "cleanup-failed";
    } else result.cleanup.network = "not-created";
    await rm(scratch, { recursive: true, force: true });
    result.cleanup.scratch = "removed"; result.interrupted = interrupted; result.durationMs = Math.round(performance.now() - started);
    result.success = result.success && !interrupted && result.cleanup.container === "removed-and-verified" && result.cleanup.network === "removed-and-verified";
    process.removeListener("SIGINT", signalHandler); process.removeListener("SIGTERM", signalHandler);
    await mkdir(options.evidenceDirectory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(options.evidenceDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseRestoreRecoveryOptions(process.argv.slice(2));
    if (options.help) console.log(usage);
    else {
      console.log("[restore-recovery] Starting bounded local synthetic restore rehearsal");
      const result = await runRestoreRecovery(options);
      console.log(`[restore-recovery] ${result.success ? "PASS" : "FAIL"}; ${result.checks.length} checks; ${result.durationMs}ms; evidence ${options.evidenceDirectory}/result.json`);
      if (result.failure) console.error(result.failure);
      process.exitCode = result.success ? 0 : 1;
    }
  } catch (error) { console.error(error.message); console.error(usage); process.exitCode = 1; }
}
