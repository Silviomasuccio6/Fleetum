import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRecoveryPolicy, transitionRecovery } from "./application-recovery-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function finalizeApplicationRecovery(actions) {
  const failures = [];
  for (const name of ["restoreClient", "stopChildren", "closeGateway", "removeSignalHandlers"]) {
    try { await actions[name](); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "Local application recovery cleanup failed");
}

export async function artifactInventory(directory) {
  const files = [];
  const walk = async (relative = "") => {
    const current = path.join(directory, relative);
    const currentInfo = await lstat(current); assert(currentInfo.isDirectory() && !currentInfo.isSymbolicLink(), "Artifact directory must be regular");
    for (const name of (await readdir(current)).sort()) {
      const file = path.join(relative, name); const info = await lstat(path.join(directory, file));
      assert(!info.isSymbolicLink(), "Artifact symlink refused");
      if (info.isDirectory()) await walk(file);
      else { assert(info.isFile()); files.push({ path: file.split(path.sep).join("/"), sizeBytes: info.size, sha256: digest(await readFile(path.join(directory, file))) }); }
    }
  };
  await walk(); assert(files.length > 0); return { count: files.length, sha256: digest(JSON.stringify(files)), files };
}

export async function exerciseApplicationRecovery({ archiveRoot, sourceSha, env, snapshot, runHttpSmoke, budgetMs = 30000 }) {
  assert(/^\/private\/tmp\/fleetum-restore-recovery-[A-Za-z0-9-]+\/reserve$/.test(archiveRoot));
  assert(/^[a-f0-9]{40}$/.test(sourceSha)); assert.equal(budgetMs, 30000);
  const backendDir = path.join(archiveRoot, "backend/dist"); const frontendDir = path.join(archiveRoot, "frontend/dist");
  const backend = await artifactInventory(backendDir); const frontend = await artifactInventory(frontendDir);
  const bundle = { sourceSha, schemaVersion: 48, backend: { sha256: backend.sha256, sourceSha }, frontend: { sha256: frontend.sha256, sourceSha } };
  const result = { success: false, trustedBundle: bundle, backendFiles: backend.count, frontendFiles: frontend.count, artifactInventories: { backend, frontend }, localBudgetMs: budgetMs, approvedExternalRtoRpo: false, previousProductionReleaseApproved: false, claims: "Recovery of a pinned tested local application/client pair after synthetic process/configuration faults; not rollback to a distinct previous production release or OCI images", scenarios: [], cleanup: {} };
  const children = new Set(); let active; let serving = false; let upstream = null; let generation = 0;
  const abortController = new AbortController();
  const stopOwned = async (owned, signal = "SIGTERM") => {
    if (!owned) return;
    if (owned.child.exitCode === null && owned.child.signalCode === null) {
      try { process.kill(-owned.child.pid, signal); } catch { /* Exited owned group. */ }
      const timeout = setTimeout(() => { try { process.kill(-owned.child.pid, "SIGKILL"); } catch { /* Already stopped. */ } }, 3000);
      await owned.done; clearTimeout(timeout);
    } else await owned.done;
    children.delete(owned);
  };
  const onSignal = () => { serving = false; abortController.abort(); for (const owned of children) { try { process.kill(-owned.child.pid, "SIGKILL"); } catch { /* Own group exited. */ } } };
  process.on("SIGTERM", onSignal); process.on("SIGINT", onSignal);
  const stateDir = path.join(archiveRoot, "recovery-state"); await mkdir(stateDir, { mode: 0o700 });
  const start = (mode) => {
    const processGeneration = randomUUID();
    const child = spawn(process.execPath, [path.join(root, "ops/fixtures/application-recovery-server.mjs"), archiveRoot, sourceSha], { cwd: archiveRoot, env: { ...env, LOCAL_RECOVERY_MODE: mode, LOCAL_READY_FILE: path.join(stateDir, `${processGeneration}.json`), LOCAL_GENERATION: processGeneration }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const owned = { child, processGeneration, receipts: [], error: null };
    let buffer = ""; let size = 0;
    child.stdout.on("data", (bytes) => {
      size += bytes.length; if (size > 32768) { try { process.kill(-child.pid, "SIGKILL"); } catch {} return; }
      buffer += bytes.toString("utf8"); let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (line.startsWith("FLEETUM_APPLICATION_SERVER ")) { try { owned.receipts.push(JSON.parse(line.slice("FLEETUM_APPLICATION_SERVER ".length))); } catch { owned.error = "Invalid process receipt"; } }
      }
    });
    child.stderr.on("data", () => {}); // Never persist raw application/provider/credential errors.
    owned.done = new Promise((resolve) => { child.once("error", () => { owned.error = "Owned process start failed"; resolve({ exitCode: 1 }); }); child.once("close", (code, signal) => resolve({ exitCode: code, signal })); });
    child.once("error", () => { if (active === owned) { serving = false; upstream = null; } });
    child.once("close", () => { if (active === owned) { serving = false; upstream = null; } });
    children.add(owned); return owned;
  };
  const receipt = async (owned, phase, deadline) => {
    while (performance.now() < deadline) {
      abortController.signal.throwIfAborted(); if (owned.error) throw new Error(owned.error);
      const value = owned.receipts.find((item) => item.phase === phase);
      if (value) { assert.equal(value.generation, owned.processGeneration); assert.equal(value.sourceSha, sourceSha); return value; }
      if (owned.child.exitCode !== null || owned.child.signalCode !== null) throw new Error("Owned application exited before required phase");
      await pause(25);
    }
    throw new Error("Local application phase budget exceeded");
  };
  const request = async (url) => {
    const parsed = new URL(url); assert.equal(parsed.hostname, "127.0.0.1"); assert.equal(parsed.protocol, "http:");
    return fetch(parsed, { redirect: "error", signal: AbortSignal.timeout(2000) });
  };
  const observeReady = async (info) => {
    const probe = async (port, endpoint) => { const response = await request(`http://127.0.0.1:${port}${endpoint}`); const body = await response.json(); return { status: response.status, body, observedAtMs: performance.now() }; };
    const [api, platform] = await Promise.all([probe(info.apiPort, "/api/ready"), probe(info.platformPort, "/platform-api/ready")]);
    return { api, platform };
  };
  const gateway = http.createServer((req, res) => {
    res.setHeader("x-robots-tag", "noindex, nofollow");
    if (!serving || !upstream) { res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" }).end('{"ok":false,"service":"synthetic-maintenance"}'); return; }
    if (req.url?.startsWith("/api/") || req.url?.startsWith("/platform-api/")) {
      const port = req.url.startsWith("/platform-api/") ? upstream.platformPort : upstream.apiPort;
      const proxy = http.request({ host: "127.0.0.1", port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (response) => { res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res); });
      proxy.on("error", () => { if (!res.headersSent) res.writeHead(503); res.end(); }); req.pipe(proxy); return;
    }
    void (async () => {
      assert(["GET", "HEAD"].includes(req.method));
      const pathname = new URL(req.url, "http://127.0.0.1").pathname;
      const file = pathname === "/" ? "index.html" : pathname.slice(1);
      const metadata = frontend.files.find((item) => item.path === file); if (!metadata) { res.writeHead(404).end(); return; }
      const bytes = await readFile(path.join(frontendDir, file)); assert.equal(digest(bytes), metadata.sha256);
      res.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".png") ? "image/png" : file.endsWith(".woff2") ? "font/woff2" : "application/octet-stream", "x-synthetic-source": sourceSha, "x-synthetic-generation": String(generation), "cache-control": "no-store" }); res.end(req.method === "HEAD" ? undefined : bytes);
    })().catch(() => { if (!res.headersSent) res.writeHead(503); res.end(); });
  });
  const dataProof = (value) => ({ count: value.tables.reduce((sum, table) => sum + table.rowCount, 0), sha256: value.sha256 });
  const assertMaintenance = async (checks) => { for (const endpoint of ["/", "/api/ready", "/platform-api/ready"]) assert.equal((await request(`${base}${endpoint}`)).status, 503); checks.push("all-public-surfaces-held-in-maintenance"); };
  let base; let originalIndex;
  try {
    await new Promise((resolve, reject) => { gateway.once("error", reject); gateway.listen(0, "127.0.0.1", resolve); }); base = `http://127.0.0.1:${gateway.address().port}`;
    for (const mode of ["startup-rejected", "database-unready", "pause-before-import", "client-artifact-mismatch"]) {
      const checks = []; const baseline = start("trusted"); active = baseline;
      const baselineInfo = await receipt(baseline, "listening", performance.now() + budgetMs); const healthy = await observeReady(baselineInfo); assert.equal(healthy.api.status, 200); assert.equal(healthy.platform.status, 200);
      upstream = baselineInfo; serving = true; generation++;
      await runHttpSmoke(base, `before-${mode}`); checks.push("acknowledged-cookie-csrf-business-write-and-download-before-fault");
      const before = await snapshot(); const uploadBefore = await artifactInventory(path.join(archiveRoot, "uploads")); const initialClient = await request(`${base}/`); assert.equal(initialClient.status, 200); assert.equal(digest(Buffer.from(await initialClient.arrayBuffer())), frontend.files.find((f) => f.path === "index.html").sha256);
      const failureAtMs = performance.now(); const deadline = failureAtMs + budgetMs; serving = false; await assertMaintenance(checks);
      await stopOwned(baseline); active = null; upstream = null;
      let state = createRecoveryPolicy({ trustedBundle: bundle, failureAtMs, budgetMs, readyMaxAgeMs: 1000 }); state = transitionRecovery(state, { type: "stop", atMs: performance.now() });
      let corruptedIndex;
      if (mode === "client-artifact-mismatch") {
        corruptedIndex = await readFile(path.join(frontendDir, "index.html")); originalIndex = corruptedIndex; await writeFile(path.join(frontendDir, "index.html"), Buffer.concat([corruptedIndex, Buffer.from("\n<!-- synthetic wrong client -->\n")]));
      } else {
        const failing = start(mode); active = failing;
        if (mode === "startup-rejected") { let timer; const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Failed startup did not exit within local budget")), Math.max(1, deadline - performance.now())); }); let outcome; try { outcome = await Promise.race([failing.done, timeout]); } finally { clearTimeout(timer); } assert.equal(outcome.exitCode, 1); assert.equal(failing.receipts.filter((r) => r.phase === "listening").length, 0); checks.push("real-invalid-config-startup-exits-nonzero-without-ready"); }
        else if (mode === "database-unready") { const info = await receipt(failing, "listening", deadline); const unhealthy = await observeReady(info); assert.equal(unhealthy.api.status, 503); assert.equal(unhealthy.api.body.db, "down"); assert.equal(unhealthy.platform.status, 503); assert.equal((await request(`http://127.0.0.1:${info.apiPort}/api/health`)).status, 200); checks.push("real-api-and-platform-unready-despite-health-200"); }
        else { await receipt(failing, "starting", deadline); await stopOwned(failing, "SIGKILL"); const outcome = await failing.done; assert.equal(outcome.signal, "SIGKILL"); checks.push("owned-startup-interrupted-before-api-listening"); }
        await stopOwned(failing); active = null;
      }
      assert.deepEqual(await snapshot(), before); checks.push("every-database-table-unchanged-during-failed-start"); await assertMaintenance(checks);
      state = transitionRecovery(state, { type: "start", atMs: performance.now(), bundle });
      const recovered = start("trusted"); active = recovered; const info = await receipt(recovered, "listening", deadline);
      const actualBundle = async () => ({ sourceSha, schemaVersion: 48, backend: { sha256: (await artifactInventory(backendDir)).sha256, sourceSha }, frontend: { sha256: (await artifactInventory(frontendDir)).sha256, sourceSha } });
      const evidence = async () => { const observed = await actualBundle(); const probes = await observeReady(info); return { schemaVersion: 48, api: { ...probes.api, generation: state.generation, bundle: observed }, platform: { ...probes.platform, generation: state.generation, bundle: observed } }; };
      if (corruptedIndex) { const badEvidence = await evidence(); assert.throws(() => transitionRecovery(state, { type: "ready", atMs: performance.now(), evidence: badEvidence })); await assertMaintenance(checks); checks.push("healthy-api-with-wrong-client-pair-cannot-open-traffic"); await writeFile(path.join(frontendDir, "index.html"), corruptedIndex); originalIndex = null; }
      const readyEvidence = await evidence(); state = transitionRecovery(state, { type: "ready", atMs: performance.now(), evidence: readyEvidence });
      const after = await snapshot(); assert.deepEqual(after, before); const uploadAfter = await artifactInventory(path.join(archiveRoot, "uploads")); assert.deepEqual(uploadAfter, uploadBefore); state = transitionRecovery(state, { type: "serve", atMs: performance.now(), dataEvidence: { before: dataProof(before), after: dataProof(after) } });
      checks.push("trusted-artifact-pair-and-both-readiness-probes-verified", "zero-acknowledged-database-record-loss-before-reopening", "all-registered-upload-bytes-preserved-before-reopening"); abortController.signal.throwIfAborted(); assert.equal(recovered.child.exitCode, null); assert.equal(recovered.child.signalCode, null); assert.equal(active, recovered); upstream = info; serving = !state.maintenance; generation++;
      const page = await request(`${base}/`); assert.equal(page.status, 200); assert.equal(digest(Buffer.from(await page.arrayBuffer())), frontend.files.find((f) => f.path === "index.html").sha256);
      const script = frontend.files.find((f) => f.path.startsWith("assets/") && f.path.endsWith(".js")); assert(script); const js = await request(`${base}/${script.path}`); assert.equal(js.status, 200); assert.equal(digest(Buffer.from(await js.arrayBuffer())), script.sha256); const style = frontend.files.find((f) => f.path.startsWith("assets/") && f.path.endsWith(".css")); assert(style); const css = await request(`${base}/${style.path}`); assert.equal(css.status, 200); assert.equal(css.headers.get("content-type"), "text/css"); assert.equal(digest(Buffer.from(await css.arrayBuffer())), style.sha256); checks.push("frontend-page-javascript-and-css-restored-byte-for-byte");
      await runHttpSmoke(base, `after-${mode}`); checks.push("real-cookie-csrf-tenant-business-and-modern-legacy-downloads-recovered");
      result.scenarios.push({ mode, success: true, checks, recoveryMs: state.rtoMs, acknowledgedDataLoss: state.rpoAcknowledgedRecordsLost, dataLossScope: "all synthetic database records present at failure; registered local upload byte inventory preserved", registeredUploadsPreserved: uploadBefore.count, uploadBeforeSha256: uploadBefore.sha256, uploadAfterSha256: uploadAfter.sha256, tablesPreserved: before.tableCount, recordsPreserved: dataProof(before).count, beforeSha256: before.sha256, afterSha256: after.sha256, generation: state.generation, frontendAndBackendSameTrustedSource: true });
      serving = false; await stopOwned(recovered); active = null; upstream = null;
    }
    result.success = true; return result;
  } finally {
    serving = false;
    await finalizeApplicationRecovery({
      restoreClient: async () => { if (originalIndex) await writeFile(path.join(frontendDir, "index.html"), originalIndex); },
      stopChildren: async () => { const outcomes = await Promise.allSettled([...children].map((owned) => stopOwned(owned))); if (outcomes.some((item) => item.status === "rejected")) throw new Error("Owned application child cleanup failed"); },
      closeGateway: async () => { gateway.closeAllConnections(); await new Promise((resolve) => gateway.close(() => resolve())); },
      removeSignalHandlers: () => { process.removeListener("SIGTERM", onSignal); process.removeListener("SIGINT", onSignal); result.cleanup = { childrenStopped: children.size === 0, gatewayClosed: !gateway.listening }; }
    });
  }
}
