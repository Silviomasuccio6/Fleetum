import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { artifactInventory, exerciseApplicationRecovery, validateNativeImageRuntimeReceipt } from "../recovery/exercise-application-recovery.mjs";

const nativeReceipt = {
  format: "fleetum-native-image-runtime-v1", localOnly: true,
  runtimes: [
    { name: "backend", status: "verified", versions: { sharp: "0.35.5", rsvg: "2.63.2" }, syntheticSvg: { width: 10, height: 5, format: "png" }, binaries: [
      { file: "node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node", sha256: "a".repeat(64), sizeBytes: 123 },
      { file: "node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.dylib", sha256: "b".repeat(64), sizeBytes: 456 },
    ], limits: [] },
    { name: "Next", status: "not-installed", limits: ["Next is not installed in this archive; its native image runtime is not covered."] },
  ],
  limits: ["This receipt covers the loaded local host image stack, not a deployed container or live production.", "Dist artifact manifests do not cover node_modules or native dependencies."],
};

test("native readiness evidence requires patched versions, canonical binary identities and explicit missing-Next coverage", () => {
  assert.deepEqual(validateNativeImageRuntimeReceipt(nativeReceipt), nativeReceipt);
  const tainted = structuredClone(nativeReceipt); tainted.token = "synthetic-token-must-not-be-recorded";
  tainted.runtimes[0].secret = "synthetic-secret-must-not-be-recorded";
  assert.deepEqual(validateNativeImageRuntimeReceipt(tainted), nativeReceipt);
  const invalidValues = [undefined, { ...nativeReceipt, runtimes: [] }];
  for (const change of [
    (value) => { value.runtimes[0].versions.sharp = "0.35.4"; },
    (value) => { value.runtimes[0].versions.rsvg = "2.63.1"; },
    (value) => { value.runtimes[0].status = "failed"; },
    (value) => { value.runtimes[0].syntheticSvg.width = 20; },
    (value) => { value.runtimes[0].binaries = []; },
    (value) => { value.runtimes[0].binaries[0].file = "../node_modules/sharp/native.node"; },
    (value) => { value.runtimes[0].binaries[0].file = "/private/tmp/node_modules/sharp/native.node"; },
    (value) => { value.runtimes[0].binaries[0].sha256 = "not-a-digest"; },
    (value) => { value.runtimes[0].binaries[0].sizeBytes = 0; },
    (value) => { value.runtimes[1].limits = []; },
    (value) => { value.runtimes[1].status = "verified"; },
  ]) { const value = structuredClone(nativeReceipt); change(value); invalidValues.push(value); }
  for (const value of invalidValues) assert.throws(() => validateNativeImageRuntimeReceipt(value), /Missing or invalid patched native image runtime receipt/);
});

test("recovery cannot reopen traffic with a different native version or binary hash than the trusted pair", () => {
  const trusted = validateNativeImageRuntimeReceipt(nativeReceipt);
  assert.deepEqual(validateNativeImageRuntimeReceipt(structuredClone(nativeReceipt), trusted), trusted);
  for (const change of [
    (value) => { value.runtimes[0].versions.sharp = "0.35.6"; },
    (value) => { value.runtimes[0].binaries[0].sha256 = "c".repeat(64); },
  ]) { const changed = structuredClone(nativeReceipt); change(changed); assert.throws(() => validateNativeImageRuntimeReceipt(changed, trusted), /Native image runtime changed before traffic reopening/); }
});

test("production-built recovery still refuses non-test fixture environments before reading artifacts or starting a child", async () => {
  for (const nodeEnv of [undefined, "production", "development"]) {
    await assert.rejects(exerciseApplicationRecovery({ archiveRoot: "/private/tmp/fleetum-restore-recovery-synthetic/reserve", sourceSha: "a".repeat(40), buildNodeEnv: "production", env: { NODE_ENV: nodeEnv } }), { name: "AssertionError", message: /Application recovery fixtures require NODE_ENV=test/ });
  }
  await assert.rejects(exerciseApplicationRecovery({ buildNodeEnv: "development", env: { NODE_ENV: "test" } }), { name: "AssertionError", message: /Unknown application build mode/ });
});

const fixtureUrl = new URL("../fixtures/restore-recovery-http.mjs", import.meta.url).href;
const rejectedDiagnostic = 'FLEETUM_RESTORE_HTTP_FAILURE {"stepLabel":"import-app","errorName":"AssertionError"}\n';
// A broken guard must still produce no application import or network attempt.
// Any such attempt becomes an Error diagnostic, which fails the exact assertion.
const isolatedChild = `
  import { registerHooks } from "node:module";
  registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier.includes("backend/")) throw new Error("Application import trap");
    return nextResolve(specifier, context);
  } });
  globalThis.fetch = () => { throw new Error("Network trap"); };
  await import(${JSON.stringify(fixtureUrl)});
`;
const external = "http://127.0.0.1:49152/api";
const invalidTargets = [
  ["missing opt-in", external, undefined],
  ["false opt-in", external, "false"],
  ["opt-in without external base", undefined, "true"],
  ["external hostname", "http://example.invalid:49152/api", "true"],
  ["localhost alias", "http://localhost:49152/api", "true"],
  ["another IPv4 host", "http://127.0.0.2:49152/api", "true"],
  ["IPv6 host", "http://[::1]:49152/api", "true"],
  ["HTTPS", "https://127.0.0.1:49152/api", "true"],
  ["username", "http://user@127.0.0.1:49152/api", "true"],
  ["username and password", "http://user:synthetic@127.0.0.1:49152/api", "true"],
  ["query", "http://127.0.0.1:49152/api?synthetic=1", "true"],
  ["empty query marker", "http://127.0.0.1:49152/api?", "true"],
  ["fragment", "http://127.0.0.1:49152/api#synthetic", "true"],
  ["empty fragment marker", "http://127.0.0.1:49152/api#", "true"],
  ["wrong path", "http://127.0.0.1:49152/other", "true"],
  ["path suffix", "http://127.0.0.1:49152/api/ready", "true"],
  ["trailing slash", "http://127.0.0.1:49152/api/", "true"],
  ["missing port", "http://127.0.0.1/api", "true"],
  ["default port canonicalization", "http://127.0.0.1:80/api", "true"],
  ["port canonicalization", "http://127.0.0.1:049152/api", "true"],
  ["protocol canonicalization", "HTTP://127.0.0.1:49152/api", "true"],
  ["IPv4 canonicalization", "http://127.000.000.001:49152/api", "true"],
  ["numeric host canonicalization", "http://2130706433:49152/api", "true"],
  ["path canonicalization", "http://127.0.0.1:49152/other/../api", "true"],
  ["leading whitespace", " http://127.0.0.1:49152/api", "true"],
];

for (const [label, base, optIn] of invalidTargets) {
  test(`external-base guard rejects ${label} before importing the app or requesting HTTP`, () => {
    const env = { PATH: path.dirname(process.execPath), DOTENV_CONFIG_PATH: "/dev/null" };
    if (base !== undefined) env.SYNTHETIC_HTTP_BASE = base;
    if (optIn !== undefined) env.SYNTHETIC_APPLICATION_RECOVERY = optIn;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", isolatedChild], {
      env, encoding: "utf8", timeout: 2_000, maxBuffer: 4_096,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, rejectedDiagnostic);
  });
}

async function ownedTree(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fleetum-artifact-inventory-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("artifact inventory is sorted and stable across creation order and unrelated filesystem roots", async (t) => {
  const directory = await ownedTree(t);
  const trees = [path.join(directory, "first"), path.join(directory, "second")];
  const contents = [
    ["z.js", Buffer.from("export default 1;\n")],
    ["assets/z.bin", Buffer.from([255, 0, 127])],
    ["assets/a.js", Buffer.from("synthetic-client\n")],
    ["a.html", Buffer.from("<html>Synthetic</html>\n")],
  ];
  for (let index = 0; index < trees.length; index++) {
    await mkdir(path.join(trees[index], "assets"), { recursive: true });
    for (const [relative, bytes] of index === 0 ? contents : [...contents].reverse()) {
      await writeFile(path.join(trees[index], relative), bytes);
    }
  }
  const first = await artifactInventory(trees[0]);
  const second = await artifactInventory(trees[1]);
  assert.deepEqual(first, second);
  assert.deepEqual(await artifactInventory(trees[0]), first);
  assert.equal(first.count, 4);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.files.map((file) => file.path), ["a.html", "assets/a.js", "assets/z.bin", "z.js"]);
  for (const [relative, bytes] of contents) {
    const entry = first.files.find((file) => file.path === relative);
    assert.equal(entry.sizeBytes, bytes.length);
    assert.equal(entry.sha256, sha256(bytes));
    assert.equal(path.isAbsolute(entry.path), false);
  }
});

test("a byte change of equal length and a renamed artifact each change the manifest digest", async (t) => {
  const directory = await ownedTree(t);
  const original = Buffer.from([1, 2, 3, 4]);
  await writeFile(path.join(directory, "client.bin"), original);
  const before = await artifactInventory(directory);
  await writeFile(path.join(directory, "client.bin"), Buffer.from([1, 2, 3, 5]));
  const changed = await artifactInventory(directory);
  assert.equal(changed.files[0].sizeBytes, before.files[0].sizeBytes);
  assert.notEqual(changed.files[0].sha256, before.files[0].sha256);
  assert.notEqual(changed.sha256, before.sha256);
  await writeFile(path.join(directory, "client.bin"), original);
  assert.deepEqual(await artifactInventory(directory), before);
  await rename(path.join(directory, "client.bin"), path.join(directory, "renamed.bin"));
  const renamed = await artifactInventory(directory);
  assert.equal(renamed.files[0].sha256, before.files[0].sha256);
  assert.notEqual(renamed.sha256, before.sha256);
});

test("artifact inventories reject file symlinks, child directory symlinks and a symlink root", async (t) => {
  const directory = await ownedTree(t);
  const targets = path.join(directory, "targets");
  await mkdir(targets);
  await writeFile(path.join(targets, "real.bin"), Buffer.from("synthetic"));
  for (const name of ["file-link-tree", "directory-link-tree"]) await mkdir(path.join(directory, name));
  await symlink(path.join(targets, "real.bin"), path.join(directory, "file-link-tree", "client.bin"), "file");
  await symlink(targets, path.join(directory, "directory-link-tree", "assets"), "dir");
  await symlink(targets, path.join(directory, "root-link"), "dir");
  await assert.rejects(artifactInventory(path.join(directory, "file-link-tree")), /Artifact symlink refused/);
  await assert.rejects(artifactInventory(path.join(directory, "directory-link-tree")), /Artifact symlink refused/);
  await assert.rejects(artifactInventory(path.join(directory, "root-link")), /Artifact directory must be regular/);
});

test("empty and directory-only trees cannot attest an artifact pair", async (t) => {
  const directory = await ownedTree(t);
  await assert.rejects(artifactInventory(directory), { name: "AssertionError" });
  await mkdir(path.join(directory, "empty", "nested"), { recursive: true });
  await assert.rejects(artifactInventory(directory), { name: "AssertionError" });
});
