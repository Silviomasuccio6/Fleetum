import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

// Resolve the real CommonJS dependency from Express, not a test double or a
// separate root package that might hide a vulnerable nested installation.
const require = createRequire(import.meta.url);
const requireFromExpress = createRequire(require.resolve("express/package.json"));
type Trust = (address: string, hop?: number) => boolean;
type ProxyAddress = {
  (request: { socket: { remoteAddress: string }; headers: Record<string, string> }, trust: Trust): string;
  compile(subnets: string[]): Trust;
  all(request: { socket: { remoteAddress: string }; headers: Record<string, string> }, trust: Trust): string[];
};
const proxyAddress: ProxyAddress = requireFromExpress("proxy-addr");
assert.equal(typeof proxyAddress, "function");
assert.equal(typeof proxyAddress.compile, "function");
assert.equal(typeof proxyAddress.all, "function");

const syntheticRequest = (peer: string) => ({
  socket: { remoteAddress: peer }, headers: { "x-forwarded-for": "192.0.2.250" }
});

test("malformed mapped IPv6 and broad IPv6 subnets fail closed for IPv4 peers and ignore their spoofed forwarding header", () => {
  // GHSA-jqcg-44mw-7w3h: compilation may reject the bad range or return a
  // predicate that denies these peers. A successfully compiled fail-open
  // predicate must never turn an untrusted socket into a trusted proxy.
  for (const subnet of ["::ffff:10.0.0.0/8", "::/1"]) {
    let trust: Trust;
    try { trust = proxyAddress.compile([subnet]); }
    catch { continue; }
    for (const peer of ["198.51.100.17", "::ffff:198.51.100.17", "10.23.4.5", "::ffff:10.23.4.5"]) {
      assert.equal(trust(peer), false, `${subnet} must not trust ${peer}`);
      assert.equal(proxyAddress(syntheticRequest(peer), trust), peer);
      assert.deepEqual(proxyAddress.all(syntheticRequest(peer), trust), [peer]);
    }
  }
});

test("a valid mapped /104 trusts only the intended 10.* block for plain and mapped IPv4", () => {
  const trust = proxyAddress.compile(["::ffff:10.0.0.0/104"]);
  for (const peer of ["10.23.4.5", "::ffff:10.23.4.5"]) {
    assert.equal(trust(peer), true);
    assert.equal(proxyAddress(syntheticRequest(peer), trust), "192.0.2.250");
  }
  for (const peer of ["198.51.100.17", "::ffff:198.51.100.17", "11.0.0.1", "::1"]) {
    assert.equal(trust(peer), false);
    assert.equal(proxyAddress(syntheticRequest(peer), trust), peer);
  }
});

test("an ordinary IPv4 /8 preserves subnet boundaries and trusted-hop forwarding behavior", () => {
  const trust = proxyAddress.compile(["10.0.0.0/8"]);
  for (const peer of ["10.23.4.5", "::ffff:10.23.4.5"]) {
    assert.equal(trust(peer), true);
    assert.equal(proxyAddress(syntheticRequest(peer), trust), "192.0.2.250");
  }
  for (const peer of ["198.51.100.17", "::ffff:198.51.100.17", "11.0.0.1", "::1"]) {
    assert.equal(trust(peer), false);
    assert.equal(proxyAddress(syntheticRequest(peer), trust), peer);
  }
});
