import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { translateText } from "../src/presentation/i18n/fleetum-language";

// Execute the real hook with a deterministic React commit/lifecycle driver.
function lifecycle() {
  const refs: any[] = [], effects: any[] = [], pending: Array<() => void> = [];
  const listeners = new Map<string, Set<() => void>>();
  let cursor = 0;
  const emit = (name: string) => listeners.get(name)?.forEach(fn => fn());
  const events = (prefix: string) => ({
    addEventListener(name: string, fn: () => void) { const key = prefix + name; if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key)!.add(fn); },
    removeEventListener(name: string, fn: () => void) { listeners.get(prefix + name)?.delete(fn); }
  });
  const media = { matches: false, ...events("media:") };
  const doc = { hidden: false, ...events("document:") };
  const effect = (fn: () => (() => void) | void, deps: unknown[]) => {
    const index = cursor++, previous = effects[index];
    if (!previous || deps.some((value, i) => value !== previous.deps[i])) pending.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: fn() }; });
  };
  const react = { useRef: (value: unknown) => { const i = cursor++; return refs[i] ??= { current: value }; }, useEffect: effect, useLayoutEffect: effect };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../src/presentation/hooks/use-workspace-chart-transition.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: () => react, window: { matchMedia: () => media }, document: doc, Date });
  const runs: boolean[] = [], cancels: boolean[] = [];
  return {
    render(signature: string | null) { cursor = 0; exports.useWorkspaceChartTransition(signature, (animate: boolean) => { runs.push(animate); return { cancel: (settle: boolean) => cancels.push(settle) }; }); pending.splice(0).forEach(fn => fn()); },
    pointer: () => emit("document:pointerdown"), keyboard: () => emit("document:keydown"),
    hide: () => { doc.hidden = true; emit("document:visibilitychange"); },
    reduce: () => { media.matches = true; emit("media:change"); },
    unmount: () => effects.forEach(effect => effect?.cleanup?.()),
    listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0), runs, cancels
  };
}

test("chart lifecycle animates changed pointer data, not initial paint, identity rerenders or keyboard data", () => {
  const h = lifecycle();
  h.render("first"); h.pointer(); h.render("second"); h.render("second"); h.keyboard(); h.render("third");
  assert.deepEqual(h.runs, [false, true, false]);
  assert.ok(h.cancels.includes(true));
  h.unmount(); assert.equal(h.listenerCount(), 0);
});
test("chart lifecycle settles on reduced motion or hidden pages and releases every listener", () => {
  for (const stop of ["reduce", "hide"] as const) {
    const h = lifecycle(); h.render("a"); h.pointer(); h.render("b");
    h[stop](); assert.equal(h.cancels.at(-1), true);
    h.pointer(); h.render("c"); assert.equal(h.runs.at(-1), false);
    h.unmount(); assert.equal(h.listenerCount(), 0);
  }
});

test("rapid line updates continue from the visible reveal edge; settling clears it", () => {
  const refs: any[] = [], animations: any[] = [];
  let cursor = 0, run: any;
  const path = { animate: (frames: any) => {
    const animation = { frames, playState: "running", effect: { getComputedTiming: () => ({ progress: .4 }) }, finished: Promise.resolve(), cancel() { this.playState = "idle"; } };
    animations.push(animation); return animation;
  } };
  const element = { animate() {}, querySelectorAll: () => [path] };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../src/presentation/components/ui/workspace-chart-frame.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require(id: string) {
    if (id === "react") return { useRef: () => { const i = cursor++; return refs[i] ??= { current: i === 0 ? element : 0 }; } };
    if (id === "react/jsx-runtime") return { jsx: () => ({}) };
    return { useWorkspaceChartTransition: (_: unknown, fn: any) => { run = fn; } };
  } });
  exports.WorkspaceChartFrame({ data: [], label: "Synthetic", children: null });
  const first = run(true); first.cancel(false);
  const second = run(true);
  assert.equal(animations[0].frames.clipPath[0], "inset(-4px 100% -4px -4px)");
  assert.equal(animations[1].frames.clipPath[0], "inset(-4px 60% -4px -4px)");
  second.cancel(true); run(true);
  assert.equal(animations[2].frames.clipPath[0], "inset(-4px 100% -4px -4px)");
});
test("new chart alternatives are translated without losing their counts", () => {
  assert.equal(translateText("8 con prenotazioni, 4 senza prenotazioni, su 12 veicoli.", "en"), "8 with bookings, 4 without bookings, out of 12 vehicles.");
  assert.equal(translateText("Ripartizione della flotta non disponibile: conteggi mancanti o non confrontabili.", "en"), "Fleet composition unavailable: counts are missing or not comparable.");
});
