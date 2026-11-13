import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixture = () => ({ name: "fleetum_staging_ingress", driver: "bridge", internal: true,
  ipam: [{ Subnet: "10.203.91.0/28", Gateway: "10.203.91.1" }],
  labels: { "com.fleetum.environment": "staging", "com.fleetum.purpose": "shared-ingress" }, members: {} });
const prod = { Name: "fleetum_caddy", IPv4Address: "10.203.91.2/28", IPv6Address: "" };
const stage = { Name: "fleetum_staging_caddy", IPv4Address: "10.203.91.3/28", IPv6Address: "" };
const idA = "a".repeat(64), idB = "b".repeat(64);
function run(value, status = 0, args = []) {
  const root = mkdtempSync(path.join(tmpdir(), "fleetum-ingress-metadata-"));
  try {
    const input = path.join(root, "metadata"); writeFileSync(input, typeof value === "string" ? value : JSON.stringify(value));
    writeFileSync(path.join(root, "docker"), '#!/bin/sh\n[ "$1" = network ] && [ "$2" = inspect ] && [ "$3" = --format ] && [ "$5" = fleetum_staging_ingress ] && [ "$#" = 5 ] || exit 91\ncat "$FIXTURE_INPUT"\nexit "$FIXTURE_STATUS"\n', { mode: 0o700 });
    return spawnSync("bash", [new URL("../../deploy/scripts/shared-staging-ingress-preflight.sh", import.meta.url).pathname, ...args], {
      encoding: "utf8", env: { PATH: `${root}:/opt/homebrew/bin:/usr/bin:/bin`, FIXTURE_INPUT: input, FIXTURE_STATUS: String(status) }, timeout: 10000
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
for (const [name, members] of [["empty", {}], ["production only", { [idA]: prod }], ["staging only during gateway recovery", { [idB]: stage }], ["both Caddy", { [idA]: prod, [idB]: stage }]]) {
  test(`accepts the owned network with ${name}`, () => { const out = run({ ...fixture(), members }); assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /accepted/); });
}
for (const [name, change] of [
  ["foreign name", { name: "production" }], ["wrong driver", { driver: "overlay" }], ["public network", { internal: false }],
  ["wrong subnet", { ipam: [{ Subnet: "10.203.0.0/16", Gateway: "10.203.91.1" }] }], ["wrong gateway", { ipam: [{ Subnet: "10.203.91.0/28", Gateway: "10.203.91.4" }] }],
  ["extra subnet", { ipam: [...fixture().ipam, ...fixture().ipam] }], ["missing labels", { labels: {} }],
  ["foreign member", { members: { [idA]: { ...prod, Name: "fleetum_backend" } } }],
  ["wrong proxy IP", { members: { [idA]: { ...prod, IPv4Address: "10.203.91.4/28" } } }],
  ["duplicate proxy", { members: { [idA]: prod, [idB]: prod } }], ["IPv6 alternative", { members: { [idA]: { ...prod, IPv6Address: "::1/128" } } }]
]) test(`rejects ${name} without exposing metadata`, () => { const out = run({ ...fixture(), ...change }); assert.equal(out.status, 2); assert.equal(out.stdout, ""); assert.equal(out.stderr, "Shared staging ingress metadata rejected.\n"); });
for (const [name, input, status, args] of [["malformed JSON", "PRIVATE-METADATA", 0, []], ["oversized JSON", "x".repeat(131073), 0, []], ["failed Docker inspection", fixture(), 7, []], ["unexpected arguments", fixture(), 0, ["bypass"]]]) {
  test(`fails closed for ${name}`, () => { const out = run(input, status, args); assert.equal(out.status, 2); assert.equal(out.stdout, ""); assert.equal(out.stderr, "Shared staging ingress metadata rejected.\n"); });
}
