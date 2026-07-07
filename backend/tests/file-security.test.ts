import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { sanitizeImageMetadata, validateUploadedFile } from "../src/infrastructure/storage/file-security.js";
import { env } from "../src/shared/config/env.js";

const withTempFile = async (content: Buffer | string, fn: (filePath: string) => Promise<void>, filename = "sample.bin") => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fleetum-file-security-"));
  const filePath = path.join(dir, filename);
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

test("image metadata sanitizer strips EXIF metadata from JPEG files", async () => {
  const marker = "FleetumSensitiveGpsMetadata";
  const image = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 30, g: 120, b: 220 }
    }
  })
    .jpeg()
    .withMetadata({
      exif: {
        IFD0: {
          ImageDescription: marker
        }
      }
    })
    .toBuffer();

  await withTempFile(
    image,
    async (filePath) => {
      const beforeBuffer = await fs.readFile(filePath);
      assert.equal(beforeBuffer.includes(Buffer.from(marker)), true);
      assert.ok((await sharp(filePath).metadata()).exif);

      await sanitizeImageMetadata(filePath);

      const afterBuffer = await fs.readFile(filePath);
      assert.equal(afterBuffer.includes(Buffer.from(marker)), false);
      assert.equal((await sharp(filePath).metadata()).exif, undefined);
    },
    "sample.jpg"
  );
});

test("image metadata sanitizer resizes oversized operational photos", async () => {
  const image = await sharp({
    create: {
      width: 2200,
      height: 900,
      channels: 3,
      background: { r: 245, g: 248, b: 252 }
    }
  })
    .jpeg({ quality: 92 })
    .toBuffer();

  await withTempFile(
    image,
    async (filePath) => {
      const result = await validateUploadedFile(filePath, "image/jpeg");
      const metadata = await sharp(filePath).metadata();

      assert.equal(metadata.width, env.IMAGE_MAX_WIDTH_PX);
      assert.equal(metadata.exif, undefined);
      assert.equal(result.sizeBytes, (await fs.stat(filePath)).size);
      assert.equal(result.optimized, true);
    },
    "oversized.jpg"
  );
});
