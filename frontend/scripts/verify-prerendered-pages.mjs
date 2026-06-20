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

console.log(`Verified ${publicPrerenderRoutes.length} prerendered public pages.`);
