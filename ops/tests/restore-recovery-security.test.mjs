import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  assertRestoreSecurityState, buildLoadedNativeReceipt, inspectNativeImageRuntimes,
  parseSecurityConfig, parsePlatformHttpBase, platformFixtureTokens,
  PLATFORM_SYNTHETIC_ADMIN_EMAIL, PLATFORM_SYNTHETIC_JWT_SECRET,
  seedRestoreSecurity, versionAtLeast
} from "../fixtures/restore-recovery-security.mjs";

const scratchParent = process.platform === "linux" ? "/tmp" : "/private/tmp";
const otherScratchParent = process.platform === "linux" ? "/private/tmp" : "/tmp";
const archiveRoot = path.join(scratchParent, "fleetum-restore-recovery-security-test/source");
const databaseUrl = "postgresql://fleetum_restore:synthetic-only@127.0.0.1:54339/fleetum_restore_0123456789abcdef0123456789abcdef_source?schema=public";
const valid = () => ({ argv: ["seed", archiveRoot], env: { NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null", DATABASE_URL: databaseUrl } });
const now = new Date("2026-10-07T10:00:00.000Z");
const expiresAt = "2026-10-08T10:00:00.000Z";
const tokenHash = token => createHash("sha256").update(token).digest("hex");
const event = () => ({ id: "synthetic-event-id", action: "PLATFORM_SESSION_REVOKED", actor: PLATFORM_SYNTHETIC_ADMIN_EMAIL, createdAt: now, details: { tokenHash: tokenHash(platformFixtureTokens(expiresAt, now).revoked), expiresAt } });
const database = (rows = [], migrationCount = 48) => ({
  $queryRawUnsafe: async () => [{ count: BigInt(migrationCount) }],
  platformAdminCredential: { findUnique: async () => null },
  platformSecurityEvent: { findMany: async ({ where }) => rows.filter(row => row.action === where.action && (where.actor ? row.actor === where.actor : row.details.tokenHash === where.details.equals)) }
});

test("security seed is limited to current source schema48 and a guarded synthetic database", () => {
  assert.equal(parseSecurityConfig(valid()).mode, "seed");
  const wrongScratchParent = valid(); wrongScratchParent.argv[1] = `${otherScratchParent}/fleetum-restore-recovery-security-test/source`; assert.throws(() => parseSecurityConfig(wrongScratchParent));
  for (const value of ["baseline", "reserve"]) { const input = valid(); input.argv[1] = archiveRoot.replace("source", value); assert.throws(() => parseSecurityConfig(input)); }
  for (const [key, value] of [["NODE_ENV", "production"], ["DOTENV_CONFIG_PATH", ".env"], ["NODE_OPTIONS", "--import unsafe"], ["DATABASE_URL", databaseUrl.replace("127.0.0.1", "example.invalid")], ["DATABASE_URL", databaseUrl.replace("_source?", "_production?")]]) {
    const input = valid(); input.env[key] = value; assert.throws(() => parseSecurityConfig(input));
  }
  for (const suffix of ["first", "second"]) { const input = valid(); input.argv[0] = "check"; input.env.DATABASE_URL = databaseUrl.replace("_source?", `_${suffix}?`); assert.equal(parseSecurityConfig(input).mode, "check"); }
  const restoredSeed = valid(); restoredSeed.env.DATABASE_URL = databaseUrl.replace("_source?", "_first?"); assert.throws(() => parseSecurityConfig(restoredSeed));
});

test("platform probe accepts only the explicit local production fixture flag and real overview prefix", () => {
  assert.equal(parsePlatformHttpBase({ SYNTHETIC_PLATFORM_SECURITY: "true", SYNTHETIC_PLATFORM_HTTP_BASE: "http://127.0.0.1:54321/platform-api" }), "http://127.0.0.1:54321/platform-api");
  for (const url of ["http://127.0.0.1/platform-api", "https://127.0.0.1:54321/platform-api", "http://localhost:54321/platform-api", "http://127.0.0.1:54321/platform-api?secret=x", "http://user:secret@127.0.0.1:54321/platform-api", "http://127.0.0.1:54321/api", "http://127.0.0.1:54321/platform-api/"]) assert.throws(() => parsePlatformHttpBase({ SYNTHETIC_PLATFORM_SECURITY: "true", SYNTHETIC_PLATFORM_HTTP_BASE: url }));
  assert.throws(() => parsePlatformHttpBase({ SYNTHETIC_PLATFORM_HTTP_BASE: "http://127.0.0.1:54321/platform-api" }));
});

test("synthetic Platform pair is deterministic, distinct and unexpired with the wrapper secret", () => {
  const first = platformFixtureTokens(expiresAt, now); const second = platformFixtureTokens(expiresAt, now);
  assert(first.revoked === second.revoked && first.sibling === second.sibling && first.revoked !== first.sibling);
  for (const token of Object.values(first)) { const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url")); assert.equal(claims.exp, Date.parse(expiresAt) / 1000); assert.equal(claims.tokenType, "platform"); assert.equal(claims.platformAdmin, true); }
  assert(PLATFORM_SYNTHETIC_JWT_SECRET.length >= 80);
  assert.throws(() => platformFixtureTokens(expiresAt, new Date("2026-10-09T00:00:00Z")));
});

test("seed refuses old schema before invoking real session service and never inserts a revocation itself", async () => {
  let called = false; const sessions = { logout: async () => { called = true; } };
  await assert.rejects(seedRestoreSecurity(database([], 42), sessions, { now })); assert.equal(called, false);
  const rows = []; const db = database(rows); let token;
  const receipt = await seedRestoreSecurity(db, { logout: async value => { token = value; rows.push(event()); return { revoked: true }; } }, { now });
  assert.equal(receipt.revocationRecords, 1); assert.equal(receipt.siblingRevocationRecords, 0); assert.equal(rows.length, 1);
  assert(token === platformFixtureTokens(expiresAt, now).revoked);
  assert(!JSON.stringify(receipt).includes(token)); assert(!JSON.stringify(receipt).includes(PLATFORM_SYNTHETIC_JWT_SECRET));
});

test("snapshot receipt remains identical after independent restore and refuses revoked siblings or expiry drift", async () => {
  const before = await assertRestoreSecurityState(database([event()]), { now, phase: "seed" });
  const restored = await assertRestoreSecurityState(database([JSON.parse(JSON.stringify(event()))]), { now, phase: "check" });
  assert.equal(before.sha256, restored.sha256); assert.equal(before.expiresAt, expiresAt);
  for (const rows of [[], [event(), event()], [{ ...event(), details: { ...event().details, tokenHash: "0".repeat(64) } }], [{ ...event(), details: { ...event().details, unexpected: "synthetic-private-bearer" } }]]) await assert.rejects(assertRestoreSecurityState(database(rows), { now, phase: "check" }));
  const revokedSibling = { ...event(), actor: "another-synthetic-actor@example.invalid", details: { tokenHash: tokenHash(platformFixtureTokens(expiresAt, now).sibling), expiresAt } };
  await assert.rejects(assertRestoreSecurityState(database([event(), revokedSibling]), { now, phase: "check" }));
  await assert.rejects(assertRestoreSecurityState(database([event()]), { now: new Date("2026-10-09T00:00:00Z"), phase: "check" }));
});

test("missing native packages never manufacture backend or Next coverage", async () => {
  const scratch = await mkdtemp(path.join(scratchParent, "fleetum-restore-recovery-native-"));
  const root = path.join(scratch, "reserve");
  try { await mkdir(path.join(root, "backend"), { recursive: true }); await writeFile(path.join(root, "backend/package.json"), "{}\n"); await assert.rejects(inspectNativeImageRuntimes(root)); }
  finally { await rm(scratch, { recursive: true, force: true }); }
});

test("native minimum rejects missing, malformed and vulnerable loaded versions", () => {
  for (const version of [undefined, "", "0.35.4", "0.35.5-beta.1", "evil", "0.35"]) assert.equal(versionAtLeast(version, [0, 35, 5]), false);
  for (const version of ["0.35.5", "0.36.0", "1.0.0"]) assert.equal(versionAtLeast(version, [0, 35, 5]), true);
  assert.equal(versionAtLeast("2.63.1", [2, 63, 2]), false); assert.equal(versionAtLeast("2.63.2", [2, 63, 2]), true);
});

test("loaded native receipt hashes actual archive binary bytes and marks missing shared-library enumeration", async () => {
  const scratch = await mkdtemp(path.join(scratchParent, "fleetum-restore-recovery-native-hash-")); const root = path.join(scratch, "reserve");
  const addon = path.join(root, "node_modules/@img/sharp-synthetic/lib/sharp.node");
  try {
    await mkdir(path.dirname(addon), { recursive: true }); await writeFile(addon, "synthetic native unit fixture bytes");
    const receipt = await buildLoadedNativeReceipt({ name: "backend", archiveRoot: root, versions: { sharp: "0.35.5", rsvg: "2.63.2" }, nativeFiles: [addon] });
    assert.equal(receipt.binaries[0].sha256, tokenHash(await readFile(addon))); assert.equal(receipt.binaries[0].file, "node_modules/@img/sharp-synthetic/lib/sharp.node");
    assert(receipt.limits.some(value => value.includes("shared")));
    await assert.rejects(buildLoadedNativeReceipt({ name: "backend", archiveRoot: root, versions: { sharp: "0.35.4", rsvg: "2.63.2" }, nativeFiles: [addon] }));
    await assert.rejects(buildLoadedNativeReceipt({ name: "backend", archiveRoot: root, versions: { sharp: "0.35.5", rsvg: "2.63.2" }, nativeFiles: [] }));
    await assert.rejects(buildLoadedNativeReceipt({ name: "backend", archiveRoot: root, versions: { sharp: "0.35.5", rsvg: "2.63.2" }, nativeFiles: ["/private/tmp/external.node"] }));
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
