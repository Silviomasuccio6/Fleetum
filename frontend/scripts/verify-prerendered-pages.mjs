import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const publicPrerenderRoutes = [
  "/",
  "/software-autonoleggio",
  "/software-rent-a-car",
  "/gestionale-flotta",
  "/booking-noleggi",
  "/contratti-noleggio-digitali",
  "/report-redditivita-veicolo",
  "/prezzi",
  "/demo",
  "/privacy",
  "/cookie",
  "/termini",
  "/dpa"
];

const distRoot = resolve(import.meta.dirname, "..");
const outputRoot = join(distRoot, "dist");

for (const route of publicPrerenderRoutes) {
  const outputPath = route === "/" ? join(outputRoot, "index.html") : join(outputRoot, route.slice(1), "index.html");
  const html = await readFile(outputPath, "utf8");

  assert.match(html, /data-prerendered="true"/, `${route} must include prerendered app HTML`);
  assert.match(html, /<link[^>]+rel="canonical"[^>]+href="https:\/\/fleetum\.it(?:\/[^"?]*)?"[^>]*>/, `${route} must include a canonical URL`);
  assert.match(html, /<script[^>]+type="application\/ld\+json"[^>]*>/, `${route} must include JSON-LD`);
  assert.doesNotMatch(html, /name="robots" content="noindex, nofollow"/, `${route} must remain indexable`);
}

const spaShell = await readFile(join(outputRoot, "spa.html"), "utf8");
assert.match(spaShell, /name="robots" content="noindex, nofollow"/, "SPA fallback must not be indexed");

const homepage = await readFile(join(outputRoot, "index.html"), "utf8");
assert.match(homepage, /fleetum-social-preview\.png/, "homepage must reference the social preview image");
assert.match(homepage, /og:image:width" content="1200"/, "homepage must expose the social preview width");
assert.match(homepage, /og:image:height" content="630"/, "homepage must expose the social preview height");

const robots = await readFile(join(outputRoot, "robots.txt"), "utf8");
assert.match(robots, /Sitemap: https:\/\/fleetum\.it\/sitemap\.xml/, "robots.txt must declare the sitemap");
assert.match(robots, /Disallow: \/spa\.html/, "robots.txt must block the SPA fallback");

const sitemap = await readFile(join(outputRoot, "sitemap.xml"), "utf8");
assert.doesNotMatch(sitemap, /<priority>|<changefreq>/, "sitemap must not use deprecated priority or changefreq hints");
for (const route of publicPrerenderRoutes) {
  const url = `https://fleetum.it${route === "/" ? "/" : route}`;
  assert.match(sitemap, new RegExp(`<loc>${url}</loc>`), `${route} must be listed in sitemap.xml`);
}

const llms = await readFile(join(outputRoot, "llms.txt"), "utf8");
assert.match(llms, /^# Fleetum/m, "llms.txt must identify Fleetum");
assert.match(llms, /https:\/\/fleetum\.it\/prezzi/, "llms.txt must include a public product URL");

const socialPreview = await readFile(join(outputRoot, "brand", "fleetum-social-preview.png"));
assert.deepEqual([...socialPreview.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "social preview must be a PNG");

console.log(`Verified ${publicPrerenderRoutes.length} prerendered public pages and SEO discovery assets.`);
