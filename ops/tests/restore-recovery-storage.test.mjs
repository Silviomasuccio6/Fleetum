import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { materializeRegisteredUploads, runStorageMatrix } from "../fixtures/restore-recovery-storage.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "fleetum-storage-materialize-"));
  const tree = path.join(root, "backup"); const destination = path.join(root, "canonical-root");
  await mkdir(tree);
  const file = async (key, tenantId = "tenant-a", bytes = Buffer.from("synthetic registered bytes")) => {
    await mkdir(path.dirname(path.join(tree, key)), { recursive: true }); await writeFile(path.join(tree, key), bytes);
    return { key, tenantId, sizeBytes: bytes.length, sha256: digest(bytes) };
  };
  try { await run({ root, tree, destination, file }); } finally { await rm(root, { recursive: true, force: true }); }
}

for (const key of ["tenant-a/documents/a.pdf", "tenants/tenant-a/documents/a.pdf", "uploads/tenant-a/documents/a.pdf", "uploads/tenants/tenant-a/documents/a.pdf"]) {
  test(`materialize registered ${key} without rewriting its database key`, () => fixture(async ({ tree, destination, file }) => {
    const entry = await file(key); const result = await materializeRegisteredUploads({ manifest: { uploads: [entry] }, uploadTree: tree, destination });
    const targetKey = key.replace(/^uploads\//, "");
    assert.equal(result.fileCount, 1); assert.equal(result.files[0].key, key); assert.equal(result.files[0].targetKey, targetKey);
    assert.equal(digest(await readFile(path.join(destination, targetKey))), entry.sha256);
    assert.equal((await lstat(path.join(destination, targetKey))).mode & 0o777, 0o600);
  }));
}

test("all bytes and a mixed two-tenant manifest are verified before any output is created", () => fixture(async ({ tree, destination, file }) => {
  const uploads = [await file("uploads/tenant-a/documents/a.pdf"), await file("tenants/tenant-b/documents/b.pdf", "tenant-b")];
  await writeFile(path.join(tree, uploads[1].key), "tampered");
  await assert.rejects(materializeRegisteredUploads({ manifest: { uploads }, uploadTree: tree, destination }), /digest or size mismatch/);
  await assert.rejects(lstat(destination), { code: "ENOENT" });
}));

test("same-file aliases fail closed even when tenant and digest are identical", () => fixture(async ({ tree, destination, file }) => {
  const uploads = [await file("uploads/tenant-a/documents/a.pdf"), await file("tenant-a/documents/a.pdf")];
  await assert.rejects(materializeRegisteredUploads({ manifest: { uploads }, uploadTree: tree, destination }), /duplicate registered upload mapping/);
  await assert.rejects(lstat(destination), { code: "ENOENT" });
}));

test("duplicate modern namespace registration also fails closed", () => fixture(async ({ tree, destination, file }) => {
  const entry = await file("tenants/tenant-a/documents/a.pdf");
  await assert.rejects(materializeRegisteredUploads({ manifest: { uploads: [entry, entry] }, uploadTree: tree, destination }), /duplicate/);
}));

test("tenant mismatch is rejected for direct and tenants namespaces", () => fixture(async ({ tree, destination, file }) => {
  for (const key of ["tenant-a/documents/a.pdf", "tenants/tenant-a/documents/a.pdf", "uploads/tenants/tenant-a/documents/a.pdf"]) {
    const entry = await file(key, "tenant-b");
    await assert.rejects(materializeRegisteredUploads({ manifest: { uploads: [entry] }, uploadTree: tree, destination }), /tenant mismatch/);
  }
  await assert.rejects(lstat(destination), { code: "ENOENT" });
}));

test("traversal, malformed keys, nested upload aliases and flat legacy keys are rejected", () => fixture(async ({ tree, destination }) => {
  for (const key of ["../outside.pdf", "/absolute.pdf", "uploads/tenant-a/../outside.pdf", "tenant-a//a.pdf", "tenant-a/./a.pdf", "tenant-a\\documents\\a.pdf", "uploads/uploads/tenant-a/documents/a.pdf", "uploads/a.pdf"]) {
    await assert.rejects(materializeRegisteredUploads({ manifest: { uploads: [{ key, tenantId: "tenant-a", sizeBytes: 1, sha256: "a".repeat(64) }] }, uploadTree: tree, destination }), /key|namespace|tenant/);
  }
  await assert.rejects(lstat(destination), { code: "ENOENT" });
}));

test("missing uploads and invalid size/digest leave no destination", () => fixture(async ({ tree, destination, file }) => {
  const entry = await file("tenant-a/documents/a.pdf"); await rm(path.join(tree, entry.key));
  await assert.rejects(materializeRegisteredUploads({ manifest: { uploads: [entry] }, uploadTree: tree, destination }), /missing/);
  for (const invalid of [{ ...entry, sizeBytes: -1 }, { ...entry, sha256: "invalid" }]) await assert.rejects(materializeRegisteredUploads({ manifest: { uploads: [invalid] }, uploadTree: tree, destination }), /size or digest/);
  await assert.rejects(lstat(destination), { code: "ENOENT" });
}));

test("symlink files and source tree symlinks are rejected without following them", () => fixture(async ({ root, tree, destination, file }) => {
  const entry = await file("tenant-a/documents/a.pdf"); const outside = path.join(root, "outside.pdf"); await writeFile(outside, "synthetic outside");
  await rm(path.join(tree, entry.key)); await symlink(outside, path.join(tree, entry.key));
  await assert.rejects(materializeRegisteredUploads({ manifest: { uploads: [entry] }, uploadTree: tree, destination }), /symlink/);
  const linkedTree = path.join(root, "linked-backup"); await symlink(tree, linkedTree);
  await assert.rejects(materializeRegisteredUploads({ manifest: { uploads: [entry] }, uploadTree: linkedTree, destination }), /symlink/);
  assert.equal(await readFile(outside, "utf8"), "synthetic outside"); await assert.rejects(lstat(destination), { code: "ENOENT" });
}));

test("symlink source parent, destination and destination parent are rejected", () => fixture(async ({ root, tree, destination, file }) => {
  const entry = await file("tenant-a/documents/a.pdf"); const outside = path.join(root, "outside"); await mkdir(outside);
  const linkedParent = path.join(root, "linked-parent"); await symlink(outside, linkedParent);
  for (const target of [linkedParent, path.join(linkedParent, "uploads")]) await assert.rejects(materializeRegisteredUploads({ manifest: { uploads: [entry] }, uploadTree: tree, destination: target }), /symlink/);
  const linkedSourceParent = path.join(root, "source-parent"); await symlink(root, linkedSourceParent);
  await assert.rejects(materializeRegisteredUploads({ manifest: { uploads: [entry] }, uploadTree: path.join(linkedSourceParent, "backup"), destination }), /symlink/);
}));

test("an existing destination is preserved and never overwritten", () => fixture(async ({ tree, destination, file }) => {
  const entry = await file("tenant-a/documents/a.pdf"); await mkdir(destination); await writeFile(path.join(destination, "sentinel"), "keep");
  await assert.rejects(materializeRegisteredUploads({ manifest: { uploads: [entry] }, uploadTree: tree, destination }), /already exists/);
  assert.equal(await readFile(path.join(destination, "sentinel"), "utf8"), "keep");
}));

test("empty manifests and non-temporary outputs are rejected", () => fixture(async ({ tree, destination, file }) => {
  await assert.rejects(materializeRegisteredUploads({ manifest: { uploads: [] }, uploadTree: tree, destination }), /empty/);
  const entry = await file("tenant-a/documents/a.pdf");
  await assert.rejects(materializeRegisteredUploads({ manifest: { uploads: [entry] }, uploadTree: tree, destination: "/opt/fleetum-staging/uploads" }), /temporary tree/);
}));

test("system temporary alias remains accepted after callers canonicalize it", () => fixture(async ({ root, tree, file }) => {
  const entry = await file("tenants/tenant-a/documents/a.pdf");
  const canonicalTree = await realpath(tree); const canonicalRoot = await realpath(root);
  const destination = path.join(canonicalRoot, "canonical-restored-root");
  const result = await materializeRegisteredUploads({ manifest: { uploads: [entry] }, uploadTree: canonicalTree, destination });
  assert.equal(result.fileCount, 1);
  assert.equal(digest(await readFile(path.join(destination, entry.key))), entry.sha256);
}));

test("current provider passes all eight relative/absolute and modern/legacy restore combinations", () => fixture(async ({ root }) => {
  const ownedRoot = path.join(root, "matrix"); await mkdir(ownedRoot);
  const result = await runStorageMatrix({ sourceRoot, ownedRoot });
  assert.equal(result.success, true); assert.equal(result.cases.length, 8); assert.equal(result.coverage.databaseUsed, false);
  assert.equal(result.coverage.historicalFallbackWithModernKeys, false);
  for (const entry of result.cases) { assert.equal(entry.files, 2); assert(entry.checks.includes("repeat-restore-bytes-identical")); }
}));
