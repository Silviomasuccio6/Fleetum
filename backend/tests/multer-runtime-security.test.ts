import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import express, { type ErrorRequestHandler } from "express";

const root = await mkdtemp(path.join(tmpdir(), "fleetum-multipart-synthetic-"));
process.env.NODE_ENV = "test";
process.env.DOTENV_CONFIG_PATH = "/dev/null";
process.env.UPLOAD_DIR = root;
process.env.FILE_MAX_DOCUMENT_MB = "1";
const { uploadRentalCustomerAttachments } = await import("../src/infrastructure/storage/multer.js");

after(() => rm(root, { recursive: true, force: true }));
beforeEach(async () => {
  for (const name of await readdir(root)) await rm(path.join(root, name), { recursive: true, force: true });
});
async function lab(t: { after: (fn: () => Promise<void>) => void }) {
  const app = express();
  app.get("/health", (_req, res) => res.json({ synthetic: true }));
  app.post("/upload", uploadRentalCustomerAttachments.single("document"), (req, res) => {
    res.json({ bytes: req.file?.size, withinSyntheticRoot: req.file?.path.startsWith(root + path.sep) });
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(400).json({ code: error.code ?? "MIDDLEWARE_REJECTED" });
  };
  app.use(errors);
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
function document(bytes: number, type = "application/pdf") {
  const data = new FormData();
  data.append("document", new Blob([Buffer.alloc(bytes, "S")], { type }), "synthetic-document.pdf");
  return data;
}
test("rental upload accepts a file exactly at the configured size boundary", { timeout: 10000 }, async t => {
  const url = await lab(t), bytes = 1024 * 1024;
  const response = await fetch(url + "/upload", { method: "POST", body: document(bytes) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { bytes, withinSyntheticRoot: true });
});
test("an oversized rental attachment is rejected and its partial file is removed", { timeout: 10000 }, async t => {
  const url = await lab(t);
  const response = await fetch(url + "/upload", { method: "POST", body: document(1024 * 1024 + 1) });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: "LIMIT_FILE_SIZE" });
  assert.deepEqual(await readdir(root), []);
});
test("disallowed attachment media types do not create a file", { timeout: 10000 }, async t => {
  const url = await lab(t);
  const response = await fetch(url + "/upload", { method: "POST", body: document(32, "application/javascript") });
  assert.equal(response.status, 400);
  assert.deepEqual(await readdir(root), []);
});
test("a disconnected multipart upload cleans its file and the process stays responsive", { timeout: 10000 }, async t => {
  const url = await lab(t), boundary = "fleetum-synthetic-abort";
  await new Promise<void>(resolve => {
    const request = http.request(url + "/upload", { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` } });
    request.on("error", () => {});
    request.once("close", resolve);
    request.write(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="synthetic.pdf"\r\nContent-Type: application/pdf\r\n\r\nSYNTHETIC PARTIAL FILE`);
    setTimeout(() => request.destroy(), 40);
  });
  for (let i = 0; i < 20 && (await readdir(root)).length; i++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(await readdir(root), []);
  assert.equal((await fetch(url + "/health")).status, 200);
});
