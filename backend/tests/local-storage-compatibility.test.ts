import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const loader = createRequire(import.meta.url).resolve("tsx");
const probe = String.raw`
  import assert from "node:assert/strict";
  import fs from "node:fs/promises";
  import path from "node:path";
  import { pathToFileURL } from "node:url";
  const { localStorageProvider: provider } = await import(pathToFileURL(path.join(process.env.SOURCE_ROOT, "backend/src/infrastructure/storage/storage-provider.ts")));
  const root = provider.getRootDir();
  const modern = (process.env.KEY_NAMESPACE === "tenants" ? "tenants/" : "") + "tenant-a/vehicle-booklets/example.pdf";
  const legacy = (process.env.KEY_PREFIX || "uploads") + "/" + modern;
  await fs.mkdir(path.dirname(path.join(root, modern)), { recursive: true });
  await fs.writeFile(path.join(root, modern), "synthetic-original");
  if (process.env.PROBE === "legacy") {
    assert.equal(provider.resolveLocalPath(legacy), path.join(root, modern));
    assert.equal((await provider.read(legacy)).toString(), "synthetic-original");
    await assert.rejects(() => provider.writeNew(legacy, Buffer.from("replacement")), error => error.code === "STORAGE_OBJECT_EXISTS");
    assert.equal((await provider.read(modern)).toString(), "synthetic-original");
  } else if (process.env.PROBE === "collision") {
    await fs.mkdir(path.dirname(path.join(root, legacy)), { recursive: true });
    await fs.writeFile(path.join(root, legacy), "alternate-must-never-be-read");
    assert.throws(() => provider.resolveLocalPath(legacy), error => error.code === "AMBIGUOUS_STORAGE_KEY");
    await assert.rejects(() => provider.read(legacy), error => error.code === "AMBIGUOUS_STORAGE_KEY");
    await assert.rejects(() => provider.writeNew(legacy, Buffer.from("replacement")), error => error.code === "AMBIGUOUS_STORAGE_KEY");
    assert.equal(await fs.readFile(path.join(root, modern), "utf8"), "synthetic-original");
    assert.equal(await fs.readFile(path.join(root, legacy), "utf8"), "alternate-must-never-be-read");
  } else if (process.env.PROBE === "symlink") {
    const outside = path.join(process.cwd(), "outside");
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, "private.pdf"), "synthetic-outside");
    await fs.symlink(outside, path.join(root, "linked-directory"));
    await fs.symlink(path.join(outside, "private.pdf"), path.join(root, "linked-file.pdf"));
    for (const key of ["linked-directory/private.pdf", "linked-file.pdf", "uploads/linked-directory/private.pdf", "uploads/linked-file.pdf"]) {
      assert.throws(() => provider.resolveLocalPath(key), error => error.code === "INVALID_FILE_PATH");
      await assert.rejects(() => provider.read(key), error => error.code === "INVALID_FILE_PATH");
      await assert.rejects(() => provider.writeNew(key, Buffer.from("replacement")), error => error.code === "INVALID_FILE_PATH");
    }
    assert.equal(await fs.readFile(path.join(outside, "private.pdf"), "utf8"), "synthetic-outside");
  } else if (process.env.PROBE === "traversal") {
    for (const key of ["../outside.pdf", "/outside.pdf", "uploads/../outside.pdf", "uploads//tenant-a/a.pdf", "tenant-a\\..\\outside.pdf"]) {
      assert.throws(() => provider.resolveLocalPath(key), error => error.code === "INVALID_STORAGE_KEY");
    }
  } else if (process.env.PROBE === "modern-create") {
    const key = provider.buildKey("tenants", "tenant-a", "new-directory", "new.pdf");
    assert.equal(key, "tenants/tenant-a/new-directory/new.pdf");
    await provider.writeNew(key, Buffer.from("synthetic-new"));
    await assert.rejects(() => provider.writeNew(key, Buffer.from("replacement")), error => error.code === "STORAGE_OBJECT_EXISTS");
    assert.equal((await provider.read(key)).toString(), "synthetic-new");
    await provider.delete(key); await provider.delete(key);
    assert.equal(await provider.exists(key), false);
  } else if (process.env.PROBE === "parent-symlink") {
    // The configured root was placed below a symlink by the parent fixture.
    assert.throws(() => provider.resolveLocalPath(modern), error => error.code === "INVALID_FILE_PATH");
    await assert.rejects(() => provider.read(modern), error => error.code === "INVALID_FILE_PATH");
    await assert.rejects(() => provider.writeNew("tenants/tenant-a/new-directory/new.pdf", Buffer.from("replacement")), error => error.code === "INVALID_FILE_PATH");
  }
`;

async function check(mode: "relative" | "absolute", scenario: string, namespace = "direct", configuredRoot = "uploads") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-local-storage-compat-"));
  try {
    if (scenario === "parent-symlink") {
      await fs.mkdir(path.join(dir, "owned-external"));
      await fs.symlink(path.join(dir, "owned-external"), path.join(dir, "linked-parent"));
    }
    const rootName = scenario === "parent-symlink" ? "linked-parent/uploads" : configuredRoot;
    const result = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "--eval", probe], {
      cwd: dir, encoding: "utf8", timeout: 10000,
      env: { PATH: process.env.PATH, NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null", SOURCE_ROOT: sourceRoot, STORAGE_PROVIDER: "local", UPLOAD_DIR: mode === "relative" ? rootName : path.join(dir, scenario === "parent-symlink" ? rootName : "canonical-staging/uploads"), PROBE: scenario, KEY_NAMESPACE: namespace, KEY_PREFIX: configuredRoot }
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
test("custom configured relative prefix stays compatible with direct tenant keys", () => check("relative", "legacy", "direct", "custom/storage"));
test("custom configured relative prefix stays compatible with tenants namespace keys", () => check("relative", "legacy", "tenants", "custom/storage"));

for (const mode of ["relative", "absolute"] as const) {
  for (const namespace of ["direct", "tenants"]) {
    test(`legacy uploads ${namespace} keys address the same object with ${mode} upload root`, () => check(mode, "legacy", namespace));
    test(`ambiguous duplicate uploads ${namespace} namespace is rejected with ${mode} upload root`, () => check(mode, "collision", namespace));
  }
  test(`existing symlink file and directory cannot escape ${mode} upload root`, () => check(mode, "symlink"));
  test(`traversal remains rejected with ${mode} upload root`, () => check(mode, "traversal"));
  test(`modern write creates missing folders and missing delete stays idempotent with ${mode} root`, () => check(mode, "modern-create", "tenants"));
  test(`root parent symlinks are rejected with ${mode} root`, () => check(mode, "parent-symlink"));
}
