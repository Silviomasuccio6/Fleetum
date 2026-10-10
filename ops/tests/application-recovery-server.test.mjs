import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildServerEnvironment, parseServerConfig } from "../fixtures/application-recovery-server.mjs";
import { PLATFORM_SYNTHETIC_ADMIN_EMAIL, PLATFORM_SYNTHETIC_JWT_SECRET } from "../fixtures/restore-recovery-security.mjs";

const scratchParent = process.platform === "linux" ? "/tmp" : "/private/tmp";
const otherScratchParent = process.platform === "linux" ? "/private/tmp" : "/tmp";
const archiveRoot = path.join(scratchParent, "fleetum-restore-recovery-abcdef/source");
const generation = "90a7c1b9-30e5-45f8-a5b2-c2df63a74f8e";
const sourceSha = "70fdfab3522907d9d956ac260224c165774e2af6";
const databaseUrl = "postgresql://fleetum_restore:0123456789abcdef0123456789abcdef@127.0.0.1:54339/fleetum_restore_0123456789abcdef0123456789abcdef_first?schema=public";
const valid = () => ({
  argv: [archiveRoot, sourceSha],
  env: {
    NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null", DATABASE_URL: databaseUrl,
    LOCAL_RECOVERY_MODE: "trusted", LOCAL_GENERATION: generation,
    LOCAL_READY_FILE: `${archiveRoot}/recovery-state/${generation}.json`,
    UPLOAD_DIR: `${archiveRoot}/uploads`
  }
});

test("clean wrapper environment always shares the producer's synthetic Platform identity and stays in test", () => {
  const input = valid(); input.env.PLATFORM_JWT_SECRET = "synthetic-caller-override-trap"; input.env.PLATFORM_ADMIN_EMAIL = "synthetic-caller-trap@example.invalid"; input.env.STRIPE_SECRET_KEY = "synthetic-provider-trap";
  const clean = buildServerEnvironment(parseServerConfig(input));
  assert.equal(clean.NODE_ENV, "test"); assert.equal(clean.DOTENV_CONFIG_PATH, "/dev/null");
  assert(clean.PLATFORM_JWT_SECRET === PLATFORM_SYNTHETIC_JWT_SECRET); assert.equal(clean.PLATFORM_ADMIN_EMAIL, PLATFORM_SYNTHETIC_ADMIN_EMAIL);
  assert.equal(clean.STRIPE_SECRET_KEY, undefined); assert(!Object.values(clean).some(value => typeof value === "string" && value.includes("override-trap")));
});

test("pure guard accepts an explicitly owned archive and a restored synthetic database", () => {
  const parsed = parseServerConfig(valid());
  assert.equal(parsed.archiveRoot, archiveRoot);
  assert.equal(parsed.sourceSha, sourceSha);
  assert.equal(parsed.generation, generation);
  assert.equal(parsed.mode, "trusted");
  assert.equal(parsed.databaseUrl, databaseUrl);
  assert.equal(parsed.uploadDirectory, `${archiveRoot}/uploads`);
  assert.equal(parsed.readyFile, `${archiveRoot}/recovery-state/${generation}.json`);
  const reserved = valid();
  reserved.argv[0] = archiveRoot.replace("/source", "/reserve");
  reserved.env.UPLOAD_DIR = `${reserved.argv[0]}/uploads`;
  reserved.env.LOCAL_READY_FILE = `${reserved.argv[0]}/recovery-state/${generation}.json`;
  assert.equal(parseServerConfig(reserved).archiveRoot, reserved.argv[0]);
});

test("every fault requires an explicit whitelisted mode", () => {
  for (const mode of ["trusted", "startup-rejected", "database-unready", "pause-before-import"]) {
    const input = valid(); input.env.LOCAL_RECOVERY_MODE = mode;
    assert.equal(parseServerConfig(input).mode, mode);
  }
  for (const mode of [undefined, "", "production", "skip-auth", "TRUSTED"]) {
    const input = valid(); input.env.LOCAL_RECOVERY_MODE = mode;
    assert.throws(() => parseServerConfig(input));
  }
});

test("startup guard rejects unsafe runtime and configuration injection", () => {
  for (const [key, value] of [
    ["NODE_ENV", undefined], ["NODE_ENV", "production"],
    ["DOTENV_CONFIG_PATH", undefined], ["DOTENV_CONFIG_PATH", ".env"],
    ["NODE_OPTIONS", "--import ./provider.mjs"],
    ["DOTENV_CONFIG_ENCODING", "utf8"], ["DOTENV_CONFIG_OVERRIDE", "true"]
  ]) {
    const input = valid(); input.env[key] = value;
    assert.throws(() => parseServerConfig(input));
  }
});

test("only a full SHA, generation UUID and explicit archive arguments are accepted", () => {
  for (const argv of [[], [archiveRoot], [archiveRoot, "main"], [archiveRoot, sourceSha, "extra"], [archiveRoot, sourceSha.slice(0, 8)]]) {
    const input = valid(); input.argv = argv;
    assert.throws(() => parseServerConfig(input));
  }
  for (const value of [undefined, "", "../outside", sourceSha, "90a7c1b9-30e5-05f8-a5b2-c2df63a74f8e"]) {
    const input = valid(); input.env.LOCAL_GENERATION = value;
    assert.throws(() => parseServerConfig(input));
  }
});

test("archive, uploads and ready file must remain within the owned scratch tree", () => {
  for (const value of [".", `${otherScratchParent}/fleetum-restore-recovery-abcdef/source`, "/private/tmp/other/source", `${scratchParent}/fleetum-restore-recovery-abcdef`, `${archiveRoot}/../source`, `${archiveRoot}/nested`]) {
    const input = valid(); input.argv[0] = value;
    assert.throws(() => parseServerConfig(input));
  }
  for (const value of [undefined, "uploads", "/private/tmp/uploads", `${archiveRoot}/../uploads`, `${archiveRoot}/uploads/../outside`, `${archiveRoot}-other/uploads`, archiveRoot]) {
    const input = valid(); input.env.UPLOAD_DIR = value;
    assert.throws(() => parseServerConfig(input));
  }
  for (const value of [undefined, "ready.json", "/private/tmp/ready.json", `${archiveRoot}/../ready.json`, `${archiveRoot}/recovery-state/../ready.json`, `${archiveRoot}-other/ready.json`, `${archiveRoot}/recovery-state/wrong.json`, `${archiveRoot}/recovery-state/90a7c1b9-30e5-45f8-a5b2-c2df63a74f8f.json`]) {
    const input = valid(); input.env.LOCAL_READY_FILE = value;
    assert.throws(() => parseServerConfig(input));
  }
});

test("database URLs cannot target real databases, remote hosts, sockets or alternate transports", () => {
  for (const value of [
    undefined, "invalid", databaseUrl.replace("postgresql:", "https:"),
    databaseUrl.replace("127.0.0.1", "postgres"), databaseUrl.replace("127.0.0.1", "localhost"),
    databaseUrl.replace("127.0.0.1", "192.0.2.1"), databaseUrl.replace(":54339", ""),
    databaseUrl.replace("fleetum_restore_0123456789abcdef0123456789abcdef_first", "fleetum_production"),
    databaseUrl.replace("_first?", "_source?"), `${databaseUrl}&host=/private/tmp/socket`,
    `${databaseUrl}&sslcert=/private/tmp/cert`, `${databaseUrl}&schema=public`,
    `${databaseUrl}#fragment`, databaseUrl.replace("schema=public", "schema=private"),
    databaseUrl.replace("fleetum_restore:", "postgres:"), databaseUrl.replace(":0123456789abcdef0123456789abcdef@", ":@")
  ]) {
    const input = valid(); input.env.DATABASE_URL = value;
    assert.throws(() => parseServerConfig(input));
  }
  const input = valid(); input.env.DATABASE_URL = databaseUrl.replace("_first?", "_second?");
  assert.match(parseServerConfig(input).databaseUrl, /_second\?/);
});

test("generated engine overrides must remain in the archive", () => {
  const input = valid(); input.env.PRISMA_QUERY_ENGINE_LIBRARY = `${archiveRoot}/libquery-engine-darwin-arm64.dylib.node`;
  assert.equal(parseServerConfig(input).engineEnvironment.PRISMA_QUERY_ENGINE_LIBRARY, input.env.PRISMA_QUERY_ENGINE_LIBRARY);
  for (const value of ["engine.node", "/private/tmp/external/engine.node", `${archiveRoot}/../engine.node`]) {
    const invalid = valid(); invalid.env.PRISMA_QUERY_ENGINE_LIBRARY = value;
    assert.throws(() => parseServerConfig(invalid));
  }
});

test("guard failures never echo an untrusted path, credential or argument", () => {
  const secret = "synthetic-private-credential-never-echo";
  for (const field of ["DATABASE_URL", "UPLOAD_DIR", "LOCAL_READY_FILE", "LOCAL_GENERATION", "LOCAL_RECOVERY_MODE"]) {
    const input = valid(); input.env[field] = secret;
    assert.throws(() => parseServerConfig(input), (error) => !String(error).includes(secret));
  }
  const input = valid(); input.argv[1] = secret;
  assert.throws(() => parseServerConfig(input), (error) => !String(error).includes(secret));
});

test("an existing generation file is preserved and rejected before any application import", async () => {
  const scratch = await mkdtemp(path.join(scratchParent, "fleetum-restore-recovery-guard-"));
  const directory = path.join(scratch, "reserve");
  const input = valid(); input.argv[0] = directory;
  input.env.UPLOAD_DIR = `${directory}/uploads`;
  input.env.LOCAL_READY_FILE = `${directory}/recovery-state/${generation}.json`;
  assert.equal(parseServerConfig(input).readyFile, input.env.LOCAL_READY_FILE);
  const privateContents = "synthetic-private-existing-ready-file\n";
  try {
    await Promise.all([
      mkdir(`${directory}/uploads`, { recursive: true }),
      mkdir(`${directory}/recovery-state`, { recursive: true }),
      mkdir(`${directory}/backend/dist/infrastructure/database/prisma`, { recursive: true })
    ]);
    // These are never imported: if the guard regresses, the distinct exit code
    // reveals it while preventing any app, socket or provider startup.
    const importTrap = "process.exit(47);\n";
    await Promise.all([
      writeFile(`${directory}/backend/dist/app.js`, importTrap),
      writeFile(`${directory}/backend/dist/infrastructure/database/prisma/client.js`, importTrap),
      writeFile(input.env.LOCAL_READY_FILE, privateContents)
    ]);
    const fixture = fileURLToPath(new URL("../fixtures/application-recovery-server.mjs", import.meta.url));
    const result = await new Promise((resolve) => {
      execFile(process.execPath, [fixture, ...input.argv], { env: input.env, timeout: 3000 }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });
    assert.equal(result.error?.code, 1);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `FLEETUM_APPLICATION_SERVER ${JSON.stringify({ phase: "failed", generation, sourceSha, errorName: "Error" })}`);
    assert.equal(await readFile(input.env.LOCAL_READY_FILE, "utf8"), privateContents);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
