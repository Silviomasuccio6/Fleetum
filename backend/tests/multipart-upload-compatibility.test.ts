import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import type { Request, RequestHandler, Response } from "express";
import { assertImportFileIntegrity, importUpload } from "../src/infrastructure/storage/import-upload.js";
import { uploadMaintenanceAttachments } from "../src/infrastructure/storage/multer.js";
import {
  cleanupOnUploadFailure,
  cleanupRequestUploads,
  getRequestUploadStagingDirectory
} from "../src/infrastructure/storage/upload-lifecycle.js";

const exampleCsv = "targa,marca\nAB123CD,Fleetum Demo\n";

async function multipartRequest(form: FormData): Promise<Request> {
  const serialized = new globalThis.Request("http://localhost/upload", { method: "POST", body: form });
  const body = Buffer.from(await serialized.arrayBuffer());
  return Object.assign(Readable.from([body]), {
    method: "POST",
    headers: {
      "content-type": serialized.headers.get("content-type"),
      "content-length": String(body.length)
    }
  }) as unknown as Request;
}

function runUpload(middleware: RequestHandler, request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    middleware(request, {} as Response, (error?: unknown) => error ? reject(error) : resolve());
  });
}

test("vehicle import accepts a normal in-memory CSV upload", async () => {
  const form = new FormData();
  form.append("file", new Blob([exampleCsv], { type: "text/csv" }), "vehicles.csv");
  const req = await multipartRequest(form);

  await runUpload(importUpload.single("file"), req);

  assert.ok(req.file);
  assert.equal(req.file.originalname, "vehicles.csv");
  assert.equal(req.file.buffer.toString("utf8"), exampleCsv);
  assert.doesNotThrow(() => assertImportFileIntegrity(req.file!));
});

test("maintenance accepts two ordinary attachments and cleans up both files", async () => {
  const form = new FormData();
  const filenames = ["first.csv", "second.csv"];
  for (const name of filenames) form.append("files", new Blob([exampleCsv], { type: "text/csv" }), name);
  const req = await multipartRequest(form);
  const directory = await getRequestUploadStagingDirectory(req);

  try {
    await runUpload(cleanupOnUploadFailure(uploadMaintenanceAttachments.array("files", 10)), req);
    assert.ok(Array.isArray(req.files));
    assert.deepEqual(req.files.map(file => file.originalname), filenames);
    for (const file of req.files) assert.equal(await readFile(file.path, "utf8"), exampleCsv);
  } finally {
    await cleanupRequestUploads(req);
  }

  await assert.rejects(access(directory), { code: "ENOENT" });
});

test("maintenance rejects an unsupported attachment and removes the request directory", async () => {
  const form = new FormData();
  form.append("files", new Blob([exampleCsv], { type: "text/csv" }), "vehicles.csv");
  form.append("files", new Blob(["example"], { type: "application/octet-stream" }), "unsupported.bin");
  const req = await multipartRequest(form);
  const directory = await getRequestUploadStagingDirectory(req);

  try {
    await assert.rejects(
      runUpload(cleanupOnUploadFailure(uploadMaintenanceAttachments.array("files", 10)), req),
      { statusCode: 400 }
    );
    await assert.rejects(access(directory), { code: "ENOENT" });
  } finally {
    await cleanupRequestUploads(req);
  }
});
