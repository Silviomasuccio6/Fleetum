import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Local opt-in only. No provider, database, public DNS or ACME is contacted.
export function parseArgs(args) {
  if (args[0] !== "--run-local-synthetic" || args.length !== 5 || args[1] !== "--caddy-image" || args[3] !== "--backend-fixture-image") {
    throw new Error("Usage: node ops/verify-staging-shared-proxy.mjs --run-local-synthetic --caddy-image sha256:<local-image-id> --backend-fixture-image sha256:<local-express-fixture-image-id>");
  }
  for (const value of [args[2], args[4]]) if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error("Both fixture images must be immutable, already-local image IDs; pulls are disabled.");
  return { caddyImage: args[2], backendImage: args[4] };
}

export async function runSyntheticProxyProof(options) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const fixture = mkdtempSync(join(tmpdir(), "fleetum-shared-proxy-"));
  const id = randomUUID().replaceAll("-", "").slice(0, 12);
  const prefix = `fleetum-proxy-test-${id}`;
  const ingress = `${prefix}-ingress`;
  const privateNet = `${prefix}-private`;
  const edgeNet = `${prefix}-edge`;
  const outer = `${prefix}-outer`;
  const inner = `${prefix}-inner`;
  const backend = `${prefix}-backend`;
  const names = [outer, inner, backend];
  const networks = [ingress, privateNet, edgeNet];
  const report = { scope: "local-synthetic-two-proxy", images: options, caddyVersion: null, startedAt: new Date().toISOString(), checks: [], cleanup: false, externalGatesPromoted: 0 };
  const safeEnv = Object.fromEntries(["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  const command = (args, env = {}, allowFailure = false) => {
    const result = spawnSync("docker", args, { encoding: "utf8", timeout: 30_000, env: { ...safeEnv, ...env }, maxBuffer: 4 * 1024 * 1024 });
    if (!allowFailure && result.status !== 0) throw new Error(`Docker local fixture failed (${args[0]}): ${result.stderr || result.error?.message || result.stdout}`);
    return (args[0] === "logs" ? `${result.stdout ?? ""}${result.stderr ?? ""}` : result.stdout ?? "").trim();
  };
  const check = (name, fn) => { fn(); report.checks.push({ name, passed: true }); };
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  try {
    command(["image", "inspect", options.caddyImage, options.backendImage, "--format", "{{.Id}}"]);
    report.caddyVersion = command(["run", "--rm", "--pull", "never", "--network", "none", options.caddyImage, "caddy", "version"]);
    writeFileSync(join(fixture, "empty.env"), "", { mode: 0o600 });
    const composeEnv = { POSTGRES_PASSWORD: "synthetic-not-used", FLEETUM_BACKEND_IMAGE: `ghcr.io/synthetic/backend@sha256:${"a".repeat(64)}`, FLEETUM_FRONTEND_IMAGE: `ghcr.io/synthetic/frontend@sha256:${"b".repeat(64)}`, CADDY_EMAIL: "synthetic@example.invalid" };
    const rendered = (base, overlay) => JSON.parse(command(["compose", "--env-file", join(fixture, "empty.env"), "-f", join(root, base), "-f", join(root, overlay), "config", "--no-env-resolution", "--format", "json"], composeEnv));
    const stage = rendered("docker-compose.staging.yml", "docker-compose.staging.shared.yml");
    check("merged staging has no host ports and preserves backend/PG private isolation", () => {
      for (const service of ["postgres", "backend", "caddy"]) assert.equal(stage.services[service].ports?.length ?? 0, 0);
      for (const service of ["postgres", "backend"]) assert.deepEqual(Object.keys(stage.services[service].networks), ["fleetum_staging_private"]);
      assert.deepEqual(Object.keys(stage.services.caddy.networks).sort(), ["fleetum_staging_ingress", "fleetum_staging_private"]);
      assert.equal(stage.networks.fleetum_staging_private.internal, true);
      assert.equal(stage.networks.fleetum_staging_ingress.external, true);
      assert.equal(stage.services.caddy.networks.fleetum_staging_ingress.ipv4_address, "10.203.91.3");
    });
    check("merged staging enforces all CPU, RAM, PID and log limits", () => {
      for (const [service, cpu, memory, pids] of [["postgres", 0.5, 536870912, 256], ["backend", 0.75, 805306368, 256], ["caddy", 0.25, 134217728, 128]]) {
        assert.equal(Number(stage.services[service].cpus), cpu); assert.equal(Number(stage.services[service].mem_limit), memory); assert.equal(Number(stage.services[service].pids_limit), pids);
        assert.deepEqual(stage.services[service].logging, { driver: "json-file", options: { "max-size": "10m", "max-file": "3" } });
      }
    });
    const prod = rendered("docker-compose.prod.yml", "docker-compose.prod.shared.yml");
    check("merged production preserves app image/private network/ports and imports all three Caddy files", () => {
      assert.equal(prod.services.backend.image, composeEnv.FLEETUM_BACKEND_IMAGE);
      assert.deepEqual(Object.keys(prod.services.backend.networks), ["fleetum_private"]);
      assert.deepEqual(prod.services.caddy.ports.map((port) => Number(port.published)).sort((a, b) => a - b), [80, 443]);
      for (const target of ["/etc/caddy/Caddyfile", "/etc/caddy/production-baseline", "/etc/caddy/staging-ingress"]) assert.ok(prod.services.caddy.volumes.some((volume) => volume.target === target && volume.read_only));
      assert.equal(prod.services.caddy.networks.fleetum_staging_ingress.ipv4_address, "10.203.91.2");
    });
    // Only the fixture replaces public ACME with its own transient local CA.
    // Routing and the forwarding configuration are loaded from the real sources.
    const baseline = readFileSync(join(root, "deploy/caddy/Caddyfile"), "utf8");
    const syntheticBaseline = baseline.replace("email {$CADDY_EMAIL}", "local_certs\n\tskip_install_trust");
    const innerSource = readFileSync(join(root, "deploy/caddy/Caddyfile.staging-shared"), "utf8");
    const addendum = readFileSync(join(root, "deploy/caddy/Caddyfile.staging-ingress"), "utf8");
    writeFileSync(join(fixture, "production-baseline"), syntheticBaseline);
    writeFileSync(join(fixture, "staging-ingress"), addendum);
    writeFileSync(join(fixture, "outer.Caddyfile"), readFileSync(join(root, "deploy/caddy/Caddyfile.production-shared"), "utf8"));
    writeFileSync(join(fixture, "inner.Caddyfile"), innerSource);
    report.sourceHashes = { baseline: hash(baseline), inner: hash(innerSource), ingress: hash(addendum) };
    writeFileSync(join(fixture, "echo.cjs"), `const express = require('/app/node_modules/express');\nfor (const port of [4000,4100]) { const app = express(); app.set('trust proxy',1); app.use((req,res)=>res.json({port,ip:req.ip,ips:req.ips,secure:req.secure,protocol:req.protocol,hostname:req.hostname,host:req.get('host'),headers:req.headers,expressVersion:require('/app/node_modules/express/package.json').version})); app.listen(port,'0.0.0.0'); }\n`);
    for (const network of networks) {
      const args = ["network", "create", "--label", "com.fleetum.test=shared-proxy"];
      if (network !== edgeNet) args.push("--internal");
      if (network === ingress) args.push("--subnet", "10.203.91.0/28", "--gateway", "10.203.91.1");
      command([...args, network]);
    }
    command(["run", "-d", "--pull", "never", "--name", backend, "--network", privateNet, "--network-alias", "backend", "--entrypoint", "node", "-v", `${join(fixture, "echo.cjs")}:/tmp/echo.cjs:ro`, options.backendImage, "/tmp/echo.cjs"]);
    command(["run", "-d", "--pull", "never", "--name", inner, "--network", privateNet, "--tmpfs", "/data:rw,noexec,nosuid", "--tmpfs", "/config:rw,noexec,nosuid", "-v", `${join(fixture, "inner.Caddyfile")}:/etc/caddy/Caddyfile:ro`, options.caddyImage]);
    command(["network", "connect", "--ip", "10.203.91.3", "--alias", "fleetum-staging-ingress", ingress, inner]);
    command(["run", "-d", "--pull", "never", "--name", outer, "--network", edgeNet, "--tmpfs", "/data:rw,noexec,nosuid", "--tmpfs", "/config:rw,noexec,nosuid", "-p", "127.0.0.1::443", "-v", `${join(fixture, "outer.Caddyfile")}:/etc/caddy/Caddyfile:ro`, "-v", `${join(fixture, "production-baseline")}:/etc/caddy/production-baseline:ro`, "-v", `${join(fixture, "staging-ingress")}:/etc/caddy/staging-ingress:ro`, options.caddyImage]);
    command(["network", "connect", "--ip", "10.203.91.2", ingress, outer]);
    const binding = command(["port", outer, "443/tcp"]);
    const port = Number(binding.split(":").at(-1));
    assert.ok(Number.isInteger(port) && port > 0 && binding.startsWith("127.0.0.1:"));
    let ca;
    for (let attempt = 0; attempt < 80 && !ca; attempt++) {
      // Docker archive/cp does not expose a container's tmpfs content. Read only
      // the generated public CA certificate from the running fixture instead.
      const certificate = command(["exec", outer, "cat", "/data/caddy/pki/authorities/local/root.crt"], {}, true);
      if (certificate.includes("-----BEGIN CERTIFICATE-----")) ca = Buffer.from(certificate);
      else await pause(100);
    }
    assert.ok(ca, "synthetic CA must be created without public ACME");
    const httpsGet = (host, path, headers = {}) => new Promise((resolveResponse, reject) => {
      const req = request({ hostname: host, port, path, servername: host, ca, rejectUnauthorized: true, lookup: (_host, lookupOptions, callback) => lookupOptions.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4), headers, timeout: 3000 }, (res) => { const chunks = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => resolveResponse({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })); });
      req.on("error", reject); req.on("timeout", () => req.destroy(new Error("Synthetic HTTPS request timed out"))); req.end();
    });
    let ready;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { ready = await httpsGet("api-staging.fleetum.it", "/api/proxy-proof"); if (ready.status === 200) break; } catch { /* bounded startup retry */ }
      await pause(100);
    }
    assert.equal(ready?.status, 200, "both real Caddy configs must route to the synthetic backend");
    const actualClient = JSON.parse(ready.body).ip;
    const unknownHost = await httpsGet("api-staging.fleetum.it", "/api/proxy-proof", { Host: "attacker.invalid" });
    check("outer TLS ingress refuses unknown Host even with a valid known SNI", () => { assert.equal(unknownHost.status, 421); assert.equal(unknownHost.body, "Unknown Fleetum host"); });
    for (const [host, path, expectedPort] of [["staging.fleetum.it", "/api/proxy-proof", 4000], ["api-staging.fleetum.it", "/api/proxy-proof", 4000], ["platform-staging.fleetum.it", "/platform-api/proxy-proof", 4100]]) {
      const response = await httpsGet(host, path, { "X-Forwarded-For": "198.51.100.73, 203.0.113.89", "X-Forwarded-Proto": "http", "X-Forwarded-Host": "attacker.invalid", Forwarded: "for=198.51.100.73;proto=http;host=attacker.invalid", "X-Real-IP": "198.51.100.73", "X-Forwarded-Port": "1234" });
      const body = JSON.parse(response.body);
      check(`${host}: real TLS, canonical Host, one verified client IP, secure protocol and API separation`, () => {
        assert.equal(response.status, 200); assert.equal(body.port, expectedPort); assert.equal(body.ip, actualClient); assert.notEqual(body.ip, "198.51.100.73"); assert.deepEqual(body.ips, [actualClient]);
        assert.equal(body.secure, true); assert.equal(body.protocol, "https"); assert.equal(body.hostname, host); assert.equal(body.host, host);
        assert.equal(body.headers["x-forwarded-for"], actualClient); assert.equal(body.headers["x-forwarded-proto"], "https"); assert.equal(body.headers["x-forwarded-host"], host);
        for (const field of ["forwarded", "x-real-ip", "x-forwarded-port"]) assert.equal(body.headers[field], undefined);
        assert.match(response.headers["x-robots-tag"], /noindex/); assert.match(response.headers["content-security-policy"], /frame-ancestors 'none'/);
      });
      report.expressVersion = body.expressVersion;
      for (const resource of ["/robots.txt", "/sitemap.xml"]) {
        const discovery = await httpsGet(host, resource);
        check(`${host}${resource}: discovery denied through both proxies`, () => {
          assert.equal(discovery.status, resource === "/robots.txt" ? 200 : 404);
          if (resource === "/robots.txt") assert.match(discovery.body, /Disallow: \//);
          assert.match(discovery.headers["x-robots-tag"], /noindex/);
        });
      }
    }
    const directScript = `const h=require('http'); const r=h.get({hostname:'10.203.91.3',path:'/api/proxy-proof',headers:{Host:'api-staging.fleetum.it','X-Forwarded-For':'198.51.100.73','X-Forwarded-Proto':'https'}},s=>{let b='';s.on('data',c=>b+=c);s.on('end',()=>console.log(JSON.stringify({status:s.statusCode,body:b})));});r.on('error',()=>process.exit(1));`;
    const denied = JSON.parse(command(["run", "--rm", "--pull", "never", "--network", ingress, "--entrypoint", "node", options.backendImage, "-e", directScript]));
    check("another ingress peer cannot impersonate the trusted outer proxy", () => { assert.equal(denied.status, 403); assert.equal(denied.body, "Untrusted staging ingress"); });
    // Exercise the trusted namespace directly; do not infer rejection from a
    // client command failure or from logs instead of the actual HTTP response.
    const schemeScript = directScript.replace("'https'", "'http'");
    const badScheme = JSON.parse(command(["run", "--rm", "--pull", "never", "--network", `container:${outer}`, "--entrypoint", "node", options.backendImage, "-e", schemeScript]));
    check("even the trusted peer must attest the HTTPS scheme", () => { assert.equal(badScheme.status, 400); assert.equal(badScheme.body, "Invalid staging scheme"); });
    const unknownScript = directScript.replace("api-staging.fleetum.it", "attacker.invalid");
    const unknownInner = JSON.parse(command(["run", "--rm", "--pull", "never", "--network", `container:${outer}`, "--entrypoint", "node", options.backendImage, "-e", unknownScript]));
    check("inner HTTP proxy refuses unknown Host from the trusted outer peer", () => { assert.equal(unknownInner.status, 421); assert.equal(unknownInner.body, "Unknown staging host"); });
    report.ok = true;
  } catch (error) {
    report.ok = false; report.error = error.message;
    for (const name of names) {
      const logs = command(["logs", "--tail", "12", name], {}, true);
      if (logs) (report.fixtureLogs ??= {})[name] = logs;
    }
  } finally {
    for (const name of names) command(["rm", "-f", "-v", name], {}, true);
    for (const network of networks.reverse()) command(["network", "rm", network], {}, true);
    report.cleanup = names.every((name) => !command(["container", "inspect", "--format", "{{.Id}}", name], {}, true)) && networks.every((name) => !command(["network", "inspect", "--format", "{{.Id}}", name], {}, true));
    rmSync(fixture, { recursive: true, force: true });
    report.completedAt = new Date().toISOString();
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runSyntheticProxyProof(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2)); process.exitCode = report.ok && report.cleanup ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
