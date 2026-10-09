import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, test } from "node:test";
import { platformAdminUseCases } from "../src/application/usecases/platform/platform-admin-usecases";
import { platformAuthStorage } from "../src/infrastructure/platform/platform-auth-storage";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; platformAuthStorage.clear(); });
const result = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("Platform logout waits for the server acknowledgement before clearing the local bearer", async () => {
  platformAuthStorage.set("synthetic-platform-bearer");
  let reply!: (response: Response) => void;
  let request: { input: string; init: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => {
    request = { input: String(input), init: init! };
    return new Promise<Response>((resolve) => { reply = resolve; });
  }) as typeof fetch;
  const logout = platformAdminUseCases.logout();
  assert.equal(platformAuthStorage.get(), "synthetic-platform-bearer");
  assert.equal(request?.input, "/platform-api/auth/logout");
  assert.equal(request?.init.method, "POST");
  assert.equal((request?.init.headers as Record<string, string>).Authorization, "Bearer synthetic-platform-bearer");
  reply(result(200, { revoked: true }));
  await logout;
  assert.equal(platformAuthStorage.get(), null);
});
for (const status of [403, 429, 500, 503]) test(`logout HTTP ${status} preserves bearer for an explicit retry`, async () => {
  platformAuthStorage.set("synthetic-platform-bearer");
  globalThis.fetch = async () => result(status, { error: "SYNTHETIC_FAILURE", message: "Riprova" });
  await assert.rejects(async () => platformAdminUseCases.logout());
  assert.equal(platformAuthStorage.get(), "synthetic-platform-bearer");
});
test("logout network failure preserves bearer for retry", async () => {
  platformAuthStorage.set("synthetic-platform-bearer");
  globalThis.fetch = async () => { throw new TypeError("Synthetic network failure"); };
  await assert.rejects(async () => platformAdminUseCases.logout());
  assert.equal(platformAuthStorage.get(), "synthetic-platform-bearer");
});
for (const error of ["PLATFORM_SESSION_REVOKED", "PLATFORM_SESSION_EXPIRED"]) test(`confirmed ${error} clears unusable local bearer`, async () => {
  platformAuthStorage.set("synthetic-platform-bearer");
  globalThis.fetch = async () => result(401, { error });
  await platformAdminUseCases.logout();
  assert.equal(platformAuthStorage.get(), null);
});
test("unclassified unauthorized response does not claim revocation", async () => {
  platformAuthStorage.set("synthetic-platform-bearer");
  globalThis.fetch = async () => result(401, { error: "UNAUTHORIZED" });
  await assert.rejects(async () => platformAdminUseCases.logout());
  assert.equal(platformAuthStorage.get(), "synthetic-platform-bearer");
});
test("an old logout response cannot clear a newly logged-in session", async () => {
  platformAuthStorage.set("synthetic-old-bearer");
  globalThis.fetch = async () => {
    platformAuthStorage.set("synthetic-new-bearer");
    return result(200, { revoked: true });
  };
  await platformAdminUseCases.logout();
  assert.equal(platformAuthStorage.get(), "synthetic-new-bearer");
});

test("an old unauthorized response cannot clear the new session or authorize login navigation", async () => {
  platformAuthStorage.set("synthetic-old-bearer");
  globalThis.fetch = async () => {
    platformAuthStorage.set("synthetic-new-bearer");
    return result(401, { error: "UNAUTHORIZED", message: "Sessione scaduta" });
  };
  let failure: unknown;
  try { await platformAdminUseCases.overview(); } catch (error) { failure = error; }
  assert(failure);
  const shouldNavigate = (platformAdminUseCases as any).clearSessionForAuthError(failure);
  assert.equal(shouldNavigate, false);
  assert.equal(platformAuthStorage.get(), "synthetic-new-bearer");
  assert.equal(JSON.stringify(failure).includes("synthetic-old-bearer"), false);
  assert.equal(JSON.stringify(failure).includes("synthetic-new-bearer"), false);
});
test("a current unauthorized response clears its session and authorizes login navigation", async () => {
  platformAuthStorage.set("synthetic-current-bearer");
  globalThis.fetch = async () => result(401, { error: "PLATFORM_SESSION_REVOKED" });
  let failure: unknown;
  try { await platformAdminUseCases.overview(); } catch (error) { failure = error; }
  assert.equal((platformAdminUseCases as any).clearSessionForAuthError(failure), true);
  assert.equal(platformAuthStorage.get(), null);
});
for (const status of [200, 401]) test(`old logout HTTP ${status} does not authorize navigation after a newer login`, async () => {
  platformAuthStorage.set("synthetic-old-bearer");
  globalThis.fetch = async () => {
    platformAuthStorage.set("synthetic-new-bearer");
    return result(status, status === 200 ? { revoked: true } : { error: "PLATFORM_SESSION_EXPIRED" });
  };
  const acknowledged = await platformAdminUseCases.logout();
  assert.equal((acknowledged as any)?.sessionCleared, false);
  assert.equal(platformAuthStorage.get(), "synthetic-new-bearer");
});
test("current confirmed logout authorizes navigation only after clearing its session", async () => {
  platformAuthStorage.set("synthetic-current-bearer");
  globalThis.fetch = async () => result(200, { revoked: true });
  const acknowledged = await platformAdminUseCases.logout();
  assert.equal((acknowledged as any)?.sessionCleared, true);
  assert.equal(platformAuthStorage.get(), null);
});


// Execute the actual layout callback with real usecases/storage. This verifies
// navigation timing without substituting a copy of the UI implementation.
const actualLayoutLogout = (events: string[]) => {
  const path = new URL("../src/presentation/components/layout/platform-admin-layout.tsx", import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === "onClick" &&
      node.initializer?.getText(source).includes("await platformAdminUseCases.logout()")) {
      expression = (node.initializer as ts.JsxExpression).expression;
    }
    ts.forEachChild(node, visit);
  };
  visit(source); assert(expression, "Find the actual logout button callback");
  const callback = ts.transpileModule(`const run = ${expression.getText(source)}; run`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  return vm.runInNewContext(callback, {
    platformAdminUseCases, platformAuthStorage,
    setLoggingOut: () => {}, snackbar: { error: () => events.push("error") }, navigate: (url: string) => events.push(url)
  }) as () => Promise<void>;
};
test("actual layout does not navigate when a newer login runs after clear but before awaited logout resumes", async () => {
  const events: string[] = [];
  const callback = actualLayoutLogout(events);
  platformAuthStorage.set("synthetic-old-bearer");
  globalThis.fetch = async () => result(200, { revoked: true });
  const originalClear = platformAuthStorage.clear;
  platformAuthStorage.clear = () => {
    originalClear();
    queueMicrotask(() => platformAuthStorage.set("synthetic-new-bearer"));
  };
  try {
    await callback();
    assert.equal(platformAuthStorage.get(), "synthetic-new-bearer");
    assert.deepEqual(events, []);
  } finally { platformAuthStorage.clear = originalClear; }
});
test("actual layout does not navigate after empty-session logout if a new login is queued before continuation", async () => {
  const events: string[] = [];
  const callback = actualLayoutLogout(events);
  platformAuthStorage.clear();
  queueMicrotask(() => platformAuthStorage.set("synthetic-new-bearer"));
  await callback();
  assert.equal(platformAuthStorage.get(), "synthetic-new-bearer");
  assert.deepEqual(events, []);
});
test("actual layout navigates to login for a confirmed current logout", async () => {
  const events: string[] = [];
  const callback = actualLayoutLogout(events);
  platformAuthStorage.set("synthetic-current-bearer");
  globalThis.fetch = async () => result(200, { revoked: true });
  await callback();
  assert.equal(platformAuthStorage.get(), null);
  assert.deepEqual(events, ["/login"]);
});

const actualPageAuthFailure = (events: string[]) => {
  const path = new URL("../src/presentation/pages/platform/platform-admin-page.tsx", import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const initializers = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer &&
      ["isPlatformAuthError", "handlePlatformAuthError"].includes(node.name.getText(source))) {
      initializers.set(node.name.getText(source), node.initializer.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source); assert.equal(initializers.size, 2);
  const callback = ts.transpileModule(`const isPlatformAuthError = ${initializers.get("isPlatformAuthError")};
const run = ${initializers.get("handlePlatformAuthError")}; run`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  return vm.runInNewContext(callback, { platformAdminUseCases,
    snackbar: { error: () => events.push("error") }, navigate: (url: string) => events.push(url)
  }) as (error: unknown) => boolean;
};
for (const stale of [false, true]) test(`actual page auth-error handler ${stale ? "ignores an old" : "clears a current"} request after unauthorized response`, async () => {
  const events: string[] = [];
  const handle = actualPageAuthFailure(events);
  platformAuthStorage.set("synthetic-old-bearer");
  globalThis.fetch = async () => {
    if (stale) platformAuthStorage.set("synthetic-new-bearer");
    return result(401, { error: "PLATFORM_SESSION_REVOKED" });
  };
  let failure: unknown;
  try { await platformAdminUseCases.overview(); } catch (error) { failure = error; }
  assert(failure); assert.equal(handle(failure), true);
  assert.equal(platformAuthStorage.get(), stale ? "synthetic-new-bearer" : null);
  assert.deepEqual(events, stale ? [] : ["error", "/login"]);
});
