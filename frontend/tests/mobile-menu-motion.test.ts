import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function harness({ reduced = false, pointer = true, supported = true } = {}) {
  const listeners = new Map<string, Set<() => void>>(), timers = new Map<number, () => void>();
  const events = (prefix: string) => ({
    addEventListener(name: string, fn: () => void) { const k = prefix + name; if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k)!.add(fn); },
    removeEventListener(name: string, fn: () => void) { listeners.get(prefix + name)?.delete(fn); }
  });
  const media = { matches: reduced, ...events("media:") }, doc = { hidden: false, ...events("document:") };
  const animations: any[] = [];
  const panel = { animate: supported ? (frames: unknown, options: any) => {
    let resolve!: () => void, reject!: (reason: unknown) => void;
    const finished = new Promise<void>((a, b) => { resolve = a; reject = b; });
    const a = { frames, options, finished, cancelled: false, finish: resolve, cancel() { this.cancelled = true; reject(new Error("cancelled")); } }; animations.push(a); return a;
  } : undefined };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../src/presentation/components/layout/mobile-menu-motion.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Array, document: doc, window: { ...events("window:"), matchMedia: () => media,
      setTimeout(fn: () => void) { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout(id: number) { timers.delete(id); } },
    getComputedStyle: () => ({ opacity: ".55", transform: "matrix(1,0,0,1,0,7)" })
  });
  const api = exports.createMobileMenuMotion(panel, pointer);
  return { api, animations, timers, media, doc, emit: (event: string) => listeners.get(event)?.forEach(fn => fn()), listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0) };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
test("keyboard, reduced motion and unsupported browsers present the menu immediately", () => {
  for (const options of [{ pointer: false }, { reduced: true }, { supported: false }]) {
    const h = harness(options); assert.equal(h.animations.length, 0);
    let calls = 0; h.api.dismiss(() => calls++, false); assert.equal(calls, 1);
    h.api.destroy(); assert.equal(h.listenerCount(), 0); assert.equal(h.timers.size, 0);
  }
});
test("closing during entrance starts from the visible pose and completes exactly once", async () => {
  const h = harness(); assert.equal(h.animations[0].options.duration, 220);
  let calls = 0; h.api.dismiss(() => calls++, true);
  assert.equal(h.animations[0].cancelled, true);
  assert.equal(h.animations[1].frames[0].transform, "matrix(1,0,0,1,0,7)");
  assert.equal(h.animations[1].options.duration, 160);
  h.api.dismiss(() => calls++, true); assert.equal(h.animations.length, 2);
  h.animations[1].finish(); await flush(); assert.equal(calls, 1);
  h.api.destroy(); assert.equal(h.timers.size, 0); assert.equal(h.listenerCount(), 0);
});
test("Escape settles an in-flight exit and stale callbacks cannot close after destruction", async () => {
  const h = harness(); let calls = 0;
  h.api.dismiss(() => calls++, true); h.api.dismiss(() => calls++, false);
  await flush(); assert.equal(calls, 1);
  const other = harness(); other.api.dismiss(() => calls++, true); other.api.destroy();
  other.animations.forEach(a => a.finish()); await flush(); assert.equal(calls, 1);
  assert.equal(other.listenerCount(), 0); assert.equal(other.timers.size, 0);
});
test("resize, hidden page and reduced motion settle pending exits without leaked state", async () => {
  for (const event of ["window:resize", "document:visibilitychange", "media:change"]) {
    const h = harness(); let calls = 0; h.api.dismiss(() => calls++, true);
    h.doc.hidden = true; h.media.matches = true; h.emit(event); await flush();
    assert.equal(calls, 1); assert.equal(h.timers.size, 0);
    h.api.destroy(); assert.equal(h.listenerCount(), 0);
  }
});
test("background isolation preserves existing inert state and never isolates the dialog itself", () => {
  class Element { inert = false; children: Element[] = []; parentElement: Element | null = null; add(...children: Element[]) { this.children.push(...children); children.forEach(c => c.parentElement = this); return this; } }
  const html = new Element(), body = new Element(), app = new Element(), menu = new Element(), main = new Element(), topbar = new Element(), preview = new Element();
  topbar.inert = true; html.add(body); body.add(preview, app); app.add(topbar, menu, main);
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../src/presentation/components/layout/mobile-menu-motion.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, HTMLElement: Element, document: { documentElement: html }, Array });
  const restore = exports.isolateMobileMenu(menu);
  assert.equal(main.inert, true); assert.equal(preview.inert, true); assert.equal(menu.inert, false); assert.equal(app.inert, false);
  restore(); assert.equal(main.inert, false); assert.equal(preview.inert, false); assert.equal(topbar.inert, true);
});
