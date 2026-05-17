import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateUploadedFile } from "../src/infrastructure/storage/file-security.js";

const withTempFile = async (content: Buffer | string, fn: (filePath: string) => Promise<void>) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-file-security-"));
  const filePath = path.join(dir, "sample.bin");
  await fs.writeFile(filePath, content);
  try {
    await fn(filePath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};

test("file security accepts a real PDF signature", async () => {
  await withTempFile(Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "utf8"), async (filePath) => {
    await assert.doesNotReject(() => validateUploadedFile(filePath, "application/pdf"));
  });
});

test("file security rejects a fake PDF payload", async () => {
  await withTempFile(Buffer.from("not a pdf", "utf8"), async (filePath) => {
    await assert.rejects(() => validateUploadedFile(filePath, "application/pdf"), (error: any) => {
      assert.equal(error.code, "INVALID_FILE_MAGIC");
      return true;
    });
  });
});

test("file security accepts Office OpenXML zip-based documents", async () => {
  await withTempFile(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), async (filePath) => {
    await assert.doesNotReject(() =>
      validateUploadedFile(filePath, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    );
  });
});

test("file security blocks EICAR test signature", async () => {
  await withTempFile("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!", async (filePath) => {
    await assert.rejects(() => validateUploadedFile(filePath, "text/plain"), (error: any) => {
      assert.equal(error.code, "MALWARE_SIGNATURE_DETECTED");
      return true;
    });
  });
});
