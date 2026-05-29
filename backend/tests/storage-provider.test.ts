import assert from "node:assert/strict";
import test from "node:test";
import { localStorageProvider } from "../src/infrastructure/storage/storage-provider.js";

test("local storage provider writes, checks and deletes files inside upload root", async () => {
  const key = localStorageProvider.buildKey("storage-provider-test", `${Date.now()}.txt`);

  await localStorageProvider.write(key, Buffer.from("fleetum-storage-test", "utf8"));
  assert.equal(await localStorageProvider.exists(key), true);

  await localStorageProvider.delete(key);
  assert.equal(await localStorageProvider.exists(key), false);
});

test("local storage provider rejects paths outside upload root", () => {
  assert.throws(() => localStorageProvider.resolveLocalPath("../secrets.txt"), /INVALID_FILE_PATH|Percorso file non valido/);
});

