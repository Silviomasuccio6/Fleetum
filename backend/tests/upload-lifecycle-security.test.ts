import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { Request, RequestHandler, Response } from "express";
import {
  buildTenantStorageKey,
  cleanupOnUploadFailure,
  cleanupRequestUploads,
  getRequestUploadStagingDirectory
} from "../src/infrastructure/storage/upload-lifecycle.js";

test("concurrent files in one request share one private staging directory", async () => {
  const req = {} as Request;
  const [first, second] = await Promise.all([
    getRequestUploadStagingDirectory(req),
    getRequestUploadStagingDirectory(req)
  ]);

  assert.equal(first, second);
  assert.equal((await fs.stat(first)).isDirectory(), true);
  await cleanupRequestUploads(req);
  await assert.rejects(() => fs.access(first));
});

test("tenant storage keys are tenant scoped, MIME-derived and unique", () => {
  const first = buildTenantStorageKey({
    tenantId: "tenant_a",
    category: "vehicle-photos",
    mimeType: "image/png"
  });
  const second = buildTenantStorageKey({
    tenantId: "tenant_b",
    category: "vehicle-photos",
    mimeType: "image/png"
  });

  assert.match(first, /(?:^|\/)tenants\/tenant_a\/vehicle-photos\/[0-9a-f-]+\.png$/);
  assert.match(second, /(?:^|\/)tenants\/tenant_b\/vehicle-photos\/[0-9a-f-]+\.png$/);
  assert.notEqual(first, second);
  assert.equal(first.includes("customer-document.png"), false);
});

test("a Multer failure removes every file already staged for the request", async () => {
  const req = {} as Request;
  const directory = await getRequestUploadStagingDirectory(req);
  const firstPath = path.join(directory, "first.png");
  const secondPath = path.join(directory, "second.png");
  await Promise.all([fs.writeFile(firstPath, "first"), fs.writeFile(secondPath, "second")]);
  req.files = [
    { path: firstPath } as Express.Multer.File,
    { path: secondPath } as Express.Multer.File
  ];

  const syntheticError = new Error("invalid second file");
  const multerMiddleware: RequestHandler = (_request, _response, next) => next(syntheticError);
  const wrapped = cleanupOnUploadFailure(multerMiddleware);
  const forwarded = await new Promise<unknown>((resolve) => {
    wrapped(req, {} as Response, (error?: unknown) => resolve(error));
  });

  assert.equal(forwarded, syntheticError);
  await assert.rejects(() => fs.access(firstPath));
  await assert.rejects(() => fs.access(secondPath));
  await assert.rejects(() => fs.access(directory));
});
