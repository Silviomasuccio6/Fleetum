import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { themeCircle } from "../src/infrastructure/theme/workspace-theme-transition";

const deferred = () => {
  let resolve!: (value?: unknown) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function harness(options: { reduced?: boolean; supported?: boolean; workspace?: boolean } = {}) {
  const attrs = new Map<string, string>();
  if (options.workspace !== false) attrs.set("data-fleetum-workspace", "");
  const listeners = new Map<string, Set<() => void>>();
  const target = (prefix: string) => ({
    addEventListener(name: string, fn: () => void) { const key = prefix + name; if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key)!.add(fn); },
    removeEventListener(name: string, fn: () => void) { listeners.get(prefix + name)?.delete(fn); }
  });
  const calls: string[] = [], animations: any[] = [], transitions: any[] = [];
  const reduced = { matches: Boolean(options.reduced), ...target("media:") };
  const root = {
    hasAttribute: (key: string) => attrs.has(key), setAttribute: (key: string, value: string) => attrs.set(key, value), removeAttribute: (key: string) => attrs.delete(key),
    animate(frames: unknown, config: any) {
      const ended = deferred(); const animation = { frames, config, finished: ended.promise, end: () => ended.resolve(), cancel: () => { calls.push("cancel-animation"); ended.reject(Error("cancelled")); } };
      animations.push(animation); return animation;
    }
  };
  const doc: any = { documentElement: root, hidden: false, ...target("document:") };
  if (options.supported !== false) doc.startViewTransition = (update: () => void) => {
    const ready = deferred(), finished = deferred(), updated = deferred();
    const transition = { ready: ready.promise, finished: finished.promise, updateCallbackDone: updated.promise,
      skipTransition: () => { calls.push("skip"); ready.reject(Error("skipped")); finished.resolve(); },
      update() { update(); updated.resolve(); }, readyNow: () => ready.resolve(), failReady: () => ready.reject(Error("unavailable")) };
    transitions.push(transition); return transition;
  };
  const exports: any = {};
  const source = readFileSync(new URL("../src/infrastructure/theme/workspace-theme-transition.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, document: doc, window: { innerWidth: 1000, innerHeight: 700, matchMedia: () => reduced, ...target("window:") }
  });
  const driver = exports.createWorkspaceThemeTransition();
  const trigger = { getBoundingClientRect: () => ({ left: 850, top: 20, width: 40, height: 40 }) } as HTMLElement;
  const request = (to: "light" | "dark", pointer = true) => driver.change({ from: to === "dark" ? "light" : "dark", to, pointer, trigger, apply: () => calls.push(to) });
  return { driver, request, attrs, calls, animations, transitions, doc, reduced, emit: (name: string) => listeners.get(name)?.forEach(fn => fn()), listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0) };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("theme circle covers every visible corner and is anchored at the actual button", () => {
  const circle = themeCircle({ left: 850, top: 20, width: 40, height: 40 }, 1000, 700);
  assert.equal(circle.x, 870); assert.equal(circle.y, 40);
  for (const [x, y] of [[0, 0], [1000, 0], [0, 700], [1000, 700]]) assert.ok(circle.radius > Math.hypot(x - circle.x, y - circle.y));
});
test("keyboard, reduced motion, non-workspace and missing API commit once without snapshots", () => {
  for (const [options, pointer] of [[{}, false], [{ reduced: true }, true], [{ supported: false }, true], [{ workspace: false }, true]] as const) {
    const h = harness(options); assert.equal(h.request("dark", pointer), "instant");
    assert.deepEqual(h.calls, ["dark"]); assert.equal(h.transitions.length, 0); assert.equal(h.listenerCount(), 0);
  }
});
test("dark expands the new native snapshot; light contracts the old native snapshot", async () => {
  for (const theme of ["dark", "light"] as const) {
    const h = harness(); h.request(theme); h.transitions[0].update(); h.transitions[0].readyNow(); await flush();
    assert.deepEqual(h.calls, [theme]); assert.equal(h.animations.length, 1);
    assert.equal(h.animations[0].config.pseudoElement, `::view-transition-${theme === "dark" ? "new" : "old"}(root)`);
    assert.equal(h.animations[0].config.duration, 280);
    const frames = h.animations[0].frames.clipPath;
    assert.equal(frames[theme === "dark" ? 0 : 1], "circle(0px at 870px 40px)");
    h.animations[0].end(); await flush();
    assert.equal(h.attrs.has("data-fleetum-theme-transition"), false); assert.equal(h.listenerCount(), 0);
  }
});
test("an interrupted queued callback cannot overwrite the last theme choice", async () => {
  const h = harness(); h.request("dark"); h.request("light");
  h.transitions[0].update(); await flush();
  assert.deepEqual(h.calls.filter(x => x === "light" || x === "dark"), ["light"]);
  assert.equal(h.attrs.has("data-fleetum-theme-transition"), false); assert.equal(h.listenerCount(), 0);
});
test("ready rejection still applies the theme once and removes snapshot styling", async () => {
  const h = harness(); h.request("dark"); h.transitions[0].failReady(); await flush(); h.transitions[0].update(); await flush();
  assert.equal(h.calls.filter(x => x === "dark").length, 1); assert.equal(h.attrs.has("data-fleetum-theme-transition"), false); assert.equal(h.listenerCount(), 0);
});
test("navigation cancellation prevents delayed DOM updates after unmount", async () => {
  const h = harness(); h.request("dark"); h.driver.cancel(); h.transitions[0].update(); await flush();
  assert.equal(h.calls.includes("dark"), false); assert.equal(h.listenerCount(), 0); assert.equal(h.attrs.has("data-fleetum-theme-transition"), false);
});
test("resize, printing and hidden tabs settle the pending choice without leaked listeners", async () => {
  for (const event of ["window:resize", "window:beforeprint", "document:visibilitychange", "media:change"]) {
    const h = harness(); h.request("dark"); h.doc.hidden = true; h.reduced.matches = true; h.emit(event); await flush();
    assert.equal(h.calls.filter(x => x === "dark").length, 1); assert.equal(h.listenerCount(), 0); assert.equal(h.attrs.has("data-fleetum-theme-transition"), false);
  }
});
