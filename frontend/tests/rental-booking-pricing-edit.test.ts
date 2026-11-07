import * as operationFeedback from "../src/application/stores/operation-feedback";
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

const createPage = (overrides: Record<string, (...args: any[]) => any> = {}, permissions = ["vehicles:read", "vehicles:write"]) => {
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
    if(id.endsWith("operation-feedback"))return operationFeedback;
    if (id === "react") return React;
    if (id === "react/jsx-runtime") return jsxRuntime;
    if (id === "react-router-dom") return {
      useNavigate: () => () => {}, useParams: () => ({}), useSearchParams: () => [params, (next: URLSearchParams) => { params = next; dirty = true; }]
    };
    if (id.endsWith("auth-store")) return { useAuthStore: (selector: any) => selector({ user: { permissions } }) };
    if (id.endsWith("rental-bookings-usecases")) return { rentalBookingsUseCases: api };
    if (id.endsWith("master-data-usecases")) return { masterDataUseCases: api };
    if (id.endsWith("fleetum-language")) return { useFleetumLanguage: () => ({ language: "it" }) };
    if (id.endsWith("use-panel-motion")) return { usePanelMotion: () => undefined };
    if (id.endsWith("use-dialog-focus")) return { useDialogFocus: () => undefined };
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
    window: { matchMedia: () => ({ matches: false }), setTimeout(callback: () => any) { const id = ++timerId; timers.set(id, callback); return id; },
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
    customerNotices: () => {const dialog=elements().find(node=>node.props['aria-label']==='Anagrafica cliente');const local=descendants(dialog);return elements().filter(node=>node.type==='CommerceNotice').map(node=>({text:textOf(node),insideCustomer:local.includes(node)}));},
    popup: () => elements().find(node => node.type === "ContractCargosDialog"), text: () => textOf(tree),
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
    async newCustomer() { button("Nuovo cliente").props.onClick(); await settle(); },
    async submitCustomer() { const form = elements().find(node => node.type === "form" && node.props.onSubmit?.name === "onCustomerSubmit"); assert.ok(form); await form.props.onSubmit({preventDefault(){}}); await settle(true); },
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
  await page.change("Note economiche", "Synthetic operational adjustment");
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
  await page.change("Note economiche", "");
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
  assert.equal(page.field("Note economiche").props.value, "Agreed terms");
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
  await page.change("Note economiche", "Synthetic legacy note");
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


test("an empty pickup is identified at its field before conversion or any booking mutation", async () => {
  const page = createPage();
  await page.edit();
  await page.change("Data/ora uscita", "");
  await page.submit();
  assert.equal(page.calls.some((call) => ["create", "update", "updateBookingPricing"].includes(call.method)), false);
  assert.equal(page.field("Data/ora uscita").props["aria-invalid"], true);
  assert.equal(page.field("Data/ora uscita").props["aria-describedby"], "booking-field-19-error");
  assert.equal(page.field("Totale previsto (EUR)").props.value, "123");
});

test("typing an unselected customer is rejected at the customer field without creating a booking", async () => {
  const page = createPage();
  await page.create();
  await page.change("Cliente", "Unknown synthetic customer");
  await page.submit();
  assert.equal(page.calls.some((call) => call.method === "create"), false);
  assert.equal(page.field("Cliente").props["aria-invalid"], true);
});

test("a failed booking save keeps entered values and a subsequent retry can use the same form", async () => {
  let attempts = 0;
  const page = createPage({ update: () => { if (++attempts === 1) throw new Error("Synthetic write rejected"); return {}; } });
  await page.edit();
  await page.change("Luogo rientro", "Synthetic retry depot");
  await page.submit();
  assert.equal(page.field("Luogo rientro").props.value, "Synthetic retry depot");
  assert.equal(page.field("Totale previsto (EUR)").props.value, "123");
  await page.submit();
  assert.equal(attempts, 2);
  assert.equal(page.calls.some((call) => call.method === "updateBookingPricing"), false);
});


test("a return before pickup is rejected without changing the persisted booking", async () => {
  const page = createPage();
  await page.edit();
  await page.change("Data/ora rientro", "2026-10-07T08:00");
  await page.submit();
  assert.equal(page.calls.some((call) => ["update", "updateBookingPricing"].includes(call.method)), false);
  assert.equal(page.field("Data/ora rientro").props["aria-invalid"], true);
});

test("a read-only booking user can consult the contract but cannot use mutation actions", async () => {
  const page = createPage({ getContract: () => ({ id: "contract-a", bookingId: "booking-a", status: "DRAFT", title: "Synthetic contract", content: "Synthetic content" }) }, ["vehicles:read"]);
  await page.settle();
  for (const action of ["Modifica prenotazione", "Elimina", "Salva stato workflow", "Template default", "Rigenera", "Trasmetti contratto a CARGOS", "Salva"]) {
    assert.equal(page.button(action)?.props.disabled, true, action);
  }
  assert.equal(page.button("Scarica PDF")?.props.disabled, false);
  assert.equal(page.button("Stampa")?.props.disabled, false);
});

test("contract server failures mentioning 404 remain retryable errors rather than an empty contract", async () => {
  const page = createPage({ getContract: () => { throw Object.assign(new Error("Dependency returned 404; contract service failed"), { status: 500 }); } });
  await page.settle();
  assert.ok(page.text().includes("Dependency returned 404; contract service failed"));
  assert.ok(page.button("Riprova caricamento contratto"));
  assert.equal(page.text().includes("Contratto non ancora generato per questa prenotazione."), false);
});


test("a newly created contract opens its CARGOS popup without sending automatically", async () => {
  const page=createPage({create:()=>({id:"created-booking",contractStatus:"READY",contractCreated:true})});
  await page.create();await page.submit();
  assert.equal(page.popup()?.props.bookingId,"created-booking");
  assert.equal(page.calls.some(call=>call.method==="setCargosStatus"||call.method==="transmit"),false);
});
test("a booking without a generated contract and an idempotency replay do not open a new CARGOS popup", async () => {
  for(const result of [{id:"created-booking",contractStatus:"NOT_READY",contractCreated:false},{id:"existing-booking",contractStatus:"READY",contractCreated:false}]){
    const page=createPage({create:()=>result});await page.create();await page.submit();assert.equal(page.popup(),undefined);
  }
});
test("a failed contract creation does not show a CARGOS success popup",async()=>{
  const page=createPage({create:()=>{throw Error("Synthetic creation failure")}});await page.create();await page.submit();assert.equal(page.popup(),undefined);
});


test("inline customer creation survives the background selected-booking refresh", async () => {
  const page = createPage({ createCustomer: () => ({id:"new-inline-customer"}) });
  await page.create();
  await page.newCustomer();
  await page.change("Nome", "Inline");
  await page.change("Cognome", "Customer");
  await page.change("Patente numero *", "WF-INLINE-CUSTOMER");
  await page.submitCustomer();
  assert.equal(page.field("Cliente").props.value, "Inline Customer");
});


test("customer save failures stay visible inside the foremost customer dialog without a duplicate behind it",async()=>{
 const page=createPage({createCustomer:()=>{throw Error("Errore sintetico anagrafica")}});await page.create();await page.newCustomer();await page.change("Nome","Synthetic");await page.change("Cognome","Failure");await page.change("Patente numero *","QA-FAILURE");await page.submitCustomer();
 const notices=page.customerNotices().filter(notice=>notice.text.includes("Errore sintetico anagrafica"));assert.equal(notices.length,1);assert.equal(notices[0].insideCustomer,true);
});
