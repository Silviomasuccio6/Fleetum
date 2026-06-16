import assert from "node:assert/strict";
import test from "node:test";
import { localStorageProvider, S3StorageProvider } from "../src/infrastructure/storage/storage-provider.js";

const response = (status = 200, body = "") =>
  new Response(status === 204 ? null : body, { status, statusText: status >= 200 && status < 300 ? "OK" : "ERR" });

test("local storage provider writes, reads, checks and deletes files inside upload root", async () => {
  const key = localStorageProvider.buildKey("storage-provider-test", `${Date.now()}.txt`);

  await localStorageProvider.write(key, Buffer.from("fleetum-storage-test", "utf8"));
  assert.equal(await localStorageProvider.exists(key), true);
  assert.equal((await localStorageProvider.read(key)).toString("utf8"), "fleetum-storage-test");

  await localStorageProvider.delete(key);
  assert.equal(await localStorageProvider.exists(key), false);
});

test("local storage provider rejects paths outside upload root", () => {
  assert.throws(() => localStorageProvider.resolveLocalPath("../secrets.txt"), /INVALID_STORAGE_KEY|Chiave storage non valida|INVALID_FILE_PATH|Percorso file non valido/);
});

test("s3 storage provider uploads, downloads, checks and deletes private objects", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (init?.method === "GET") return response(200, "fleetum-s3-payload");
    if (init?.method === "HEAD") return response(200);
    return response(204);
  };

  const provider = new S3StorageProvider({
    endpoint: "https://r2.example.test",
    bucket: "fleetum-private",
    region: "auto",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    fetchImpl: fetchImpl as typeof fetch
  });

  const key = provider.buildKey("tenant-a", "documents", "contract.pdf");
  await provider.write(key, Buffer.from("pdf"), {
    tenantId: "tenant-a",
    resourceType: "BookingContract",
    resourceId: "contract-1",
    mimeType: "application/pdf"
  });
  assert.equal(calls.at(-1)?.init.method, "PUT");
  assert.match(String((calls.at(-1)?.init.headers as Record<string, string>).authorization), /^AWS4-HMAC-SHA256/);
  assert.equal((calls.at(-1)?.init.headers as Record<string, string>)["x-amz-meta-tenant-id"], "tenant-a");

  assert.equal(await provider.exists(key), true);
  assert.equal(calls.at(-1)?.init.method, "HEAD");

  const payload = await provider.read(key);
  assert.equal(calls.at(-1)?.init.method, "GET");
  assert.equal(payload.toString("utf8"), "fleetum-s3-payload");

  await provider.delete(key);
  assert.equal(calls.at(-1)?.init.method, "DELETE");
});

test("s3 storage provider returns false for missing objects and creates signed URLs", async () => {
  const fetchImpl = async () => response(404);
  const provider = new S3StorageProvider({
    endpoint: "https://s3.eu-south-1.amazonaws.com",
    bucket: "fleetum-private",
    region: "eu-south-1",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    fetchImpl: fetchImpl as typeof fetch
  });

  assert.equal(await provider.exists("tenant-a/missing.pdf"), false);
  const signedUrl = await provider.getSignedReadUrl("tenant-a/private.pdf", 120);
  assert.match(signedUrl, /^https:\/\/s3\.eu-south-1\.amazonaws\.com\/fleetum-private\/tenant-a\/private\.pdf\?/);
  assert.match(signedUrl, /X-Amz-Signature=/);
  assert.match(signedUrl, /X-Amz-Expires=120/);
});
