import { createHash, createHmac } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Synthetic fixture values only. The wrapper and the producer use the same
// secret; callers cannot override it with an inherited real environment value.
export const PLATFORM_SYNTHETIC_JWT_SECRET = "synthetic-restore-platform-jwt-only-000000000000000000000000000000000000000000000000000000000000";
export const PLATFORM_SYNTHETIC_ADMIN_EMAIL = "restore-platform@example.invalid";
const ACTION = "PLATFORM_SESSION_REVOKED";
const MARKER = "FLEETUM_RESTORE_SECURITY_JSON";
const guard = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = value => createHash("sha256").update(value).digest("hex");
const canonical = value => typeof value === "string" && path.isAbsolute(value) && path.normalize(value) === value;
// Keep the Darwin rehearsal boundary; Linux fixtures use only /tmp, never an
// inherited TMPDIR or an arbitrary caller-selected scratch parent.
const OWNED_ARCHIVE = process.platform === "linux"
  ? /^\/tmp\/fleetum-restore-recovery-[A-Za-z0-9-]+\/(source|reserve)$/
  : /^\/private\/tmp\/fleetum-restore-recovery-[A-Za-z0-9-]+\/(source|reserve)$/;
const ownedArchive = value => canonical(value) && OWNED_ARCHIVE.test(value);

// Importing this module is pure: no application, dependency, socket, DB, env
// file or process environment is touched until the explicit CLI is guarded.
export function parseSecurityConfig({ argv, env } = {}) {
  guard(Array.isArray(argv) && argv.length === 2, "Expected an explicit security mode and archive");
  const [mode, archiveRoot] = argv;
  guard(["seed", "check", "native"].includes(mode) && ownedArchive(archiveRoot), "Expected an owned current recovery archive");
  guard(env?.NODE_ENV === "test" && env.DOTENV_CONFIG_PATH === "/dev/null", "Security fixture requires test and disabled dotenv");
  for (const name of ["NODE_OPTIONS", "DOTENV_CONFIG_ENCODING", "DOTENV_CONFIG_OVERRIDE", "DOTENV_CONFIG_DEBUG"]) guard(!env[name], "Runtime configuration injection is forbidden");
  const engineEnvironment = {};
  for (const name of ["PRISMA_QUERY_ENGINE_LIBRARY", "PRISMA_SCHEMA_ENGINE_BINARY"]) if (env[name] !== undefined) {
    guard(canonical(env[name]) && env[name].startsWith(`${archiveRoot}/`), "Generated engines must remain in the current archive"); engineEnvironment[name] = env[name];
  }
  let databaseUrl;
  if (mode !== "native") {
    let url; try { url = new URL(env.DATABASE_URL); } catch { throw new Error("Expected a guarded synthetic database"); }
    guard(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" && /^[0-9]+$/.test(url.port) && Number(url.port) > 0 && Number(url.port) <= 65535, "Database must use explicit loopback PostgreSQL");
    guard(url.username === "fleetum_restore" && url.password.length > 0 && /^\/fleetum_restore_[a-f0-9]{32}_(source|first|second)$/.test(url.pathname) && !url.hash, "Expected a task-owned synthetic database");
    const options = [...url.searchParams.entries()];
    guard(new Set(options.map(([name]) => name)).size === options.length && options.every(([name, value]) => name === "schema" && value === "public" || name === "connect_timeout" && /^[1-9]$/.test(value)), "Database options must remain synthetic");
    if (mode === "seed") guard(archiveRoot.endsWith("/source") && url.pathname.endsWith("_source"), "Seed runs only on the current source before its dump");
    databaseUrl = url.href;
  }
  return Object.freeze({ mode, archiveRoot, databaseUrl, engineEnvironment: Object.freeze(engineEnvironment) });
}

export function parsePlatformHttpBase(env) {
  guard(env?.SYNTHETIC_PLATFORM_SECURITY === "true", "Platform probe requires its explicit current fixture flag");
  let url; try { url = new URL(env.SYNTHETIC_PLATFORM_HTTP_BASE); } catch { throw new Error("Expected an explicit local Platform HTTP prefix"); }
  guard(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port && url.pathname === "/platform-api" && !url.username && !url.password && !url.search && !url.hash && url.href === env.SYNTHETIC_PLATFORM_HTTP_BASE, "Platform HTTP must stay on its canonical loopback prefix");
  return url.href;
}

function expirySeconds(expiresAt, now) {
  const expiry = Date.parse(expiresAt);
  guard(typeof expiresAt === "string" && Number.isFinite(expiry) && new Date(expiry).toISOString() === expiresAt && expiry % 1000 === 0, "Expected a canonical synthetic expiry");
  guard(now instanceof Date && Number.isFinite(now.getTime()) && expiry > now.getTime(), "Synthetic bearer must still be valid during the proof");
  return expiry / 1000;
}

export function platformFixtureTokens(expiresAt, now = new Date()) {
  const exp = expirySeconds(expiresAt, now);
  const sign = jti => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ userId: "platform-admin", tenantId: "platform", roles: ["PLATFORM_ADMIN"], permissions: ["platform:manage"], platformAdmin: true, tokenType: "platform", jti, iat: exp - 86400, exp })).toString("base64url");
    const input = `${header}.${payload}`;
    return `${input}.${createHmac("sha256", PLATFORM_SYNTHETIC_JWT_SECRET).update(input).digest("base64url")}`;
  };
  // Bearers exist only in this helper's memory. Only expiry is persisted by the
  // real service, alongside its authoritative revocation token hash.
  return { revoked: sign("synthetic-recovery-revoked-session"), sibling: sign("synthetic-recovery-independent-session") };
}

async function currentSchema(prisma) {
  const rows = await prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
  guard(rows.length === 1 && Number(rows[0].count) === 48, "Security proof requires exactly 48 successful current migrations");
  guard(await prisma.platformAdminCredential.findUnique({ where: { email: PLATFORM_SYNTHETIC_ADMIN_EMAIL }, select: { id: true } }) === null, "Synthetic Platform reset cutoff must be absent");
}

export async function assertRestoreSecurityState(prisma, { now = new Date(), phase = "check" } = {}) {
  guard(["seed", "check"].includes(phase), "Expected an explicit security receipt phase");
  await currentSchema(prisma);
  const rows = await prisma.platformSecurityEvent.findMany({ where: { action: ACTION, actor: PLATFORM_SYNTHETIC_ADMIN_EMAIL }, select: { id: true, action: true, actor: true, details: true, createdAt: true } });
  guard(rows.length === 1, "Expected one durable synthetic Platform revocation");
  const row = rows[0]; const details = row.details;
  guard(details && typeof details === "object" && !Array.isArray(details) && Object.keys(details).sort().join(",") === "expiresAt,tokenHash", "Revocation must contain only its authoritative expiry and hash");
  const pair = platformFixtureTokens(details.expiresAt, now);
  guard(details.tokenHash === sha256(pair.revoked), "Persisted revocation must match the still-valid synthetic bearer");
  const siblings = await prisma.platformSecurityEvent.findMany({ where: { action: ACTION, details: { path: ["tokenHash"], equals: sha256(pair.sibling) } }, select: { id: true } });
  guard(siblings.length === 0, "Independent synthetic Platform bearer must remain unrevoked");
  guard(typeof row.id === "string" && row.id.length > 0 && row.action === ACTION && row.actor === PLATFORM_SYNTHETIC_ADMIN_EMAIL, "Unexpected synthetic revocation identity");
  const createdAt = new Date(row.createdAt); guard(Number.isFinite(createdAt.getTime()), "Expected a persistent revocation timestamp");
  const digest = sha256(JSON.stringify({ id: row.id, action: ACTION, actor: row.actor, createdAt: createdAt.toISOString(), details: { tokenHash: details.tokenHash, expiresAt: details.expiresAt } }));
  return { format: "fleetum-restore-security-v1", phase, localOnly: true, revocationRecords: 1, siblingRevocationRecords: 0, expiresAt: details.expiresAt, sha256: digest };
}

export async function seedRestoreSecurity(prisma, sessions, { now = new Date() } = {}) {
  await currentSchema(prisma);
  guard((await prisma.platformSecurityEvent.findMany({ where: { action: ACTION, actor: PLATFORM_SYNTHETIC_ADMIN_EMAIL }, select: { id: true } })).length === 0, "Security seed refuses an existing synthetic revocation");
  const expiresAt = new Date(Math.floor(now.getTime() / 1000) * 1000 + 86400000).toISOString();
  const { revoked } = platformFixtureTokens(expiresAt, now);
  // No fixture INSERT: the current product service verifies the token and owns
  // the real PostgreSQL transaction, advisory lock and durable event creation.
  guard((await sessions.logout(revoked))?.revoked === true, "Real Platform logout must acknowledge its committed revocation");
  return assertRestoreSecurityState(prisma, { now, phase: "seed" });
}

export function versionAtLeast(version, minimum) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const actual = version.split(".").map(Number);
  if (!actual.every(Number.isSafeInteger)) return false;
  for (let index = 0; index < 3; index++) { if (actual[index] > minimum[index]) return true; if (actual[index] < minimum[index]) return false; }
  return true;
}

async function ownedFile(filename, archiveRoot) {
  guard(canonical(filename) && filename.startsWith(`${archiveRoot}/`), "Loaded runtime files must belong to the current archive");
  let cursor = "/";
  for (const component of filename.split("/").filter(Boolean)) { cursor = path.join(cursor, component); guard(!(await lstat(cursor)).isSymbolicLink(), "Runtime paths must not traverse symlinks"); }
  const metadata = await lstat(filename);
  guard(metadata.isFile() && await realpath(filename) === filename, "Expected a canonical loaded runtime file");
  return metadata;
}

export async function buildLoadedNativeReceipt({ name, archiveRoot, versions, nativeFiles }) {
  guard(["backend", "Next"].includes(name) && ownedArchive(archiveRoot), "Expected an owned native runtime");
  guard(versionAtLeast(versions?.sharp, [0, 35, 5]) && versionAtLeast(versions?.rsvg, [2, 63, 2]), "Loaded sharp and native librsvg must contain the security patches");
  guard(Array.isArray(nativeFiles) && nativeFiles.some(filename => filename.endsWith(".node")), "A loaded native addon identity is required");
  const binaries = [];
  for (const filename of [...new Set(nativeFiles)].sort()) {
    guard(/\.(node|dylib|so(?:\.\d+)*)$/.test(filename) && /\/node_modules\/(?:@img\/sharp[^/]*|sharp)\//.test(filename), "Expected only loaded sharp native dependencies");
    const metadata = await ownedFile(filename, archiveRoot);
    binaries.push({ file: path.relative(archiveRoot, filename), sha256: sha256(await readFile(filename)), sizeBytes: metadata.size });
  }
  const limits = binaries.some(value => /vips/gi.test(value.file) && !value.file.endsWith(".node")) ? [] : ["The runtime did not enumerate a separate loaded libvips shared library; its linked librsvg identity is limited to the loaded runtime version and addon hash."];
  return { name, status: "verified", versions: { sharp: versions.sharp, rsvg: versions.rsvg }, syntheticSvg: { width: 10, height: 5, format: "png" }, binaries, limits };
}

export async function inspectNativeImageRuntimes(archiveRoot) {
  guard(ownedArchive(archiveRoot), "Native proof requires an owned current archive");
  const backendPackage = path.join(archiveRoot, "backend/package.json"); await ownedFile(backendPackage, archiveRoot);
  const backend = createRequire(backendPackage); const runtimes = [];
  const verify = async (name, require) => {
    const sharpEntry = require.resolve("sharp"); await ownedFile(sharpEntry, archiveRoot);
    const sharp = require("sharp");
    guard(versionAtLeast(sharp.versions?.sharp, [0, 35, 5]) && versionAtLeast(sharp.versions?.rsvg, [2, 63, 2]), "Loaded image stack is missing required security patches");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#267f9c"/></svg>');
    const rendered = await sharp(svg, { limitInputPixels: 1000 }).resize({ width: 10 }).png().toBuffer({ resolveWithObject: true });
    guard(rendered.info.width === 10 && rendered.info.height === 5 && rendered.info.format === "png" && rendered.data.length > 32 && rendered.data.length < 2048 && rendered.data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "Actual native image stack must render the bounded synthetic SVG");
    const loaded = [...Object.keys(require.cache), ...(process.report?.getReport().sharedObjects ?? [])];
    const nativeFiles = loaded.filter(filename => /\.(node|dylib|so(?:\.\d+)*)$/.test(filename) && /\/node_modules\/(?:@img\/sharp[^/]*|sharp)\//.test(filename));
    return buildLoadedNativeReceipt({ name, archiveRoot, versions: sharp.versions, nativeFiles });
  };
  runtimes.push(await verify("backend", backend));
  const website = createRequire(path.join(archiveRoot, "website/package.json"));
  let nextPackage;
  try { nextPackage = website.resolve("next/package.json"); } catch (error) { if (error?.code !== "MODULE_NOT_FOUND") throw error; }
  if (nextPackage) { await ownedFile(nextPackage, archiveRoot); runtimes.push(await verify("Next", createRequire(nextPackage))); }
  else runtimes.push({ name: "Next", status: "not-installed", limits: ["Next is not installed in this archive; its native image runtime is not covered."] });
  return { format: "fleetum-native-image-runtime-v1", localOnly: true, runtimes, limits: ["This receipt covers the loaded local host image stack, not a deployed container or live production.", "Dist artifact manifests do not cover node_modules or native dependencies."] };
}

function isolateSecurityEnvironment(config) {
  const clean = { NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null", DATABASE_URL: config.databaseUrl,
    JWT_SECRET: "synthetic-restore-jwt-only-000000000000000000000000", PLATFORM_JWT_SECRET: PLATFORM_SYNTHETIC_JWT_SECRET,
    PLATFORM_ADMIN_EMAIL: PLATFORM_SYNTHETIC_ADMIN_EMAIL, FLEETUM_ENVIRONMENT: "production", STORAGE_PROVIDER: "local",
    RESEND_API_KEY: "re_ci_placeholder", RESEND_FROM: "Synthetic restore <restore@example.invalid>",
    PRIVACY_RETENTION_CRON_ENABLED: "false", PRIVACY_RETENTION_GLOBAL_ENABLED: "false", BILLING_DUNNING_CRON_ENABLED: "false",
    PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1", ...config.engineEnvironment };
  for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, clean); process.chdir(config.archiveRoot);
  const blocked = () => { throw new Error("ProviderHttpBlocked"); };
  for (const module of [http, https]) { module.request = blocked; module.get = blocked; } globalThis.fetch = blocked; syncBuiltinESMExports();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const write = process.stdout.write.bind(process.stdout);
  const discard = (_chunk, encoding, callback) => { if (typeof encoding === "function") encoding(); else if (typeof callback === "function") callback(); return true; };
  process.stdout.write = discard; process.stderr.write = discard;
  let prisma;
  try {
    guard(/^22\.23\./.test(process.versions.node), "Use the pinned Node 22.23 runtime");
    const config = parseSecurityConfig({ argv: process.argv.slice(2), env: process.env });
    for (const relative of [".env", "backend/.env", "prisma/.env", "backend/prisma/.env"]) { let found = false; try { await lstat(path.join(config.archiveRoot, relative)); found = true; } catch (error) { if (error?.code !== "ENOENT") throw error; } guard(!found, "Archive must not contain runtime dotenv files"); }
    isolateSecurityEnvironment(config);
    let receipt;
    if (config.mode === "native") receipt = await inspectNativeImageRuntimes(config.archiveRoot);
    else {
      const client = path.join(config.archiveRoot, "backend/src/infrastructure/database/prisma/client.ts"); await ownedFile(client, config.archiveRoot);
      ({ prisma } = await import(pathToFileURL(client).href));
      if (config.mode === "seed") {
        const service = path.join(config.archiveRoot, "backend/src/application/services/platform-session-service.ts"); await ownedFile(service, config.archiveRoot);
        const { PlatformSessionService } = await import(pathToFileURL(service).href);
        receipt = await seedRestoreSecurity(prisma, new PlatformSessionService(prisma));
      } else receipt = await assertRestoreSecurityState(prisma);
    }
    write(`${MARKER} ${JSON.stringify(receipt)}\n`);
  } catch { write(`${MARKER} ${JSON.stringify({ format: "fleetum-restore-security-failure-v1", localOnly: true })}\n`); process.exitCode = 1; }
  finally { if (prisma) { try { await prisma.$disconnect(); } catch { process.exitCode = 1; } } }
}
