import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Executes the real page and its event handlers with a deterministic hook scheduler.
// API calls and browser primitives are mocked; this is not a browser/DOM or database test.
type Element = { type: string; props: Record<string, any> };
type Call = { method: string; args: any[] };
const children = (node: any): any[] => node?.props?.children == null ? [] : [node.props.children].flat(Infinity);
const descendants = (node: any): Element[] => Array.isArray(node)
  ? node.flatMap(descendants)
  : node && typeof node === "object" && "props" in node
    ? [node, ...children(node).flatMap(descendants)] : [];
const textOf = (node: any): string => typeof node === "string" || typeof node === "number"
  ? String(node) : Array.isArray(node) ? node.map(textOf).join("") : children(node).map(textOf).join("");

const booking = (id = "booking-a", expectedTotal = 123) => ({
  id, code: id, status: "DRAFT", contractStatus: "NOT_READY", cargosStatus: "NOT_REQUIRED",
  customerName: "Synthetic Customer", customer: { id: "customer-a", firstName: "Synthetic", lastName: "Customer" },
  pickupAt: "2026-10-08T09:00:00.000Z", returnAt: "2026-10-09T09:00:00.000Z", pickupKm: 1000,
  expectedTotal, internalNotes: "Original note", vehicle: { id: "vehicle-a", plate: "SYNTHETIC", brand: "Test", model: "Car" }
});
const snapshot = (bookingId = "booking-a") => ({ bookingId, snapshot: {
  id: `snapshot-${bookingId}`, priceListId: `list-${bookingId}`, pricePackageId: `package-${bookingId}`,
  extraKmPolicyId: `policy-${bookingId}`, estimatedKm: 100, actualKm: null, expectedTotal: 100, notes: "Agreed terms"
} });
const quote = { pricingRef: { priceListName: "Current list", pricePackageName: "Current package", extraKmPolicyName: "Current policy" },
  duration: { daysCharged: 1, chargedUnits: 1, unit: "DAY" }, km: { includedKmTotal: 100, extraKmEstimated: 0 },
  pricing: { expectedTotal: 999, finalTotal: 999, extraKmEstimatedCost: 0 } };

const createPage = (overrides: Record<string, (...args: any[]) => any> = {}) => {
  const calls: Call[] = [];
  const slots: any[] = [];
  let cursor = 0;
  let dirty = true;
  let tree: Element;
  let params = new URLSearchParams({ bookingId: "booking-a" });
  let effects: Array<() => void> = [];
  const timers = new Map<number, () => any>();
  let timerId = 0;
  const unchanged = (a?: any[], b?: any[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const effect = (callback: () => any, dependencies?: any[]) => {
    const index = cursor++;
    const old = slots[index];
    if (old && unchanged(old.dependencies, dependencies)) return;
    slots[index] = { dependencies, cleanup: old?.cleanup };
    effects.push(() => { old?.cleanup?.(); slots[index].cleanup = callback(); });
  };
  const React = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: any) => {
        const value = typeof next === "function" ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; }
      }];
    },
    useRef(initial: any) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(callback: () => any, dependencies: any[]) {
      const index = cursor++;
      if (!slots[index] || !unchanged(slots[index].dependencies, dependencies)) slots[index] = { dependencies, value: callback() };
      return slots[index].value;
    },
    useCallback(callback: () => any, dependencies: any[]) { return React.useMemo(() => callback, dependencies); },
    useEffect: effect,
    useLayoutEffect: effect
  };
  const api = new Proxy({}, { get(_target, method: string) { return (...args: any[]) => {
    calls.push({ method, args });
    if (overrides[method]) return Promise.resolve(overrides[method](...args));
    const defaults: Record<string, any> = {
      getById: booking(args[0]), getContract: null, getBookingPricing: snapshot(args[0]),
      listPriceLists: { data: [{ id: "list-booking-a", name: "Current list", baseRateAmount: 999, baseRateUnit: "DAY" }] },
      listPricePackages: { data: [{ id: "package-booking-a", name: "Current package", isActive: true, isDefault: true, type: "LIMITED", kmIncluded: 100 }] },
      listExtraKmPolicies: { data: [{ id: "policy-booking-a", name: "Current policy", isActive: true, isDefault: true, type: "FLAT", flatRatePerKm: 99 }] },
      previewPricingQuote: { quote }, updateBookingPricing: { quote }, updateBookingPricingSnapshot: { snapshot: {} },
      create: { id: "created-booking" }, update: {}, listVehicles: { data: [booking().vehicle], total: 1 }, listSites: { data: [] },
      suggestCustomers: { data: [booking().customer] }
    };
    return Promise.resolve(defaults[method] ?? { data: [] });
  }; } });
  const jsx = (type: string, props: Record<string, any>) => ({ type, props });
  const jsxRuntime = { jsx, jsxs: jsx, Fragment: "Fragment" };
  const month = { data: [], loading: false, error: null, summary: { totalVehicles: 0, bookedVehicles: 0, availableVehicles: 0, occupancyRate: 0 } };
  const imports = (id: string) => {
    if (id === "react") return React;
    if (id === "react/jsx-runtime") return jsxRuntime;
    if (id === "react-router-dom") return {
      useNavigate: () => () => {}, useParams: () => ({}), useSearchParams: () => [params, (next: URLSearchParams) => { params = next; dirty = true; }]
    };
    if (id.endsWith("rental-bookings-usecases")) return { rentalBookingsUseCases: api };
    if (id.endsWith("master-data-usecases")) return { masterDataUseCases: api };
    if (id.endsWith("use-rental-month-availability")) return { useRentalMonthAvailability: () => month };
    return new Proxy({}, { get: (_target, key) => key === "countryNameFromCode" ? () => "Italy" : String(key) });
  };
  const source = readFileSync(new URL("../src/presentation/pages/bookings/rental-bookings-page.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX
  } }).outputText;
  const exports: any = {};
  runInNewContext(compiled, {
    exports, require: imports, URLSearchParams, URL, crypto: { randomUUID },
    document: { body: { style: {} }, addEventListener() {}, removeEventListener() {} },
    window: { setTimeout(callback: () => any) { const id = ++timerId; timers.set(id, callback); return id; },
      clearTimeout(id: number) { timers.delete(id); }, requestAnimationFrame() {} }
  });
  const settle = async (runTimers = false) => {
    for (let i = 0; i < 30; i += 1) {
      if (dirty) { dirty = false; cursor = 0; tree = exports.RentalBookingsPage(); const pending = effects; effects = []; pending.forEach((run) => run()); }
      await new Promise((resolve) => setImmediate(resolve));
      if (!dirty && runTimers && timers.size) {
        const pending = [...timers.values()]; timers.clear(); pending.forEach((run) => { void run(); });
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (!dirty && (!runTimers || !timers.size)) return;
    }
    throw new Error("Page did not settle");
  };
  const elements = () => descendants(tree);
  const button = (label: string) => elements().find((node) => node.type === "Button" && textOf(node) === label)!;
  const field = (label: string) => {
    const container = elements().find((node) => children(node).some((child) => child?.type === "Label" && textOf(child) === label));
    const input = children(container).find((node) => ["Input", "Select", "Textarea"].includes(node?.type));
    assert.ok(input, `Missing field ${label}`);
    return input as Element;
  };
  return { calls, settle, button, field,
    async edit() { await settle(); assert.ok(button("Modifica prenotazione")); button("Modifica prenotazione").props.onClick(); await settle(true); },
    async change(label: string, value: string) {
      field(label).props.onChange({ target: { value } });
      elements().find((node) => node.type === "form" && node.props.onChangeCapture)?.props.onChangeCapture();
      await settle(true);
    },
    async create() {
      await settle();
      elements().find((node) => node.type === "RentalBookingMonthlyGrid")!.props.onEmptyCellClick({ vehicleId: "vehicle-a", date: new Date("2026-10-08T09:00:00.000Z") });
      await settle(true);
      field("Cliente").props.onChange({ target: { value: "Synthetic Customer" } });
      await settle(true);
      const customerOption = elements().find((node) => node.type === "button" && textOf(node).startsWith("Synthetic Customer"));
      assert.ok(customerOption, JSON.stringify({ calls, buttons: elements().filter((node) => node.type === "button").map(textOf) }));
      customerOption.props.onClick();
      await settle(true);
    },
    async submit() { const form = elements().find((node) => node.type === "form" && node.props.onSubmit)!; await form.props.onSubmit({ preventDefault() {} }); await settle(); },
    async select(id: string) { params = new URLSearchParams({ bookingId: id }); dirty = true; await settle(); },
    async close() {
      const close = elements().find((node) => node.props["aria-hidden"] === "true" && node.props.onClick)!;
      close.props.onClick(); await settle();
      if (button("Esci senza salvare")) { button("Esci senza salvare").props.onClick(); await settle(); }
    }
  };
};

test("opening an edit preserves the booking override and does not query current price rules or preview", async () => {
  const page = createPage();
  await page.edit();
  assert.equal(page.field("Totale previsto (EUR)").props.value, "123");
  assert.equal(page.calls.filter((call) => ["listPricePackages", "listExtraKmPolicies", "previewPricingQuote"].includes(call.method)).length, 0);
});

test("operational edits only PATCH the booking, even when current pricing is unavailable", async () => {
  const page = createPage({ updateBookingPricing: () => { throw new Error("Current list deleted"); } });
  await page.edit();
  await page.change("Luogo rientro", "Synthetic depot");
  await page.change("Km al rientro", "1250");
  await page.submit();
  const update = page.calls.find((call) => call.method === "update")!;
  assert.equal(update.args[1].returnLocation, "Synthetic depot");
  assert.equal(update.args[1].returnKm, 1250);
  assert.equal(Object.hasOwn(update.args[1], "expectedTotal"), false);
  assert.equal(page.calls.some((call) => call.method === "updateBookingPricing"), false);
});

test("a manual expected-total edit remains an explicit booking override without repricing", async () => {
  const page = createPage();
  await page.edit();
  await page.change("Totale previsto (EUR)", "145.50");
  await page.submit();
  assert.equal(page.calls.find((call) => call.method === "update")!.args[1].expectedTotal, 145.5);
  assert.equal(page.calls.some((call) => call.method === "updateBookingPricing"), false);
});

test("a delayed snapshot from a closed edit cannot replace a different booking's fields", async () => {
  let resolveA!: (value: any) => void;
  const pendingA = new Promise((resolve) => { resolveA = resolve; });
  const page = createPage({ getBookingPricing: (id) => id === "booking-a" ? pendingA : snapshot(id) });
  await page.edit();
  await page.close();
  await page.select("booking-b");
  await page.edit();
  resolveA(snapshot("booking-a"));
  await page.settle(true);
  assert.equal(page.field("Listino noleggio").props.value, "list-booking-b");
  assert.equal(page.field("Totale previsto (EUR)").props.value, "123");
});

test("estimated km, actual km and pricing notes use the saved-terms path without selecting live rules", async () => {
  const page = createPage();
  await page.edit();
  await page.change("Km stimati", "350");
  await page.change("Km reali (consuntivo)", "325");
  await page.change("Note pricing", "Synthetic operational adjustment");
  await page.submit();
  const pricing = page.calls.find((call) => call.method === "updateBookingPricing")!;
  assert.equal(JSON.stringify(pricing.args), JSON.stringify(["booking-a", {
    preserveTerms: true, estimatedKm: 350, actualKm: 325, notes: "Synthetic operational adjustment"
  }]));
  assert.equal(page.calls.some((call) => call.method === "previewPricingQuote"), false);
  assert.equal(Object.hasOwn(page.calls.find((call) => call.method === "update")!.args[1], "expectedTotal"), false);
});

test("blank km and pricing notes are cleared explicitly, and untouched snapshot fields stay omitted", async () => {
  const page = createPage({ getBookingPricing: () => ({ ...snapshot(), snapshot: { ...snapshot().snapshot, actualKm: 80 } }) });
  await page.edit();
  await page.change("Km reali (consuntivo)", "");
  await page.change("Note pricing", "");
  await page.submit();
  const payload = page.calls.find((call) => call.method === "updateBookingPricing")!.args[1];
  assert.equal(JSON.stringify(payload), JSON.stringify({ preserveTerms: true, actualKm: null, notes: "" }));
});

test("a snapshot arriving after a field edit fills only untouched fields", async () => {
  let resolve!: (value: any) => void;
  const page = createPage({ getBookingPricing: () => new Promise((done) => { resolve = done; }) });
  await page.edit();
  await page.change("Km stimati", "350");
  resolve(snapshot());
  await page.settle(true);
  assert.equal(page.field("Km stimati").props.value, "350");
  assert.equal(page.field("Note pricing").props.value, "Agreed terms");
  await page.submit();
  assert.equal(JSON.stringify(page.calls.find((call) => call.method === "updateBookingPricing")!.args[1]),
    JSON.stringify({ preserveTerms: true, estimatedKm: 350 }));
});

test("explicitly changing economic terms enables live preview and the existing pricing PATCH", async () => {
  const page = createPage();
  await page.edit();
  page.button("Modifica condizioni economiche").props.onClick();
  await page.settle(true);
  assert.equal(page.field("Totale previsto (EUR)").props.value, "999.00");
  assert.ok(page.calls.some((call) => call.method === "previewPricingQuote"));
  await page.submit();
  const payload = page.calls.find((call) => call.method === "updateBookingPricing")!.args[1];
  assert.equal(payload.priceListId, "list-booking-a");
  assert.equal(payload.pricePackageId, "package-booking-a");
  assert.equal(payload.extraKmPolicyId, "policy-booking-a");
  assert.equal(Object.hasOwn(payload, "preserveTerms"), false);
});

test("create retains live quote, idempotent booking creation and pricing snapshot creation", async () => {
  const page = createPage();
  await page.create();
  assert.equal(page.field("Totale previsto (EUR)").props.value, "999.00");
  await page.submit();
  const created = page.calls.find((call) => call.method === "create")!;
  assert.ok(created);
  assert.equal(created.args[0].expectedTotal, 999);
  assert.match(created.args[1], /^[\da-f-]{36}$/);
  assert.equal(page.calls.find((call) => call.method === "updateBookingPricing")!.args[0], "created-booking");
});

test("a live preview completed after closing edit A cannot change booking B", async () => {
  let resolve!: (value: any) => void;
  const page = createPage({ previewPricingQuote: () => new Promise((done) => { resolve = done; }) });
  await page.edit();
  page.button("Modifica condizioni economiche").props.onClick();
  await page.settle(true);
  assert.ok(resolve);
  await page.close();
  await page.select("booking-b");
  await page.edit();
  resolve({ quote });
  await page.settle(true);
  assert.equal(page.field("Totale previsto (EUR)").props.value, "123");
  assert.equal(page.field("Listino noleggio").props.value, "list-booking-b");
  await page.submit();
  assert.equal(Object.hasOwn(page.calls.find((call) => call.method === "update")!.args[1], "expectedTotal"), false);
});

test("a legacy pricing snapshot without live references can update notes and accept quote:null", async () => {
  const page = createPage({ getBookingPricing: () => ({ bookingId: "booking-a", snapshot: {
    id: "legacy-snapshot", priceListId: null, pricePackageId: null, extraKmPolicyId: null, expectedTotal: 100, notes: "Legacy agreement"
  } }),
    updateBookingPricing: () => ({ quote: null }) });
  await page.edit();
  await page.change("Note pricing", "Synthetic legacy note");
  await page.submit();
  assert.equal(JSON.stringify(page.calls.find((call) => call.method === "updateBookingPricing")!.args[1]),
    JSON.stringify({ preserveTerms: true, notes: "Synthetic legacy note" }));
  assert.equal(page.calls.some((call) => call.method === "previewPricingQuote"), false);
});

test("a booking without a pricing snapshot still supports an operational edit without creating terms", async () => {
  const page = createPage({ getBookingPricing: () => ({ bookingId: "booking-a", snapshot: null }) });
  await page.edit();
  await page.change("Luogo rientro", "Synthetic depot");
  await page.submit();
  assert.ok(page.calls.some((call) => call.method === "update"));
  assert.equal(page.calls.some((call) => call.method === "previewPricingQuote" || call.method === "updateBookingPricing"), false);
});

test("live package rules arriving after closing edit A cannot populate booking B", async () => {
  let resolve!: (value: any) => void;
  const page = createPage({ listPricePackages: () => new Promise((done) => { resolve = done; }) });
  await page.edit();
  page.button("Modifica condizioni economiche").props.onClick();
  await page.settle(true);
  assert.ok(resolve);
  await page.close();
  await page.select("booking-b");
  await page.edit();
  resolve({ data: [{ id: "obsolete-package", name: "Obsolete package", isActive: true, isDefault: true }] });
  await page.settle(true);
  assert.equal(page.field("Pacchetto km").props.value, "package-booking-b");
});

test("a missing snapshot arriving after explicit repricing cannot clear the new live quote", async () => {
  let resolve!: (value: any) => void;
  const page = createPage({ getBookingPricing: () => new Promise((done) => { resolve = done; }) });
  await page.edit();
  await page.change("Listino noleggio", "list-booking-a");
  assert.equal(page.field("Totale previsto (EUR)").props.value, "999.00");
  assert.equal(page.field("Totale previsto (EUR)").props.readOnly, true);
  resolve({ bookingId: "booking-a", snapshot: null });
  await page.settle(true);
  assert.equal(page.field("Totale previsto (EUR)").props.readOnly, true);
  assert.equal(page.field("Totale previsto (EUR)").props.value, "999.00");
});
