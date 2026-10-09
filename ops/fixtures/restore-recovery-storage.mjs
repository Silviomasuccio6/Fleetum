import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const contains = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);

async function noSymlinks(target) {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Synthetic storage symlink rejected");
    } catch (error) { if (error.code === "ENOENT") break; throw error; }
  }
}

async function temporaryPath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value) throw new Error("Synthetic storage paths must be canonical and absolute");
  // /tmp is a system alias on macOS; resolve its prefix before checking parents.
  let canonical;
  const aliases = [];
  for (const root of [...new Set([os.tmpdir(), "/tmp", "/private/tmp"])]) {
    const canonicalRoot = await realpath(root).catch(() => null);
    if (canonicalRoot) {
      aliases.push([root, canonicalRoot], [canonicalRoot, canonicalRoot]);
    }
  }
  // Nested calls receive the canonical path from the first call. Accept both
  // spellings of each known system temp root without resolving caller links.
  for (const [root, canonicalRoot] of aliases) {
    if (!contains(root, value) || value === root) continue;
    canonical = path.join(canonicalRoot, path.relative(root, value)); break;
  }
  if (!canonical) throw new Error("Synthetic storage must stay in a task-owned temporary tree");
  // Resolve only known system temp aliases, never a caller's symlink component.
  await noSymlinks(canonical);
  return canonical;
}

function targetKeyFor(file) {
  const key = file?.key;
  if (typeof key !== "string" || !/^[A-Za-z0-9_./-]+$/.test(key) || key.includes("..") || key.startsWith("/") || path.posix.normalize(key) !== key || key.split("/").includes(".")) throw new Error("Invalid registered storage key");
  const targetKey = key.startsWith("uploads/") ? key.slice("uploads/".length) : key;
  if (targetKey === "uploads" || targetKey.startsWith("uploads/") || targetKey.split("/").length < 3) throw new Error("Ambiguous registered uploads namespace");
  const parts = targetKey.split("/");
  const tenantSegment = parts[0] === "tenants" ? parts[1] : parts[0];
  if ((parts[0] === "tenants" && parts.length < 4) || typeof file.tenantId !== "string" || !/^[A-Za-z0-9_-]+$/.test(file.tenantId) || tenantSegment !== file.tenantId) throw new Error("Registered storage tenant mismatch");
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || !/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) throw new Error("Invalid registered storage size or digest");
  return targetKey;
}

// Synthetic backup trees keep raw database keys; canonical storage has a single
// root. No database key is rewritten and no file is selected by fallback.
export async function materializeRegisteredUploads({ manifest, uploadTree, destination }) {
  if (!Array.isArray(manifest?.uploads) || manifest.uploads.length === 0) throw new Error("Registered uploads manifest is empty");
  const source = await temporaryPath(uploadTree); const target = await temporaryPath(destination);
  if (contains(source, target) || contains(target, source)) throw new Error("Synthetic source and destination must be separate");
  if (!(await lstat(source)).isDirectory()) throw new Error("Synthetic upload tree is not a directory");
  try { await lstat(target); throw new Error("Synthetic upload destination already exists"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const seenKeys = new Set(); const seenTargets = new Set(); const plan = [];
  for (const file of manifest.uploads) {
    const targetKey = targetKeyFor(file);
    if (seenKeys.has(file.key) || seenTargets.has(targetKey)) throw new Error("Ambiguous duplicate registered upload mapping");
    seenKeys.add(file.key); seenTargets.add(targetKey);
    const sourceFile = path.join(source, file.key); await noSymlinks(sourceFile);
    let stat; try { stat = await lstat(sourceFile); } catch (error) { if (error.code === "ENOENT") throw new Error("Registered synthetic upload is missing"); throw error; }
    if (!stat.isFile()) throw new Error("Registered synthetic upload must be a regular file");
    const bytes = await readFile(sourceFile);
    if (stat.size !== file.sizeBytes || bytes.length !== file.sizeBytes || digest(bytes) !== file.sha256) throw new Error("Registered synthetic upload digest or size mismatch");
    plan.push({ key: file.key, targetKey, tenantId: file.tenantId, sizeBytes: file.sizeBytes, sha256: file.sha256, bytes });
  }
  let created = false;
  try {
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await noSymlinks(path.dirname(target));
    await mkdir(target, { mode: 0o700 }); created = true;
    for (const file of plan) {
      const output = path.join(target, file.targetKey); await mkdir(path.dirname(output), { recursive: true, mode: 0o700 }); await noSymlinks(output);
      await writeFile(output, file.bytes, { flag: "wx", mode: 0o600 });
      const bytes = await readFile(output);
      if (bytes.length !== file.sizeBytes || digest(bytes) !== file.sha256) throw new Error("Materialized synthetic upload digest mismatch");
    }
  } catch (error) { if (created) await rm(target, { recursive: true, force: true }); throw error; }
  return { mapping: "historical-uploads-prefix-to-canonical-root", fileCount: plan.length, files: plan.map(({ bytes, ...file }) => file) };
}

const probe = String.raw`
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const {localStorageProvider:p}=await import(pathToFileURL(path.join(process.env.SOURCE_ROOT,"backend/src/infrastructure/storage/storage-provider.ts")));
const key=process.env.STORAGE_MATRIX_KEY; const modern=process.env.STORAGE_MATRIX_TARGET_KEY; const legacy="uploads/"+modern; const root=p.getRootDir(); const checks=[];
assert.equal(p.buildKey("tenants","tenant-a","vehicle-booklets","new.pdf"),"tenants/tenant-a/vehicle-booklets/new.pdf");
assert.equal(p.resolveLocalPath(key),path.join(root,modern)); assert.equal((await p.read(key)).toString(),"synthetic tenant A booklet"); assert.equal(await p.exists(key),true); checks.push("registered-key-read");
await assert.rejects(()=>p.writeNew(key,Buffer.from("replacement")),e=>e.code==="STORAGE_OBJECT_EXISTS"); assert.equal((await p.read(key)).toString(),"synthetic tenant A booklet"); checks.push("create-only-original-preserved");
const newKey=p.buildKey("tenants","tenant-a","new-directory","new.pdf"); await p.writeNew(newKey,Buffer.from("synthetic new object")); assert.equal((await p.read(newKey)).toString(),"synthetic new object"); await p.delete(newKey); await p.delete(newKey); assert.equal(await p.exists(newKey),false); checks.push("modern-write-read-delete-missing-idempotent");
for(const invalid of ["../outside.pdf","/outside.pdf","uploads/../outside.pdf","tenant-a//bad.pdf","tenant-a\\..\\outside.pdf"]) assert.throws(()=>p.resolveLocalPath(invalid),e=>e.code==="INVALID_STORAGE_KEY"); checks.push("traversal-rejected");
const outside=path.join(process.cwd(),"outside"); await fs.mkdir(outside); await fs.writeFile(path.join(outside,"private.pdf"),"synthetic outside"); await fs.symlink(outside,path.join(root,"linked"));
for(const linked of ["linked/private.pdf","uploads/linked/private.pdf"]) { assert.throws(()=>p.resolveLocalPath(linked),e=>e.code==="INVALID_FILE_PATH"); await assert.rejects(()=>p.read(linked),e=>e.code==="INVALID_FILE_PATH"); await assert.rejects(()=>p.writeNew(linked,Buffer.from("replacement")),e=>e.code==="INVALID_FILE_PATH"); } checks.push("symlink-escape-rejected");
await fs.mkdir(path.dirname(path.join(root,legacy)),{recursive:true}); await fs.writeFile(path.join(root,legacy),"alternate must never be read");
await assert.rejects(()=>p.read(legacy),e=>e.code==="AMBIGUOUS_STORAGE_KEY"); await assert.rejects(()=>p.writeNew(legacy,Buffer.from("replacement")),e=>e.code==="AMBIGUOUS_STORAGE_KEY"); assert.equal(await fs.readFile(path.join(root,modern),"utf8"),"synthetic tenant A booklet"); checks.push("ambiguous-alternative-rejected");
assert.equal(await fs.readFile(path.join(root,modern.replace("tenant-a/","tenant-b/")),"utf8"),"synthetic tenant B booklet"); checks.push("other-tenant-file-unchanged");
console.log(JSON.stringify({checks,registeredSha256:createHash("sha256").update(await fs.readFile(path.join(root,modern))).digest("hex")}));
`;

async function executeProbe(sourceRoot, caseRoot, uploadDir, key, targetKey) {
  const loader = createRequire(path.join(sourceRoot, "package.json")).resolve("tsx");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", loader, "--input-type=module", "--eval", probe], {
      cwd: caseRoot, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH, NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null", SOURCE_ROOT: sourceRoot, STORAGE_PROVIDER: "local", UPLOAD_DIR: uploadDir, STORAGE_MATRIX_KEY: key, STORAGE_MATRIX_TARGET_KEY: targetKey }
    });
    let output = ""; let size = 0; const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Storage probe timeout")); }, 10000);
    child.stdout.on("data", (bytes) => { size += bytes.length; if (size > 20000) child.kill("SIGKILL"); else output += bytes; });
    child.stderr.on("data", () => {}); child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); if (code !== 0) reject(new Error(`Synthetic storage probe failed (${code})`)); else { try { resolve(JSON.parse(output)); } catch { reject(new Error("Invalid storage probe result")); } } });
  });
}

export async function runStorageMatrix({ sourceRoot, ownedRoot }) {
  assert.equal(process.versions.node, "22.23.1", "Storage matrix requires Node 22.23.1");
  if (typeof sourceRoot !== "string" || !path.isAbsolute(sourceRoot)) throw new Error("Source archive must be absolute");
  await noSymlinks(sourceRoot);
  for (const relative of [".env", "backend/.env", "backend/prisma/.env", "prisma/.env"]) {
    try { await lstat(path.join(sourceRoot, relative)); throw new Error("Runtime dotenv filename rejected"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const root = await temporaryPath(ownedRoot);
  if (!(await lstat(root)).isDirectory() || (await readdir(root)).length) throw new Error("Owned storage matrix root must be an empty directory");
  const cases = [];
  for (const uploadMode of ["relative", "absolute"]) for (const keyLayout of ["modern", "legacy", "modern-direct", "legacy-tenants"]) {
    const name = `${uploadMode}-${keyLayout}`; const caseRoot = path.join(root, name); await mkdir(caseRoot);
    const uploadTree = path.join(caseRoot, "backup"); await mkdir(uploadTree);
    const prefix = `${keyLayout.startsWith("legacy") ? "uploads/" : ""}${["modern", "legacy-tenants"].includes(keyLayout) ? "tenants/" : ""}`;
    const uploads = [];
    for (const label of ["a", "b"]) {
      const key = `${prefix}tenant-${label}/vehicle-booklets/example.pdf`; const bytes = Buffer.from(`synthetic tenant ${label.toUpperCase()} booklet`);
      await mkdir(path.dirname(path.join(uploadTree, key)), { recursive: true }); await writeFile(path.join(uploadTree, key), bytes, { flag: "wx" });
      uploads.push({ key, tenantId: `tenant-${label}`, sizeBytes: bytes.length, sha256: digest(bytes) });
    }
    const destination = path.join(caseRoot, uploadMode === "relative" ? "uploads" : "opt/fleetum-staging/uploads");
    const manifest = { uploads }; const first = await materializeRegisteredUploads({ manifest, uploadTree, destination });
    const initial = await executeProbe(sourceRoot, caseRoot, uploadMode === "relative" ? "uploads" : destination, uploads[0].key, first.files[0].targetKey);
    // Remove only this case's destination and its disposable probe artifacts.
    await rm(destination, { recursive: true, force: true }); await rm(path.join(caseRoot, "outside"), { recursive: true, force: true });
    const restored = await materializeRegisteredUploads({ manifest, uploadTree, destination }); assert.deepEqual(restored, first);
    const afterRestore = await executeProbe(sourceRoot, caseRoot, uploadMode === "relative" ? "uploads" : destination, uploads[0].key, restored.files[0].targetKey); assert.deepEqual(afterRestore, initial);
    cases.push({ uploadMode, keyLayout, files: restored.fileCount, checks: [...initial.checks, "backup-to-canonical-materialization", "repeat-restore-bytes-identical"], registeredSha256: initial.registeredSha256 });
  }
  return { success: true, format: "fleetum-synthetic-storage-matrix-v1", cases, coverage: { combinations: cases.length, modernProducerKeyFormat: "tenants/<tenantId>/<category>/<file>", restored: true, providerCalls: 0, databaseUsed: false, httpTenantAuthorization: false, historicalFallbackWithModernKeys: false, liveStorageVerified: false, localConcurrentFilesystemTampering: false }, limitations: ["uploads is a reserved historical namespace; duplicate mappings fail closed", "Legacy flat keys without a tenant path require manual inventory and are excluded", "Local storage confinement checks existing symlinks; hostile concurrent filesystem mutation is outside this rehearsal", "Historical application compatibility with modern keys is not tested"] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); const values = new Map();
    for (let i = 0; i < args.length; i += 2) { if (!["--source-root", "--owned-root"].includes(args[i]) || values.has(args[i]) || !args[i + 1]) throw new Error("Use --source-root and --owned-root exactly once"); values.set(args[i], args[i + 1]); }
    if (values.size !== 2) throw new Error("Use --source-root and --owned-root exactly once");
    console.log(JSON.stringify(await runStorageMatrix({ sourceRoot: values.get("--source-root"), ownedRoot: values.get("--owned-root") }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
