import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

export function assertQaDestination(input, mode) {
  const refused = () => { throw new Error("PROVIDER_QA_EGRESS_REFUSED"); };
  if (!["offline", "stripe", "google", "both"].includes(mode)) return refused();
  let url;
  try { url = new URL(input); } catch { return refused(); }
  if (url.username || url.password || url.hash) return refused();
  if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) &&
      ["4200", "4300", "5273", "5274"].includes(url.port)) return;
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) return refused();
  if (["stripe", "both"].includes(mode) && url.hostname === "api.stripe.com" && url.pathname.startsWith("/v1/")) return;
  if (["google", "both"].includes(mode) && url.hostname === "oauth2.googleapis.com" &&
      ["/token", "/tokeninfo"].includes(url.pathname)) return;
  return refused();
}

// Application-level guard, not a replacement for a network firewall or sandbox.
export function installQaNetworkPolicy(mode) {
  assertQaDestination("http://localhost:4200/", mode);
  const restorers = [];
  for (const [transport, protocol] of [[http, "http:"], [https, "https:"]]) {
    for (const name of ["request", "get"]) {
      const original = transport[name];
      transport[name] = function (...args) {
        const initial = typeof args[0] === "string" || args[0] instanceof URL;
        const options = initial ? (typeof args[1] === "object" ? args[1] : {}) : (args[0] ?? {});
        if (options.socketPath || options.createConnection || options.lookup) throw new Error("PROVIDER_QA_TRANSPORT_REFUSED");
        const url = initial ? new URL(args[0]) : new URL(protocol + "//localhost");
        if (options.protocol) url.protocol = options.protocol;
        if (options.host) url.host = options.host;
        if (options.hostname) url.hostname = options.hostname;
        if (options.port !== undefined) url.port = String(options.port);
        if (options.path) { const path = new URL(options.path, url); url.pathname = path.pathname; url.search = path.search; }
        if (options.servername && options.servername !== url.hostname) throw new Error("PROVIDER_QA_TRANSPORT_REFUSED");
        assertQaDestination(url, mode);
        return Reflect.apply(original, transport, args);
      };
      restorers.push(() => { transport[name] = original; });
    }
  }
  syncBuiltinESMExports();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    assertQaDestination(input instanceof Request ? input.url : input, mode);
    return originalFetch(input, { ...init, redirect: "error" });
  };
  return () => {
    globalThis.fetch = originalFetch;
    for (const restore of restorers) restore();
    syncBuiltinESMExports();
  };
}
