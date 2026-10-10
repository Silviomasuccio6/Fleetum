import { lstat, open, realpath, unlink } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectNativeImageRuntimes, PLATFORM_SYNTHETIC_ADMIN_EMAIL, PLATFORM_SYNTHETIC_JWT_SECRET } from "./restore-recovery-security.mjs";

const MARKER = "FLEETUM_APPLICATION_SERVER";
const MODES = new Set(["trusted", "startup-rejected", "database-unready", "pause-before-import"]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SAFE_ERROR_NAMES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "AbortError", "PrismaClientInitializationError", "PrismaClientKnownRequestError", "PrismaClientValidationError"]);
// Keep the Darwin rehearsal boundary; Linux fixtures use only /tmp, never an
// inherited TMPDIR or an arbitrary caller-selected scratch parent.
const OWNED_ARCHIVE = process.platform === "linux"
  ? /^\/tmp\/fleetum-restore-recovery-[A-Za-z0-9-]+\/(source|baseline|reserve)$/
  : /^\/private\/tmp\/fleetum-restore-recovery-[A-Za-z0-9-]+\/(source|baseline|reserve)$/;

const requireGuard = (condition, message) => { if (!condition) throw new Error(message); };
const canonical = (value) => typeof value === "string" && path.isAbsolute(value) && path.normalize(value) === value;
const childOf = (value, directory) => canonical(value) && value.startsWith(`${directory}/`);

// Pure validation: importing this fixture never imports Fleetum, opens a socket,
// reads dotenv, mutates process.env or touches a database/provider.
export function parseServerConfig({ argv, env } = {}) {
  requireGuard(Array.isArray(argv) && argv.length === 2, "Expected explicit archive and source SHA");
  requireGuard(env && typeof env === "object", "Expected an explicit test environment");
  const [archiveRoot, sourceSha] = argv;
  requireGuard(canonical(archiveRoot) && OWNED_ARCHIVE.test(archiveRoot), "Archive must be an owned recovery scratch child");
  requireGuard(typeof sourceSha === "string" && /^[a-f0-9]{40}$/.test(sourceSha), "Expected a full source SHA");
  requireGuard(env.NODE_ENV === "test", "NODE_ENV must be test");
  requireGuard(env.DOTENV_CONFIG_PATH === "/dev/null", "Dotenv must use /dev/null");
  for (const name of ["NODE_OPTIONS", "DOTENV_CONFIG_ENCODING", "DOTENV_CONFIG_OVERRIDE", "DOTENV_CONFIG_DEBUG"]) {
    requireGuard(!env[name], "Runtime configuration injection is forbidden");
  }
  requireGuard(MODES.has(env.LOCAL_RECOVERY_MODE), "Expected an explicit recovery mode");
  requireGuard(typeof env.LOCAL_GENERATION === "string" && UUID.test(env.LOCAL_GENERATION), "Expected a generation UUID");
  const generation = env.LOCAL_GENERATION;
  const readyFile = env.LOCAL_READY_FILE;
  requireGuard(readyFile === `${archiveRoot}/recovery-state/${generation}.json`, "Ready file must belong to this archive and generation");
  const uploadDirectory = env.UPLOAD_DIR;
  requireGuard(childOf(uploadDirectory, archiveRoot), "Uploads must remain inside this archive");
  let database;
  try { database = new URL(env.DATABASE_URL); } catch { throw new Error("Expected a synthetic loopback database URL"); }
  requireGuard(["postgresql:", "postgres:"].includes(database.protocol) && database.hostname === "127.0.0.1" && /^[0-9]+$/.test(database.port) && Number(database.port) >= 1 && Number(database.port) <= 65535, "Database must use an explicit loopback PostgreSQL port");
  requireGuard(/^\/fleetum_restore_[a-f0-9]{32}_(first|second)$/.test(database.pathname) && database.username === "fleetum_restore" && database.password.length > 0 && database.hash === "", "Database must be a restored synthetic target");
  const query = [...database.searchParams.entries()];
  requireGuard(new Set(query.map(([name]) => name)).size === query.length && query.every(([name, value]) => (name === "schema" && value === "public") || (name === "connect_timeout" && /^[1-9]$/.test(value))), "Database URL options must stay synthetic and local");
  const engineEnvironment = {};
  for (const name of ["PRISMA_QUERY_ENGINE_LIBRARY", "PRISMA_SCHEMA_ENGINE_BINARY"]) {
    if (env[name] !== undefined) {
      requireGuard(childOf(env[name], archiveRoot), "Generated engines must remain inside this archive");
      engineEnvironment[name] = env[name];
    }
  }
  return Object.freeze({ archiveRoot, sourceSha, generation, mode: env.LOCAL_RECOVERY_MODE, readyFile, uploadDirectory, databaseUrl: database.href, engineEnvironment: Object.freeze(engineEnvironment) });
}

async function assertOwnedPaths(config) {
  // Parent directories are precreated by the orchestrator. Never follow a
  // symlink or create archive/runtime directories on behalf of this child.
  const directories = new Set([config.archiveRoot, config.uploadDirectory, path.dirname(config.readyFile)]);
  const files = [path.join(config.archiveRoot, "backend/dist/app.js"), path.join(config.archiveRoot, "backend/dist/infrastructure/database/prisma/client.js"), ...Object.values(config.engineEnvironment)];
  for (const filename of [...directories, ...files]) {
    let cursor = "/";
    for (const component of filename.split("/").filter(Boolean)) {
      cursor = path.join(cursor, component);
      const metadata = await lstat(cursor);
      requireGuard(!metadata.isSymbolicLink(), "Owned paths must not contain symlinks");
    }
    requireGuard(await realpath(filename) === filename, "Owned paths must have canonical real paths");
    const metadata = await lstat(filename);
    requireGuard(directories.has(filename) ? metadata.isDirectory() : metadata.isFile(), "Owned runtime path has the wrong file type");
  }
  for (const relative of [".env", "backend/.env", "prisma/.env", "backend/prisma/.env"]) {
    try {
      await lstat(path.join(config.archiveRoot, relative));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    throw new Error("Archive must not contain runtime dotenv files");
  }
}

export function buildServerEnvironment(config) {
  const database = new URL(config.databaseUrl);
  if (config.mode === "database-unready") {
    database.port = "1";
    database.searchParams.set("connect_timeout", "1");
  }
  // None of the caller's provider values, dotenv options or auth secrets are
  // inherited. These are deliberately synthetic credentials for this process.
  const cleanEnvironment = {
    NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null",
    DATABASE_URL: database.href, UPLOAD_DIR: config.uploadDirectory,
    HOME: path.join(path.dirname(config.archiveRoot), "home"), TMPDIR: path.dirname(config.archiveRoot),
    FLEETUM_ENVIRONMENT: "production", STORAGE_PROVIDER: "local",
    JWT_SECRET: config.mode === "startup-rejected" ? "short" : "synthetic-restore-jwt-only-000000000000000000000000",
    PLATFORM_JWT_SECRET: PLATFORM_SYNTHETIC_JWT_SECRET, PLATFORM_ADMIN_EMAIL: PLATFORM_SYNTHETIC_ADMIN_EMAIL,
    RESEND_API_KEY: "re_ci_placeholder", RESEND_FROM: "Synthetic restore <restore@example.invalid>",
    APP_URL: "http://127.0.0.1:5173", BACKEND_PUBLIC_URL: "http://127.0.0.1:4000",
    CORS_ORIGIN: "http://127.0.0.1:5173", PLATFORM_CORS_ORIGIN: "http://127.0.0.1:5174",
    PLATFORM_IP_ALLOWLIST_MODE: "strict", PLATFORM_ALLOWED_IPS: "127.0.0.1",
    PRIVACY_RETENTION_CRON_ENABLED: "false", PRIVACY_RETENTION_GLOBAL_ENABLED: "false", BILLING_DUNNING_CRON_ENABLED: "false",
    PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1",
    ...config.engineEnvironment
  };
  return cleanEnvironment;
}

function isolateApplicationEnvironment(config) {
  const cleanEnvironment = buildServerEnvironment(config);
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, cleanEnvironment);
  process.chdir(config.archiveRoot);
}

function blockProviderHttp() {
  const blocked = () => { throw new Error("ProviderHttpBlocked"); };
  for (const module of [http, https]) { module.request = blocked; module.get = blocked; }
  globalThis.fetch = blocked;
  syncBuiltinESMExports();
}

function listen(app) {
  const server = http.createServer(app);
  return {
    server,
    listening: new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    })
  };
}

async function runServer(config, emit) {
  const servers = []; let prisma; let ownedReadyStat; let stopping = false;
  async function removeOwnReadyFile() {
    if (!ownedReadyStat) return;
    try {
      const current = await lstat(config.readyFile);
      if (current.isFile() && !current.isSymbolicLink() && current.dev === ownedReadyStat.dev && current.ino === ownedReadyStat.ino) await unlink(config.readyFile);
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  async function stop(code) {
    if (stopping) return;
    stopping = true;
    // Completion is bounded even if a driver or pending connection stalls.
    const timer = setTimeout(() => process.exit(code), 2500);
    try {
      const closed = servers.map((server) => new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }));
      await Promise.allSettled([...closed, prisma ? prisma.$disconnect() : Promise.resolve(), removeOwnReadyFile()]);
    } finally { clearTimeout(timer); process.exit(code); }
  }
  process.once("SIGTERM", () => { void stop(0); });
  process.once("SIGINT", () => { void stop(0); });
  const reportFailure = (error) => {
    emit({ phase: "failed", generation: config.generation, sourceSha: config.sourceSha, errorName: SAFE_ERROR_NAMES.has(error?.name) ? error.name : "Error" });
    void stop(1);
  };
  process.once("uncaughtException", reportFailure);
  process.once("unhandledRejection", reportFailure);
  async function publish(payload) {
    const file = await open(config.readyFile, "wx", 0o600);
    try {
      ownedReadyStat = await file.stat();
      await file.writeFile(`${JSON.stringify(payload)}\n`);
      await file.sync();
    } finally { await file.close(); }
    emit(payload);
  }
  try {
    await assertOwnedPaths(config);
    // Validate ready-file uniqueness before executing any application import.
    try {
      await lstat(config.readyFile);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      isolateApplicationEnvironment(config);
      blockProviderHttp();
      if (config.mode === "pause-before-import") {
        await publish({ phase: "starting", generation: config.generation, sourceSha: config.sourceSha });
        setInterval(() => {}, 1000);
        return;
      }
      const { createApp, createPlatformApp } = await import(pathToFileURL(path.join(config.archiveRoot, "backend/dist/app.js")).href);
      ({ prisma } = await import(pathToFileURL(path.join(config.archiveRoot, "backend/dist/infrastructure/database/prisma/client.js")).href));
      const nativeImageRuntime = await inspectNativeImageRuntimes(config.archiveRoot);
      const api = listen(createApp()); servers.push(api.server);
      const platform = listen(createPlatformApp()); servers.push(platform.server);
      const [apiPort, platformPort] = await Promise.all([api.listening, platform.listening]);
      await publish({ phase: "listening", apiPort, platformPort, generation: config.generation, sourceSha: config.sourceSha, nativeImageRuntime });
      return;
    }
    throw new Error("Ready file already exists");
  } catch (error) { reportFailure(error); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Preserve only the private writer used for our bounded marker. Suppressing
  // app stdout/stderr before imports also stops raw Prisma diagnostics and
  // request logs from escaping into recovery evidence.
  const write = process.stdout.write.bind(process.stdout);
  const discard = (_chunk, encoding, callback) => { if (typeof encoding === "function") encoding(); else if (typeof callback === "function") callback(); return true; };
  process.stdout.write = discard; process.stderr.write = discard;
  const emit = (payload) => { write(`${MARKER} ${JSON.stringify(payload)}\n`); if (process.connected) process.send(payload); };
  try {
    const config = parseServerConfig({ argv: process.argv.slice(2), env: process.env });
    await runServer(config, emit);
  } catch (error) {
    emit({ phase: "failed", errorName: SAFE_ERROR_NAMES.has(error?.name) ? error.name : "Error" });
    process.exitCode = 1;
  }
}
