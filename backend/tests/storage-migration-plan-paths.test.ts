import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectLocalStorageFile } from "../src/scripts/storage-migration-plan.js";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const loader = createRequire(import.meta.url).resolve("tsx");
const child = `
  import fs from "node:fs/promises";
  import path from "node:path";
  import { pathToFileURL } from "node:url";
  import { writeSync, readdirSync, readFileSync } from "node:fs";
  import crypto from "node:crypto";
  const script = path.join(process.env.SOURCE_ROOT, "backend/src/scripts/storage-migration-plan.ts");
  const key = process.env.SYNTHETIC_KEY;
  const relative = key.startsWith("uploads/") ? key.slice("uploads/".length) : key;
  const file = path.resolve(process.cwd(), process.env.UPLOAD_DIR, relative);
  if (process.env.SYNTHETIC_MODE !== "missing") {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "synthetic storage inventory");
  }
  const { prisma } = await import(pathToFileURL(path.join(process.env.SOURCE_ROOT, "backend/src/infrastructure/database/prisma/client.ts")));
  let queries = 0;
  for (const model of ["vehicleMaintenanceAttachment", "vehicleBooklet", "rentalCustomerAttachment", "vehiclePhoto", "stoppagePhoto", "tenantBranding", "contractTemplate"]) {
    prisma[model].findMany = async () => {
      queries++;
      return model === "vehicleBooklet" ? [{ id: "synthetic-booklet", tenantId: "tenant-synthetic", filePath: key, fileName: "synthetic.txt", mimeType: "text/plain", sizeBytes: 26 }] : [];
    };
  }
  prisma.$disconnect = async () => undefined;
  const root = path.resolve(process.cwd(), process.env.UPLOAD_DIR);
  const snapshot = (relative = "") => {
    let entries;
    try { entries = readdirSync(path.join(root, relative), { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
    const result = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const key = path.join(relative, entry.name);
      if (entry.isDirectory()) result.push(...snapshot(key));
      else result.push({ key, sha256: crypto.createHash("sha256").update(readFileSync(path.join(root, key))).digest("hex") });
    }
    return result;
  };
  const before = snapshot();
  let summary = null;
  let error = null;
  console.log = (text) => { summary = JSON.parse(text); };
  console.error = (value) => { error = value?.message ?? String(value); };
  process.on("exit", () => writeSync(1, JSON.stringify({ queries, summary, error, before, after: snapshot() })));
  globalThis.fetch = async () => { throw new Error("Network is forbidden in inventory tests"); };
  process.argv = [process.execPath, script, "--json"];
  await import(pathToFileURL(script));
`;

async function inventory(input: { key: string; absolute?: boolean; provider?: "local" | "s3"; mode?: string; relativeRoot?: string }) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-storage-inventory-"));
  const cwd = path.join(temp, "app");
  await fs.mkdir(cwd);
  try {
    const result = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "-e", child], {
      cwd,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        DOTENV_CONFIG_PATH: "/dev/null",
        SOURCE_ROOT: sourceRoot,
        UPLOAD_DIR: input.absolute ? path.join(temp, "storage") : (input.relativeRoot ?? "uploads"),
        STORAGE_PROVIDER: input.provider ?? "local",
        S3_ENDPOINT: "https://storage.example.test",
        S3_BUCKET: "synthetic-only",
        S3_REGION: "auto",
        S3_ACCESS_KEY_ID: "synthetic-access",
        S3_SECRET_ACCESS_KEY: "synthetic-secret",
        SYNTHETIC_KEY: input.key,
        SYNTHETIC_MODE: input.mode ?? "valid"
      },
      encoding: "utf8",
      timeout: 20_000
    });
    assert.equal(result.signal, null, result.stderr);
    return { status: result.status, ...JSON.parse(result.stdout.trim()) };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

for (const layout of [
  { label: "modern key with relative upload root", key: "tenants/tenant-synthetic/booklets/synthetic.txt", relativeRoot: "synthetic-uploads" },
  { label: "legacy uploads key with relative root", key: "uploads/tenant-synthetic/booklets/synthetic.txt" },
  { label: "modern key with absolute upload root", key: "tenants/tenant-synthetic/booklets/synthetic.txt", absolute: true },
  { label: "legacy uploads key with absolute upload root", key: "uploads/tenant-synthetic/booklets/synthetic.txt", absolute: true }
]) {
  test(`local storage migration inventory resolves ${layout.label}`, async () => {
    const result = await inventory(layout);
    assert.equal(result.status, 0, result.error);
    assert.equal(result.queries, 7);
    assert.equal(result.summary.totalReferences, 1);
    assert.equal(result.summary.missingFiles, 0);
    assert.equal(result.summary.totalBytes, Buffer.byteLength("synthetic storage inventory"));
    assert.deepEqual(result.after, result.before, "Inventory must not alter file contents, keys or metadata");
  });
}

test("local storage migration inventory reports an actually missing object", async () => {
  const result = await inventory({ key: "tenants/tenant-synthetic/booklets/missing.txt", absolute: true, mode: "missing" });
  assert.equal(result.status, 0, result.error);
  assert.equal(result.summary.missingFiles, 1);
  assert.equal(result.summary.missing[0].storageKey, "tenants/tenant-synthetic/booklets/missing.txt");
});

test("local storage migration inventory rejects S3 configuration before database queries", async () => {
  const result = await inventory({ key: "tenants/tenant-synthetic/booklets/synthetic.txt", provider: "s3", absolute: true });
  assert.equal(result.status, 1);
  assert.equal(result.queries, 0);
  assert.match(result.error, /local/i);
  assert.equal(result.summary, null);
});

test("local storage migration inventory refuses unsafe keys rather than reporting them as missing", async () => {
  const result = await inventory({ key: "../outside.txt", absolute: true });
  assert.equal(result.status, 1);
  assert.match(result.error, /storage|percorso/i);
  assert.equal(result.summary, null);
});

test("local storage inventory inspection does not treat directories as stored files", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-storage-inventory-dir-"));
  try {
    assert.deepEqual(await inspectLocalStorageFile("synthetic-directory", () => temp), { exists: false, sizeBytes: null });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

for (const code of ["INVALID_STORAGE_KEY", "AMBIGUOUS_STORAGE_KEY", "EACCES"]) {
  test(`local storage inventory inspection surfaces ${code} for review`, async () => {
    const failure = Object.assign(new Error("Synthetic resolver failure"), { code });
    await assert.rejects(() => inspectLocalStorageFile("synthetic-key", () => { throw failure; }), (error) => error === failure);
  });
}
