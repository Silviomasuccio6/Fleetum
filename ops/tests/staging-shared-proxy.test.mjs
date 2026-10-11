import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseArgs } from "../verify-staging-shared-proxy.mjs";

const source = (name) => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");

test("local proxy rehearsal requires explicit opt-in and immutable fixture images", () => {
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(["--run-local-synthetic", "--caddy-image", "caddy:latest", "--backend-fixture-image", "sha256:" + "a".repeat(64)]), /immutable/);
  const args = ["--run-local-synthetic", "--caddy-image", "sha256:" + "b".repeat(64), "--backend-fixture-image", "sha256:" + "a".repeat(64)];
  assert.deepEqual(parseArgs(args), { caddyImage: args[2], backendImage: args[4] });
  assert.throws(() => parseArgs([...args, "--deploy"]), /Usage/);
});

test("shared staging has no host ports and only its Caddy joins the ingress network", () => {
  const overlay = source("docker-compose.staging.shared.yml");
  assert.match(overlay, /ports: !reset \[\]/);
  assert.match(overlay, /networks: !override\n      fleetum_staging_private: \{\}\n      fleetum_staging_ingress:/);
  assert.doesNotMatch(overlay, /backend:|postgres:|fleetum_staging_edge:/);
  assert.match(overlay, /fleetum_staging_ingress:\n    external: true\n    name: fleetum_staging_ingress/);
  assert.match(overlay, /ipv4_address: 10\.203\.91\.3/);
});

test("staging budgets and rotated logs are enforced for every service", () => {
  const compose = source("docker-compose.staging.yml");
  for (const [service, cpu, mem, pids] of [["postgres", "0.50", "512m", "256"], ["backend", "0.75", "768m", "256"], ["caddy", "0.25", "128m", "128"]]) {
    const section = compose.split(`  ${service}:`)[1]?.split(/\n  [a-z_]+:/)[0];
    assert.ok(section, service);
    assert.ok(section.includes(`cpus: "${cpu}"`), service);
    assert.ok(section.includes(`mem_limit: ${mem}`), service);
    assert.ok(section.includes(`pids_limit: ${pids}`), service);
    assert.match(section, /logging:\n      driver: json-file\n      options:\n        max-size: "10m"\n        max-file: "3"/);
  }
});

test("inner proxy accepts only the fixed ingress peer and collapses forwarded headers to one client", () => {
  const config = source("deploy/caddy/Caddyfile.staging-shared");
  assert.match(config, /auto_https off/);
  assert.match(config, /trusted_proxies static 10\.203\.91\.2\/32/);
  assert.match(config, /trusted_proxies_strict/);
  assert.match(config, /client_ip_headers X-Forwarded-For/);
  assert.match(config, /not remote_ip 10\.203\.91\.2/);
  assert.match(config, /header X-Forwarded-Proto https/);
  assert.match(config, /header_up X-Forwarded-For \{client_ip\}/);
  assert.match(config, /header_up X-Forwarded-Proto https/);
  assert.match(config, /header_up X-Forwarded-Host \{host\}/);
  assert.match(config, /header_up -Forwarded/);
  assert.match(config, /:80 \{[\s\S]*respond "Unknown staging host" 421/);
  assert.doesNotMatch(config, /private_ranges|trusted_proxies static (?:0\.0\.0\.0|10\.203\.91\.0)|tls_insecure_skip_verify/);
  for (const host of ["staging.fleetum.it", "api-staging.fleetum.it", "platform-staging.fleetum.it"]) assert.ok(config.includes(`http://${host} {`));
});

test("outer ingress preserves canonical hosts and replaces untrusted client forwarding", () => {
  const config = source("deploy/caddy/Caddyfile.staging-ingress");
  assert.match(config, /^staging\.fleetum\.it, api-staging\.fleetum\.it, platform-staging\.fleetum\.it \{/m);
  assert.match(config, /reverse_proxy fleetum-staging-ingress:80/);
  assert.match(config, /header_up Host \{host\}/);
  assert.match(config, /header_up X-Forwarded-For \{remote_host\}/);
  assert.match(config, /header_up X-Forwarded-Proto https/);
  assert.match(config, /header_up X-Forwarded-Host \{host\}/);
  assert.match(config, /header_up -Forwarded/);
  assert.match(config, /:443 \{[\s\S]*respond "Unknown Fleetum host" 421/);
  assert.doesNotMatch(config, /http:\/\/|tls internal|tls_insecure_skip_verify|trusted_proxies/);
  const wrapper = source("deploy/caddy/Caddyfile.production-shared");
  assert.equal(wrapper.trim(), "import /etc/caddy/production-baseline\nimport /etc/caddy/staging-ingress");
});

test("production overlay changes only Caddy mounts and networks, preserving app and private network", () => {
  const overlay = source("docker-compose.prod.shared.yml");
  assert.doesNotMatch(overlay, /backend:|image:|ports:|env_file:|container_name:/);
  assert.match(overlay, /production-baseline:ro/);
  assert.match(overlay, /Caddyfile\.production-shared:\/etc\/caddy\/Caddyfile:ro/);
  assert.match(overlay, /Caddyfile\.staging-ingress:\/etc\/caddy\/staging-ingress:ro/);
  assert.match(overlay, /networks:\n      fleetum_private: \{\}\n      fleetum_staging_ingress:/);
  assert.match(overlay, /ipv4_address: 10\.203\.91\.2/);
  assert.match(overlay, /fleetum_staging_ingress:\n    external: true\n    name: fleetum_staging_ingress/);
});

test("shared routing retains baseline website, tenant API and Platform separation", () => {
  const base = source("deploy/caddy/Caddyfile.staging");
  const shared = source("deploy/caddy/Caddyfile.staging-shared");
  const tail = (text) => text.slice(text.indexOf("(security_headers)"));
  const normalize = (text) => text.replaceAll("http://", "").replaceAll("\t\timport shared_ingress_guard\n", "").replaceAll(" {\n\t\t\t\timport shared_upstream_headers\n\t\t\t}", "").replaceAll(" {\n\t\t\timport shared_upstream_headers\n\t\t}", "");
  assert.equal(normalize(tail(shared).split("# Reject unmatched Host headers")[0]).trimEnd(), tail(base).trimEnd());
});
