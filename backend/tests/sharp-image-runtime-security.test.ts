import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { sanitizeImageMetadata } from "../src/infrastructure/storage/file-security.js";
import { env } from "../src/shared/config/env.js";

const backend = createRequire(new URL("../package.json", import.meta.url));
const website = createRequire(new URL("../../website/package.json", import.meta.url));
const next = createRequire(website.resolve("next/package.json"));
const runtimes = [["backend", backend("sharp")], ["Next", next("sharp")]] as const;
const atLeast = (version: string, minimum: number[]) => {
  const actual = version.split(".").map(Number);
  for (let index = 0; index < minimum.length; index++) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index] || !Number.isFinite(actual[index])) return false;
  }
  return true;
};

for (const [name, sharp] of runtimes) {
  test(`${name} loads patched sharp and native librsvg rather than relying on a lockfile claim`, () => {
    // Maintainer GHSA-wq5f-xc86-pv6w: sharp >=0.35.5 provides librsvg2.63.2.
    // This is a runtime version check, not an exploit or proof of live Linux.
    assert(atLeast(sharp.versions.sharp, [0, 35, 5]), "Loaded sharp must include the maintainer security patch");
    assert(atLeast(sharp.versions.rsvg, [2, 63, 2]), "Loaded native librsvg must include its security patch");
  });
  test(`${name} renders a bounded synthetic SVG using its actual native image stack`, async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#267f9c"/></svg>');
    const result = await sharp(svg, { limitInputPixels: 1000 }).resize({ width: 10 }).png().toBuffer({ resolveWithObject: true });
    assert.equal(result.info.width, 10); assert.equal(result.info.height, 5); assert.equal(result.info.format, "png");
    assert(result.data.length > 32 && result.data.length < 2048);
    assert.deepEqual([...result.data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  });
  test(`${name} preserves JPEG auto-orientation while stripping synthetic EXIF metadata`, async () => {
    const source = await sharp({ create: { width: 32, height: 48, channels: 3, background: "#267f9c" } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const before = await sharp(source).metadata(); assert(before.exif); assert.equal(before.orientation, 6);
    const result = await sharp(source).rotate().jpeg().toBuffer({ resolveWithObject: true });
    const after = await sharp(result.data).metadata();
    assert.equal(result.info.width, 48); assert.equal(result.info.height, 32);
    assert.equal(after.exif, undefined); assert.equal(after.orientation, undefined);
  });
}

test("backend upload sanitizer still strips EXIF and bounds wide synthetic JPEG output", async () => {
  const sharp = backend("sharp");
  const directory = await mkdtemp(path.join(tmpdir(), "fleetum-sharp-synthetic-"));
  const file = path.join(directory, "synthetic.jpg");
  try {
    await sharp({ create: { width: env.IMAGE_MAX_WIDTH_PX + 20, height: 20, channels: 3, background: "#267f9c" } })
      .withMetadata({ orientation: 1 }).jpeg().toFile(file);
    assert((await sharp(file).metadata()).exif);
    const result = await sanitizeImageMetadata(file);
    const metadata = await sharp(await readFile(file)).metadata();
    assert.equal(metadata.width, env.IMAGE_MAX_WIDTH_PX);
    assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined);
    assert.equal(result.sizeBytes, (await stat(file)).size);
    assert.equal(result.optimized, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
