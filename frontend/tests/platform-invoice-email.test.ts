import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, test } from "node:test";
import { platformAdminUseCases } from "../src/application/usecases/platform/platform-admin-usecases";
import { platformAuthStorage } from "../src/infrastructure/platform/platform-auth-storage";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; platformAuthStorage.clear(); });

// Run the actual page callback with the real use case, retaining its refs across
// invocations. Only React setters/notifications and the network are test doubles.
const actualSendInvoice = () => {
  const path = new URL("../src/presentation/pages/platform/platform-admin-page.tsx", import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "sendInvoice") expression = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source); assert(expression, "Find the actual invoice send callback");
  const callback = ts.transpileModule(`const run = ${expression.getText(source)}; run`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  let sequence = 0;
  return vm.runInNewContext(callback, {
    platformAdminUseCases,
    operationLocks: { current: new Set<string>() },
    invoiceEmailRequestKeys: { current: new Map<string, string>() },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` },
    setPendingOperations: () => {}, setOperationError: () => {}, setInvoiceLoading: () => {}, setInvoices: () => {},
    snackbar: { success: () => {}, error: () => {} }, handlePlatformAuthError: () => false,
    load: async () => {}
  }) as (invoice: { id: string }) => Promise<void>;
};

const keyFrom = (init?: RequestInit) => (init?.headers as Record<string, string>)["X-Idempotency-Key"];
const success = () => Response.json({ data: { id: "synthetic-invoice", invoiceNumber: "QA-001" } });

test("invoice retry keeps the same request key until acknowledged; a later intentional send uses a new key", async () => {
  platformAuthStorage.set("synthetic-platform-bearer");
  const send = actualSendInvoice();
  const keys: string[] = [];
  globalThis.fetch = async (_input, init) => {
    keys.push(keyFrom(init));
    if (keys.length === 1) return Response.json({ message: "Synthetic temporary failure" }, { status: 503 });
    return success();
  };
  await send({ id: "synthetic-invoice" });
  await send({ id: "synthetic-invoice" });
  await send({ id: "synthetic-invoice" });
  assert.equal(keys.length, 3);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
});

test("two concurrent clicks on send issue one request and release the UI lock after acknowledgement", async () => {
  platformAuthStorage.set("synthetic-platform-bearer");
  const send = actualSendInvoice();
  let requests = 0;
  let reply!: (response: Response) => void;
  globalThis.fetch = async () => { requests++; return new Promise<Response>((resolve) => { reply = resolve; }); };
  const first = send({ id: "synthetic-invoice" });
  const duplicate = send({ id: "synthetic-invoice" });
  assert.equal(requests, 1);
  reply(success());
  await Promise.all([first, duplicate]);
  globalThis.fetch = async () => { requests++; return success(); };
  await send({ id: "synthetic-invoice" });
  assert.equal(requests, 2);
});
