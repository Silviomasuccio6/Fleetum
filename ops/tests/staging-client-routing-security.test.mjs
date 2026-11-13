import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const staging = readFileSync(new URL("../../deploy/caddy/Caddyfile.staging", import.meta.url), "utf8");
const production = readFileSync(new URL("../../deploy/caddy/Caddyfile", import.meta.url), "utf8");
const site = (source, host, nextHost) => source.split(`${host} {`)[1]?.split(nextHost)[0] ?? "";
const app = site(staging, "staging.fleetum.it", "api-staging.fleetum.it");
const api = site(staging, "api-staging.fleetum.it", "platform-staging.fleetum.it");
const platform = site(staging, "platform-staging.fleetum.it", "\u0000");

test("staging exposes the same explicit marketing route allowlist as the exported production website", () => {
  const paths = (source) => source.match(/@marketing\s*\{\s*path ([^\n]+)/)?.[1].split(/\s+/).filter((path) => !["/robots.txt", "/sitemap.xml"].includes(path));
  assert.ok(paths(production)?.length > 30, "production website route allowlist must exist");
  assert.deepEqual(paths(app), paths(production));
  assert.match(app, /handle @marketing\s*\{\s*root \* \/srv\/fleetum-website\s*try_files \{path\} \{path\}\/index\.html \/404\.html\s*file_server/);
});

test("Next assets bypass SPA fallback and retain the correct website root", () => {
  assert.match(app, /@website_assets path \/_next\/\*/);
  assert.match(app, /handle @website_assets\s*\{\s*root \* \/srv\/fleetum-website[\s\S]*?file_server\s*\}/);
  const handler = app.match(/handle @website_assets\s*\{([^}]+)\}/)?.[1];
  assert.doesNotMatch(handler ?? "", /try_files/, "missing Next assets must return 404 instead of app HTML");
});

test("staging legacy marketing links preserve production redirect destinations", () => {
  for (const [name, target] of [["software_autonoleggio", "prodotto"], ["software_rent_a_car", "soluzioni"], ["contracts", "contratti-digitali"], ["profitability", "gestionale-flotta"]]) {
    const declaration = production.match(new RegExp(`@legacy_${name} path ([^\\n]+)`))?.[0];
    assert.ok(declaration && app.includes(declaration));
    assert.ok(app.includes(`redir @legacy_${name} /${target} 308`));
  }
});

test("SPA assets and brand files retain their original root instead of marketing fallback", () => {
  for (const path of ["assets", "brand"]) {
    assert.match(app, new RegExp(`handle /${path}/\\*\\s*\\{\\s*root \\* /srv/fleetum\\s*[\\s\\S]*?file_server\\s*\\}`));
  }
});

test("unknown tenant routes fall back to spa.html rather than the marketing index", () => {
  assert.match(app, /handle\s*\{\s*root \* \/srv\/fleetum\s*try_files \{path\} \/spa\.html\s*file_server/);
  assert.doesNotMatch(app, /try_files \{path\} \/index\.html/);
  assert.ok(app.indexOf("handle @marketing") < app.indexOf("try_files {path} /spa.html"));
});

test("application and Platform proxies remain separated and precede static fallbacks", () => {
  assert.match(app, /handle \/api\/\*\s*\{\s*reverse_proxy backend:4000/);
  assert.ok(app.indexOf("reverse_proxy backend:4000") < app.indexOf("handle @marketing"));
  assert.match(api, /@api path \/api\/\*\s*reverse_proxy @api backend:4000/);
  assert.doesNotMatch(app + api, /backend:4100/);
  assert.match(platform, /@platform_api path \/platform-api\/\*\s*reverse_proxy @platform_api backend:4100/);
  assert.doesNotMatch(platform, /backend:4000|fleetum-website/);
});

test("staging discovery and noindex protections remain first on each hostname", () => {
  assert.match(staging, /X-Robots-Tag "noindex, nofollow, noarchive"/);
  for (const section of [app, api, platform]) {
    assert.match(section, /import security_headers\s*import staging_errors\s*route \{\s*import staging_discovery/);
    assert.ok(section.indexOf("import staging_discovery") < section.indexOf("reverse_proxy"));
  }
  assert.match(staging, /path \/sitemap\.xml \/sitemap-\*\.xml/);
  assert.match(staging, /route @staging_sitemaps\s*\{\s*respond 404/);
});

test("enforced CSP covers only proven baseline directives without broad script exemptions", () => {
  const policy = staging.match(/Content-Security-Policy "([^"\n]+)"/)?.[1];
  assert.ok(policy, "a response CSP must be present");
  const directives = new Map(policy.split(";").map((part) => part.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...values]) => [name, values]));
  assert.deepEqual(directives.get("base-uri"), ["'self'"]);
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(directives.get("form-action"), ["'self'"]);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|\*/);
  assert.equal(directives.has("script-src"), false, "Next build-linked script hashes remain an explicit later gate");
});

test("CSP and noindex headers are deferred through proxy, file-server and error responses", () => {
  assert.match(staging, /\(security_headers\)\s*\{\s*header\s*\{[^}]*Content-Security-Policy[^}]*\bdefer\b/);
  assert.match(staging, /\+Content-Security-Policy "/, "baseline CSP must append without replacing stricter upstream policies");
  assert.match(staging, /handle_errors\s*\{\s*import security_headers\s*respond "Staging request failed"/);
});
