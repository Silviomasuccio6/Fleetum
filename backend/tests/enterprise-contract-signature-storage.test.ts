import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const loader = createRequire(import.meta.url).resolve("tsx");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0YQAAAAASUVORK5CYII=";

const child = `
  import fs from "node:fs/promises";
  import path from "node:path";
  import { pathToFileURL } from "node:url";
  import crypto from "node:crypto";
  const png = Buffer.from(process.env.SYNTHETIC_PNG, "base64");
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    return new Response(png, { status: 200 });
  };
  const { PDFDocument, PDFName, PDFRawStream } = await import(pathToFileURL(path.join(process.env.SOURCE_ROOT, "node_modules/pdf-lib/cjs/index.js")));
  const { buildEnterpriseContractPdf } = await import(pathToFileURL(path.join(process.env.SOURCE_ROOT, "backend/src/application/services/enterprise-contract-pdf-service.ts")));
  const key = process.env.SYNTHETIC_KEY;
  if (process.env.SYNTHETIC_MODE !== "missing" && process.env.STORAGE_PROVIDER === "local") {
    const relative = key.startsWith("uploads/") ? key.slice("uploads/".length) : key;
    const file = path.resolve(process.cwd(), process.env.UPLOAD_DIR, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, process.env.SYNTHETIC_MODE === "corrupt" ? Buffer.from("not an image") : png);
  }
  if (process.env.SYNTHETIC_MODE === "unsafe") {
    await fs.writeFile(path.resolve(process.cwd(), key), png);
  }
  const snapshot = async (root, relative = "") => {
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
    const result = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const key = path.join(relative, entry.name);
      if (entry.isDirectory()) result.push(...await snapshot(root, key));
      else result.push({ key, sha256: crypto.createHash("sha256").update(await fs.readFile(path.join(root, key))).digest("hex") });
    }
    return result;
  };
  const before = await snapshot(path.resolve(process.cwd(), process.env.UPLOAD_DIR));
  const bytes = await buildEnterpriseContractPdf({
    contract: { title: "Contratto sintetico", content: "1. Clausola di prova", signatureFilePath: key, signedAt: "2026-10-05T10:00:00Z" },
    booking: { code: "SYNTHETIC-1", status: "CONFIRMED", contractStatus: "SIGNED", customerName: "Cliente sintetico", pickupAt: new Date("2026-10-05T10:00:00Z"), returnAt: new Date("2026-10-06T10:00:00Z") }
  });
  const doc = await PDFDocument.load(bytes);
  const images = doc.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")).length;
  const after = await snapshot(path.resolve(process.cwd(), process.env.UPLOAD_DIR));
  console.log(JSON.stringify({ images, pages: doc.getPageCount(), calls, before, after }));
`;

async function render(input: { key: string; absolute?: boolean; provider?: "local" | "s3"; mode?: string; relativeRoot?: string }) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-signature-storage-"));
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
        SYNTHETIC_PNG: png,
        SYNTHETIC_MODE: input.mode ?? "valid"
      },
      encoding: "utf8",
      timeout: 20_000
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

for (const layout of [
  { label: "modern key with relative upload root", key: "tenants/tenant-synthetic/contracts/signature.png", relativeRoot: "synthetic-uploads" },
  { label: "legacy uploads key with relative root", key: "uploads/tenant-synthetic/contracts/signature.png" },
  { label: "modern key with absolute upload root", key: "tenants/tenant-synthetic/contracts/signature.png", absolute: true },
  { label: "legacy uploads key with absolute upload root", key: "uploads/tenant-synthetic/contracts/signature.png", absolute: true }
]) {
  test(`enterprise contract embeds signature through local storage: ${layout.label}`, async () => {
    const result = await render(layout);
    assert.ok(result.images > 0, "The PDF must contain the synthetic signature image");
    assert.equal(result.pages, 2);
    assert.deepEqual(result.calls, [], "Local reads must not contact any provider");
    assert.deepEqual(result.after, result.before, "Reading a signature must not create metadata files");
  });
}

test("enterprise contract uses mocked S3 object reads for a signature without local files", async () => {
  const result = await render({ key: "tenants/tenant-synthetic/contracts/signature.png", provider: "s3" });
  assert.ok(result.images > 0);
  assert.deepEqual(result.calls, [{ url: "https://storage.example.test/synthetic-only/tenants/tenant-synthetic/contracts/signature.png", method: "GET" }]);
  assert.deepEqual(result.before, []);
  assert.deepEqual(result.after, []);
});

for (const mode of ["missing", "corrupt"] as const) {
  test(`enterprise contract retains optional signature fallback for ${mode} objects`, async () => {
    const result = await render({ key: "tenants/tenant-synthetic/contracts/signature.png", absolute: true, mode });
    assert.equal(result.images, 0);
    assert.equal(result.pages, 2);
  });
}

test("enterprise contract does not embed a file outside the upload root", async () => {
  const result = await render({ key: "../outside.png", absolute: true, mode: "unsafe" });
  assert.equal(result.images, 0);
  assert.deepEqual(result.calls, []);
});
