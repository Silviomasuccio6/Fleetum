import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import ts from "typescript";
import { translateText, reverseTranslateText } from "../src/presentation/i18n/fleetum-language";
import { DashboardOverview, dashboardNumber, bookingDestination } from "../src/presentation/components/dashboard/dashboard-overview";

const fixture = { kpis: { availableToday: 0, totalRentalVehicles: 5, occupiedToday: 2, pickupsToday: 1, returnsToday: 1, activeBookings: 3, overdueReturns: 0 }, lists: { nextPickups: [{ id: "booking/a?b", code: "QA-1", customer: "Cliente sintetico", vehicle: "QA123AA", pickupAt: "2026-10-21T10:00:00Z" }], nextReturns: [], criticalBookings: [] }, charts: { trend: [{ day: "2026-10-21", created: 7, pickups: 3, returns: 2 }], utilization: [], topVehicles: [], contractStatusDistribution: [] } };
const page = (booking: unknown, canOpenBookings = true, onNavigate = (_: string) => {}) => DashboardOverview({ booking, canOpenBookings, canOpenCustomers: canOpenBookings, onNavigate });
const descendants = (node: any): any[] => Array.isArray(node) ? node.flatMap(descendants) : node?.props ? [node, ...descendants(node.props.children)] : [];

test("dashboard distinguishes zero, unavailable data and malformed amounts", () => {
  assert.equal(dashboardNumber(0), "0");
  for (const value of [null, undefined, "", " ", "oops", Infinity]) assert.equal(dashboardNumber(value), "—");
  assert.equal(dashboardNumber("1234.50", true), new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(1234.5));
});
test("dashboard preserves the selected booking in a safely encoded destination", () => {
  assert.equal(bookingDestination("booking/a?b"), "/rental-bookings/booking%2Fa%3Fb");
  assert.equal(bookingDestination(), "/booking");
  const calls: string[] = [];
  const row = descendants(page(fixture, true, to => calls.push(to))).find(n => typeof n.type === "function" && n.type.name === "BookingRow");
  assert.ok(row);
  const button = descendants(row.type(row.props)).find(n => n.type === "button");
  button.props.onClick();
  assert.deepEqual(calls, ["/rental-bookings/booking%2Fa%3Fb"]);
});
test("dashboard renders actual source values and a text alternative to the chart", () => {
  const html = renderToStaticMarkup(page(fixture));
  assert.ok(html.includes("Cliente sintetico"));
  assert.ok(html.includes("QA123AA"));
  assert.ok(html.includes("Visualizza dati del grafico"));
  assert.ok(html.includes("21/10"));
  assert.ok(html.includes("<td>7</td>"));
  assert.ok(!html.includes("24.680"));
});
test("missing dashboard sections stay unavailable instead of reporting an empty business", () => {
  const html = renderToStaticMarkup(page(undefined));
  assert.ok(html.includes("indicatori di noleggio non sono disponibili"));
  assert.ok(html.includes("Dati della sezione non disponibili."));
  assert.ok(!html.includes("Nessuna criticità segnalata."));
  assert.ok(!html.includes("0,00"));
});
test("booking navigation and shortcuts are disabled without the relevant read permission", () => {
  const html = renderToStaticMarkup(page(fixture, false));
  assert.ok(html.includes('disabled=""'));
  assert.ok(!html.includes("Pianifica un noleggio"));
  assert.ok(!html.includes("Apri contratti"));
});

// Execute the real page's query decisions with transport and hook doubles.
function requests(permissions: string[], features: string[]) {
  const calls: string[] = [];
  const query = (name: string) => (..._args: unknown[]) => { calls.push(name); return Promise.resolve({}); };
  const api = { dashboard: query("dashboard"), analytics: query("analytics") };
  const stops = Object.fromEntries(["assignmentSuggestions", "costsSummary", "slaEscalations", "preventiveDue", "costsVariance"].map(name => [name, query(name)]));
  let index = 0;
  const exports: any = {};
  const source = readFileSync(new URL("../src/presentation/pages/dashboard/dashboard-page.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(compiled, { exports, Date, Promise, require(id: string) {
    if (id === "react") return { ...React, useMemo: (fn:()=>unknown) => fn(), useState: (value:unknown) => [value, ()=>{}] };
    if (id === "react/jsx-runtime") return { jsx: (type:any, props:any) => ({type,props}), jsxs: (type:any,props:any) => ({type,props}), Fragment:"Fragment" };
    if (id === "react-router-dom") return {useNavigate:()=>()=>{}};
    if (id.endsWith("auth-store")) return {useAuthStore:(selector:any)=>selector({user:{permissions}})};
    if (id.endsWith("use-entitlements")) return {useEntitlements:()=>({can:(key:string)=>features.includes(key),loaded:true})};
    if (id.endsWith("use-async")) return {useAsync:(fn:any)=>{void fn();return {data:index++===0?{kpis:{},charts:{byStatus:[]},feeds:{alerts:[],recentUsers:[],recentReminders:[],recentStoppages:[]}}:null,error:null,loading:false}}};
    if (id.endsWith("stats-usecases")) return {statsUseCases:api};
    if (id.endsWith("stoppages-usecases")) return {stoppagesUseCases:stops};
    if (id.endsWith("stoppage-status")) return {stoppageStatusLabel:{}};
    return new Proxy({}, {get:(_,key)=>String(key)});
  }});
  exports.DashboardPage();
  return calls;
}
test("basic statistics readers do not request advanced analytics or stoppage data", () => {
  assert.deepEqual(requests(["stats:read", "vehicles:read"], ["reports_basic"]), ["dashboard"]);
});
test("missing statistics permission prevents dashboard and supplemental requests", () => {
  assert.deepEqual(requests(["vehicles:read"], ["reports_basic", "reports_advanced"]), []);
});
test("missing plan feature prevents statistics requests even with role permission", () => {
  assert.deepEqual(requests(["*"], []), []);
});
test("advanced admin keeps all seven existing dashboard queries", () => {
  const calls = requests(["*"], ["reports_basic", "reports_advanced"]);
  assert.equal(calls.length, 7);
  assert.ok(calls.includes("analytics"));
  assert.ok(calls.includes("preventiveDue"));
});

test("dashboard dynamic labels and fleet title round-trip in English", () => {
  for (const [it, en] of [["Occupazione della flotta", "Fleet occupancy"], ["Rapporto di oggi:", "Today's ratio:"], ["Rientri scaduti: 1", "Overdue returns: 1"], ["Su 12 veicoli · stima sulle prenotazioni", "Out of 12 vehicles · booking-based estimate"], ["8 prenotazioni nella giornata", "8 bookings in the day"], ["Apri prenotazione QA-1, Cliente sintetico", "Open booking QA-1, Cliente sintetico"]]) {
    assert.equal(translateText(it, "en"), en);
    assert.equal(reverseTranslateText(en), it);
  }
});
