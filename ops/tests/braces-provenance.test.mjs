import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

test("the committed local braces archive matches its canonical reviewed sources", () => {
  const result = spawnSync("python3", [resolve(root, "ops/pack-braces.py"), "--check"], {
    cwd: root, encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /matches reviewed sources/);
});

test("npm integrity, local override and every installed package file bind to the reviewed patch", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  const entry = lock.packages["node_modules/braces"];
  assert.equal(manifest.overrides.braces, "$braces");
  assert.equal(manifest.devDependencies.braces, entry.resolved);
  assert.equal(entry.name, "@fleetum/braces");
  assert.equal(entry.version, "3.0.3-fleetum.2");
  assert.equal(entry.dev, true);
  const archive = readFileSync(resolve(root, entry.resolved.slice("file:".length)));
  assert.equal("sha512-" + createHash("sha512").update(archive).digest("base64"), entry.integrity);
  const installed = dirname(require.resolve("braces/package.json"));
  assert.equal(lstatSync(installed).isSymbolicLink(), false);
  const source = resolve(root, "vendor/braces");
  const check = (directory, relative = "") => {
    for (const name of readdirSync(directory)) {
      const path = resolve(directory, name);
      const target = relative ? relative + "/" + name : name;
      assert.equal(lstatSync(path).isSymbolicLink(), false);
      if (lstatSync(path).isDirectory()) check(path, target);
      else assert.deepEqual(readFileSync(resolve(installed, target)), readFileSync(path), target);
    }
  };
  check(source);
  const metadata = JSON.parse(readFileSync(resolve(installed, "SOURCE.json"), "utf8"));
  assert.equal(metadata.upstreamPatch, false);
  assert.equal(metadata.advisory, "GHSA-vfj7-8cjw-p6xm");
  for (const name of ["LICENSE", "index.js", "lib/constants.js", "lib/utils.js"]) {
    assert.equal(createHash("sha256").update(readFileSync(resolve(source, name))).digest("hex"),
      metadata.originalSourceSha256[name], name + " retains upstream bytes");
  }
});

test("the frontend image build stage copies the local archive before npm ci", () => {
  for (const workspace of ["frontend"]) {
    const recipe = readFileSync(resolve(root, workspace, "Dockerfile.prod"), "utf8");
    const copy = recipe.indexOf("COPY vendor vendor");
    assert.ok(copy >= 0 && copy < recipe.indexOf("RUN npm ci"), workspace);
  }
});
