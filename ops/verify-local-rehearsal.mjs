import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import http from "node:http";
import net from "node:net";
import { randomBytes } from "node:crypto";

// Opt-in only. No existing database, env file, provider credentials or production server.
if (!process.argv.includes("--run")) {
  console.log("Usage: node ops/verify-local-rehearsal.mjs --run [--evidence-dir <directory>] [--source-sha <commit>]");
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const option = (name) => process.argv[process.argv.indexOf(name) + 1];
const evidence = path.resolve(process.argv.includes("--evidence-dir") ? option("--evidence-dir") : path.join(root, "output/playwright/local-rehearsal"));
const sourceSha = process.argv.includes("--source-sha") ? option("--source-sha") : "unrecorded";
if (sourceSha !== "unrecorded" && !/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("Invalid source SHA");
const scratch = await mkdtemp(path.join(tmpdir(), "fleetum-local-rehearsal-"));
const container = `fleetum_rehearsal_${randomBytes(6).toString("hex")}`;
const children = new Set();
const backgroundCompletions = [];
const resources = [];
const tunnelSockets = new Set();
let interrupted = false;
let cleaning = false;
const killChild = (child, signal) => {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch { /* The owned process group already exited. */ }
};
const hardStops = [];
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = true;
  const active = [...children];
  for (const child of active) killChild(child, "SIGTERM");
  const hardStop = setTimeout(() => { for (const child of active) killChild(child, "SIGKILL"); }, 2000);
  hardStop.unref(); hardStops.push(hardStop);
});
const password = `Synthetic-${randomBytes(18).toString("hex")}`;
const cleanEnv = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch,
  NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null", CHECKPOINT_DISABLE: "1",
  npm_config_userconfig: "/dev/null", npm_config_globalconfig: path.join(scratch, "npmrc"),
  npm_config_audit: "false", npm_config_fund: "false", DOCKER_CONFIG: path.join(scratch, "docker-config"),
  DEMO_ADMIN_PASSWORD: password, UPLOAD_DIR: path.join(scratch, "uploads"),
  E2E_TENANT_EMAIL: "rehearsal-a@example.invalid", E2E_OTHER_TENANT_EMAIL: "rehearsal-b@example.invalid",
  E2E_TENANT_PASSWORD: password, E2E_OTHER_TENANT_PASSWORD: password
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await mkdir(evidence, { recursive: true });
await writeFile(cleanEnv.npm_config_globalconfig, "");
const logs = [];
async function run(command, args, logName, { background = false, allowFailure = false } = {}) {
  if (interrupted && !cleaning) throw new Error("Local rehearsal interrupted");
  const child = spawn(command, args, { cwd: root, env: cleanEnv, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
  const finished = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => { void (async () => {
      children.delete(child);
      const sanitized = output.split(password).join("<synthetic-password-redacted>");
      await writeFile(path.join(evidence, logName), sanitized);
      logs.push({ command: [command, ...args].join(" ").split(password).join("<synthetic-password-redacted>"), log: logName, code, signal });
      if (code !== 0 && !allowFailure && !background) reject(new Error(`${logName} failed (${code}); inspect the evidence log`));
      else resolve({ code, output });
    })().catch(reject); });
  });
  // Keep background-process failures observable without an unhandled rejection.
  if (background) { backgroundCompletions.push(finished); void finished.catch(() => {}); return { child, finished }; }
  return finished;
}
async function waitFor(check, label) {
  for (let i = 0; i < 60; i++) { if (interrupted) throw new Error("Local rehearsal interrupted"); if (await check()) return; await sleep(500); }
  throw new Error(`${label} did not become ready`);
}
let success = false;
let cleanupResult = "not-run";
let gateway;
let blockedBrowserRequests = 0;
try {
  // Use only a local Unix socket, ignoring saved Docker contexts and registry credentials.
  for (const socket of [path.join(process.env.HOME ?? "", ".docker/run/docker.sock"), "/var/run/docker.sock"]) {
    try { if ((await stat(socket)).isSocket()) { cleanEnv.DOCKER_HOST = `unix://${socket}`; break; } } catch {}
  }
  if (!cleanEnv.DOCKER_HOST) throw new Error("No local Docker Unix socket; remote contexts are not allowed");
  await mkdir(cleanEnv.DOCKER_CONFIG);
  for (const directory of ["", "backend", "frontend", "website"]) {
    for (const name of await readdir(path.join(root, directory))) {
      if (/^\.env(?:\.|$)/.test(name) && !name.endsWith(".example")) throw new Error("Refusing source directory containing real env files");
    }
  }
  console.log("[rehearsal] Starting isolated PostgreSQL and synthetic tenants");
  await run("docker", ["info"], "docker-info.log");
  await run("docker", ["run", "--rm", "-d", "--name", container, "-e", "POSTGRES_USER=fleetum", "-e", `POSTGRES_PASSWORD=${password}`,
    "-e", "POSTGRES_DB=fleetum_rehearsal", "-p", "127.0.0.1::5432", "postgres:16-alpine"], "docker-start.log");
  await waitFor(async () => (await run("docker", ["exec", container, "pg_isready", "-U", "fleetum", "-d", "fleetum_rehearsal"], "postgres-ready.log", { allowFailure: true })).code === 0, "PostgreSQL");
  const port = (await run("docker", ["port", container, "5432/tcp"], "postgres-port.log")).output.trim().split(":").at(-1);
  if (!/^\d+$/.test(port)) throw new Error("Invalid database port");
  cleanEnv.DATABASE_URL = `postgresql://fleetum:${password}@127.0.0.1:${port}/fleetum_rehearsal?schema=public`;
  await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "backend/prisma/schema.prisma"], "migrations.log");
  await run(process.execPath, ["--import", "tsx", "backend/prisma/seed.ts"], "seed.log");
  const cert = path.join(scratch, "localhost.crt");
  const key = path.join(scratch, "localhost.key");
  await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=Fleetum synthetic localhost",
    "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost", "-keyout", key, "-out", cert], "local-tls.log");
  let apiPort = 0;
  let frontendPort = 0;
  gateway = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
    const upstreamPort = req.url?.startsWith("/api/") ? apiPort : frontendPort;
    if (!upstreamPort) { res.writeHead(503).end(); return; }
    const upstream = http.request({ host: "127.0.0.1", port: upstreamPort, path: req.url, method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` } }, (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
    });
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const baseUrl = `https://127.0.0.1:${gateway.address().port}`;
  Object.assign(cleanEnv, {
    NODE_EXTRA_CA_CERTS: cert, APP_URL: baseUrl, CORS_ORIGIN: baseUrl, BACKEND_PUBLIC_URL: baseUrl,
    VITE_API_BASE_URL: `${baseUrl}/api`, E2E_BASE_URL: baseUrl, E2E_API_URL: `${baseUrl}/api`,
    FLEETUM_REHEARSAL_READY_FILE: path.join(scratch, "api-ready.json")
  });
  const api = await run(process.execPath, ["--import", "tsx", "ops/e2e/local-api.mts"], "api.log", { background: true });
  await waitFor(async () => {
    if (api.child.exitCode !== null) throw new Error("Synthetic API exited; inspect api.log");
    try { apiPort = JSON.parse(await readFile(cleanEnv.FLEETUM_REHEARSAL_READY_FILE, "utf8")).port; return true; } catch { return false; }
  }, "Synthetic API");
  console.log("[rehearsal] Building frontend for loopback HTTPS only");
  await run("npm", ["run", "build", "-w", "frontend"], "frontend-build.log");
  const { preview } = await import("vite");
  const frontend = await preview({ root: path.join(root, "frontend"), mode: "production", envDir: false,
    preview: { host: "127.0.0.1", port: 0, strictPort: false } });
  resources.push(frontend.httpServer);
  frontendPort = frontend.httpServer.address().port;
  // A browser-wide proxy permits only the local HTTPS gateway, including literal IP URLs.
  const browserProxy = http.createServer((_req, res) => { blockedBrowserRequests++; res.writeHead(403).end(); });
  browserProxy.on("connect", (req, client, head) => {
    if (req.url !== `127.0.0.1:${gateway.address().port}`) {
      blockedBrowserRequests++; client.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return;
    }
    const upstream = net.connect(gateway.address().port, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    });
    for (const socket of [client, upstream]) {
      tunnelSockets.add(socket);
      socket.on("close", () => { tunnelSockets.delete(socket); client.destroy(); upstream.destroy(); });
      socket.on("error", () => { client.destroy(); upstream.destroy(); });
    }
  });
  resources.push(browserProxy);
  await new Promise((resolve) => browserProxy.listen(0, "127.0.0.1", resolve));
  const proxyUrl = `http://127.0.0.1:${browserProxy.address().port}`;
  const configPath = path.join(root, `.rehearsal-${process.pid}.config.ts`);
  const reportPath = path.join(evidence, "playwright-report.json");
  await writeFile(configPath, `import base from "./playwright.config";\nexport default {...base, workers:1, retries:0, reporter:[["list"],["json",{outputFile:${JSON.stringify(reportPath)}}]], outputDir:${JSON.stringify(path.join(evidence, "artifacts"))}, use:{...base.use, serviceWorkers:"block", ignoreHTTPSErrors:true, launchOptions:{proxy:{server:${JSON.stringify(proxyUrl)},bypass:"<-loopback>"}, args:["--proxy-bypass-list=<-loopback>"]}}};\n`);
  try {
    await run(process.execPath, ["ops/e2e/validate-config.mjs"], "e2e-config.log");
    console.log("[rehearsal] Running the six critical browser/API cases with zero skips");
    await run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", configPath, "--project=chromium"], "e2e.log");
    await run(process.execPath, ["ops/e2e/verify-report.mjs", reportPath], "e2e-gate.log");
    success = true;
  } finally { await rm(configPath, { force: true }); }
} catch (error) {
  await writeFile(path.join(evidence, "failure.txt"), `${error.message}\n`);
  console.error(error.message);
} finally {
  cleaning = true;
  for (const child of children) killChild(child, "SIGTERM");
  await sleep(500);
  for (const child of children) killChild(child, "SIGKILL");
  await Promise.allSettled(backgroundCompletions);
  for (const socket of tunnelSockets) socket.destroy();
  for (const server of [...resources, gateway].filter(Boolean)) { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
  try {
    if (cleanEnv.DOCKER_HOST) {
      const cleanup = await run("docker", ["rm", "-f", container], "cleanup.log", { allowFailure: true });
      cleanupResult = cleanup.code === 0 ? "removed" : "check-cleanup-log";
    } else cleanupResult = "not-created";
  } catch { cleanupResult = "check-cleanup-log"; }
  finally { await rm(scratch, { recursive: true, force: true }); }
  for (const timer of hardStops) clearTimeout(timer);
  await writeFile(path.join(evidence, "summary.json"), JSON.stringify({ success, sourceSha, cleanup: cleanupResult,
    environment: "loopback HTTPS / local Docker Unix socket / PostgreSQL 16 / two synthetic tenants / no cron / simulated email / external HTTP blocked",
    interrupted, blockedBrowserRequests,
    externalGates: "Hosted CI, real staging, provider sandbox, storage, proxy, load and retention remain separate", logs }, null, 2));
}
process.exitCode = success && !interrupted && cleanupResult === "removed" ? 0 : 1;
