import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { isWorkspacePath } from "../src/infrastructure/theme/workspace-appearance";

function themeHarness(stored: string | null, systemDark: boolean, blocked = false) {
  const classes = new Set<string>();
  const reads: string[] = [];
  const writes: [string, string][] = [];
  const storage = {
    getItem(key: string) { reads.push(key); if (blocked) throw Error("Storage denied"); return stored; },
    setItem(key: string, value: string) { if (blocked) throw Error("Storage denied"); writes.push([key, value]); }
  };
  const root = { classList: { toggle(name: string, value: boolean) { value ? classes.add(name) : classes.delete(name); } } };
  const exports: any = {};
  const source = readFileSync(new URL("../src/infrastructure/theme/theme-manager.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, localStorage: storage, window: { localStorage: storage, matchMedia: () => ({ matches: systemDark }) },
    document: { documentElement: root }
  });
  return { api: exports, classes, reads, writes };
}

test("an explicit light preference overrides the dark system preference", () => {
  const h = themeHarness("light", true);
  assert.equal(h.api.initTheme(), "light");
  assert.equal(h.classes.has("dark"), false);
  assert.deepEqual(h.reads, ["fermi_theme_mode"]);
});
test("an explicit dark preference survives repeated initialization", () => {
  const h = themeHarness("dark", false);
  assert.equal(h.api.initTheme(), "dark");
  assert.equal(h.api.initTheme(), "dark");
  assert.equal(h.classes.has("dark"), true);
});
test("missing or invalid theme preferences follow the system", () => {
  for (const stored of [null, "invalid"]) {
    assert.equal(themeHarness(stored, true).api.initTheme(), "dark");
    assert.equal(themeHarness(stored, false).api.initTheme(), "light");
  }
});
test("unavailable preference storage does not abort theme initialization", () => {
  const h = themeHarness(null, true, true);
  assert.equal(h.api.initTheme(), "dark");
  assert.equal(h.classes.has("dark"), true);
});
test("a rejected preference write still applies the selected theme", () => {
  const h = themeHarness(null, false, true);
  assert.doesNotThrow(() => h.api.setTheme("dark"));
  assert.equal(h.classes.has("dark"), true);
});
test("theme changes persist only the theme preference and can return to light", () => {
  const h = themeHarness(null, false);
  h.api.setTheme("dark"); h.api.setTheme("light");
  assert.equal(h.classes.has("dark"), false);
  assert.deepEqual(h.writes, [["fermi_theme_mode", "dark"], ["fermi_theme_mode", "light"]]);
});

const workspacePaths = ["/dashboard", "/booking", "/rental-bookings/demo-booking-1", "/booking/contratti", "/booking/listini", "/fermi", "/fermi/kanban", "/fermi/calendario", "/fermi/nuovo", "/fermi/demo-stoppage-1", "/fermi/demo-stoppage-1/modifica", "/anagrafiche/sedi", "/anagrafiche/officine", "/anagrafiche/veicoli", "/anagrafiche/clienti", "/anagrafiche/manutenzioni", "/anagrafiche/scadenziario", "/utenti", "/profilo", "/profilo/azienda", "/statistiche"];
const otherPaths = ["/", "/login", "/signup", "/forgot-password", "/reset-password", "/accept-invite", "/auth/social-callback", "/activate", "/upgrade", "/billing/recovery", "/onboarding/azienda", "/privacy", "/platform/login", "/dashboard-other"];
function prepaint(pathname: string, stored: string | null, systemDark: boolean, blocked = false) {
  const classes = new Set<string>(); const attributes = new Map<string, string>(); const reads: string[] = [];
  const root = {
    classList: { toggle(name: string, value: boolean) { value ? classes.add(name) : classes.delete(name); } },
    setAttribute(name: string, value: string) { attributes.set(name, value); }
  };
  runInNewContext(readFileSync(new URL("../public/workspace-appearance.js", import.meta.url), "utf8"), {
    document: { documentElement: root }, window: { location: { pathname },
      localStorage: { getItem(key: string) { reads.push(key); if (blocked) throw Error("Storage denied"); return stored; } },
      matchMedia: () => ({ matches: systemDark }) }
  });
  return { classes, attributes, reads };
}
test("prepaint and runtime resolve the same theme for all preference and fallback cases", () => {
  for (const stored of [null, "invalid", "light", "dark"]) for (const systemDark of [true, false]) for (const blocked of [true, false]) {
    const before = prepaint("/dashboard", stored, systemDark, blocked);
    const runtime = themeHarness(stored, systemDark, blocked); runtime.api.initTheme();
    assert.equal(before.classes.has("dark"), runtime.classes.has("dark"));
    assert.deepEqual(before.reads, ["fermi_theme_mode"]);
  }
});
test("prepaint covers operational routes and leaves public, login and standalone access routes untouched", () => {
  for (const pathname of workspacePaths) {
    assert.equal(isWorkspacePath(pathname), true, pathname);
    assert.equal(prepaint(pathname, "dark", false).attributes.has("data-fleetum-workspace"), true, pathname);
  }
  for (const pathname of otherPaths) {
    assert.equal(isWorkspacePath(pathname), false, pathname);
    const result = prepaint(pathname, "dark", true);
    assert.equal(result.classes.size, 0, pathname);
    assert.equal(result.attributes.size, 0, pathname);
    assert.equal(result.reads.length, 0, pathname);
  }
});
test("SPA route changes clear workspace startup styling when leaving for login or public pages", () => {
  const attributes = new Set<string>(); const exports: any = {};
  const source = readFileSync(new URL("../src/infrastructure/theme/workspace-appearance.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, document: { documentElement: { toggleAttribute(name: string, value: boolean) { value ? attributes.add(name) : attributes.delete(name); } } }
  });
  for (const pathname of ["/dashboard", "/login", "/booking", "/", "/anagrafiche/clienti", "/upgrade"]) {
    exports.syncWorkspaceAppearance(pathname);
    assert.equal(attributes.has("data-fleetum-workspace"), isWorkspacePath(pathname), pathname);
  }
});
test("the workspace prepaint script runs before styles and application modules", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const script = html.match(/<script\b[^>]*src="\/workspace-appearance\.js"[^>]*>/)?.[0];
  assert.ok(script, "workspace prepaint entry must exist");
  assert.doesNotMatch(script, /\b(?:async|defer|type\s*=)/);
  const scriptIndex = html.indexOf(script);
  assert.ok(scriptIndex < html.indexOf('href="/workspace-startup.css"'));
  assert.ok(scriptIndex < html.indexOf('type="module"'));
});
