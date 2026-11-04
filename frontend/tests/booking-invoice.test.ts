import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { translateText } from "../src/presentation/i18n/fleetum-language";

function adapter(res: Response) {
  let request: any;
  const exports: any = {};
  const source = readFileSync(new URL("../src/application/usecases/booking-invoice-usecases.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, TextDecoder, fetch: async (url: string, options: any) => { request = { url, options }; return res; }, require: () => ({ getApiBaseUrl: () => "/api", scopedFetch: async (url: string, options: any) => { request = {url, options}; return res; } }) });
  return { read: exports.downloadBookingInvoiceDraft as (id: string, signal?: AbortSignal) => Promise<Blob>, request: () => request };
}
test("invoice download uses the encoded booking ID, private credentials, no cache and cancellation", async () => {
  const controller = new AbortController(), a = adapter(new Response("%PDF-1.7 synthetic", { headers: { "Content-Type": "application/pdf" } }));
  const blob = await a.read("booking/id", controller.signal); assert.ok(blob.size > 5);
  assert.equal(a.request().url, "/api/rental-bookings/booking%2Fid/invoice/draft.pdf");
  assert.equal(a.request().options.credentials, "include"); assert.equal(a.request().options.cache, "no-store"); assert.equal(a.request().options.signal, controller.signal);
});
test("invoice errors preserve an actionable server message and reject HTML or malformed PDFs", async () => {
  const a = adapter(new Response(JSON.stringify({ message: "Completa le condizioni economiche" }), { status: 409 }));
  await assert.rejects(() => a.read("booking"), /Completa le condizioni/);
  for (const [body, type] of [["<html>Login</html>", "text/html"], ["not a PDF", "application/pdf"], ["", "application/pdf"]]) {
    await assert.rejects(() => adapter(new Response(body, { headers: { "Content-Type": type } })).read("booking"), /PDF valido/);
  }
});

type Pending = { id: string; signal: AbortSignal; resolve(value: Blob): void; reject(error: Error): void };
function component() {
  const states: any[] = [], refs: any[] = [], pending: Pending[] = [], clicks: string[] = [], revoked: string[] = [], timers: Array<() => void> = [];
  let si = 0, ri = 0, effect: { deps: any[]; cleanup?: () => void } | undefined;
  const exports: any = {}, source = readFileSync(new URL("../src/presentation/components/bookings/booking-invoice-section.tsx", import.meta.url), "utf8");
  const jsx = (type: any, props: any) => ({ type, props });
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, AbortController, URL: { createObjectURL: () => "blob:synthetic", revokeObjectURL: (value: string) => revoked.push(value) },
    window: { setTimeout: (fn: () => void) => timers.push(fn) }, document: { body: { appendChild() {} }, createElement: () => ({ download: "", click() { clicks.push(this.download); }, remove() {} }) },
    require(id: string) {
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (id === "react") return { useState: (initial: any) => { const index = si++; if (!(index in states)) states[index] = initial; return [states[index], (next: any) => states[index] = next]; },
        useRef: (initial: any) => { const index = ri++; return refs[index] ??= { current: initial }; },
        useEffect: (fn: () => () => void, deps: any[]) => { if (!effect || deps.some((v, i) => effect!.deps[i] !== v)) { effect?.cleanup?.(); effect = { deps, cleanup: fn() }; } } };
      if (id.endsWith("booking-invoice-usecases")) return { downloadBookingInvoiceDraft: (id: string, signal: AbortSignal) => new Promise((resolve, reject) => pending.push({ id, signal, resolve, reject })) };
      if (id.endsWith("booking-detail-section")) return { BookingDetailSection: "Section" };
      if (id.endsWith("/ui/button")) return { Button: "Button" };
      return { Download: "Download", ReceiptText: "ReceiptText" };
    }
  });
  const render = (id = "a", canRead = true) => {
    si = 0; ri = 0;
    const tree = exports.BookingInvoiceSection({ bookingId: id, bookingCode: id === "a" ? "A/01" : "B/02", canRead });
    const find = (node: any): any => { if (!node || typeof node !== "object") return; if (node.type === "Button") return node; return [node.props?.children].flat().map(find).find(Boolean); };
    return { tree, button: find(tree) };
  };
  return { render, pending, states, clicks, revoked, timers, unmount: () => effect?.cleanup?.() };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const syntheticPdf = () => new Blob(["%PDF-1.7 synthetic"], { type: "application/pdf" });
test("double clicking creates one download, keeps a busy status and releases the temporary URL", async () => {
  const c = component(), first = c.render(); first.button.props.onClick(); first.button.props.onClick();
  assert.equal(c.pending.length, 1); const busy = c.render().button; assert.equal(busy.props.disabled, true); assert.equal(busy.props["aria-busy"], true);
  c.pending[0].resolve(syntheticPdf()); await flush(); assert.deepEqual(c.clicks, ["Bozza_fattura_A_01.pdf"]); assert.equal(c.states[0], false);
  c.timers[0](); assert.deepEqual(c.revoked, ["blob:synthetic"]);
});
test("switching bookings cancels the old request and cannot download or overwrite the new one", async () => {
  const c = component(); c.render().button.props.onClick(); c.render("b").button.props.onClick();
  assert.equal(c.pending[0].signal.aborted, true); c.pending[0].resolve(syntheticPdf()); await flush();
  assert.equal(c.states[0], true); assert.equal(c.clicks.length, 0);
  c.pending[1].resolve(syntheticPdf()); await flush(); assert.deepEqual(c.clicks, ["Bozza_fattura_B_02.pdf"]);
});
test("closing the detail cancels the pending PDF without an unexpected download", async () => {
  const c = component(); c.render().button.props.onClick(); c.unmount(); assert.equal(c.pending[0].signal.aborted, true);
  c.pending[0].resolve(syntheticPdf()); await flush(); assert.equal(c.clicks.length, 0);
});
test("a failed preparation exposes an error and can be retried without a false success", async () => {
  const c = component(); c.render().button.props.onClick(); c.pending[0].reject(new Error("Pricing incompleto")); await flush();
  assert.equal(c.states[1], "Pricing incompleto"); assert.equal(c.states[2], null); c.render().button.props.onClick(); assert.equal(c.pending.length, 2);
});
test("invoice access is not offered without the matching read permission", () => { const c = component(); assert.equal(c.render("a", false).tree, null); assert.equal(c.pending.length, 0); });
test("new invoice controls and states have English translations", () => {
  for (const text of ["Fattura di noleggio", "Bozza PDF dai dati della prenotazione.", "Preparazione bozza PDF…", "Scarica bozza PDF", "Bozza PDF pronta per il download.", "Bozza fattura non disponibile. Riprova."]) assert.notEqual(translateText(text, "en"), text);
});
