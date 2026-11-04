import assert from "node:assert/strict";
import test from "node:test";
import { mobileMenuSections } from "../src/presentation/components/layout/mobile-menu-model";
import { allowedSearchSections } from "../src/presentation/components/layout/section-search-model";
import { translateText } from "../src/presentation/i18n/fleetum-language";

const sections = [
  { title: "Operatività", items: [{ label: "Prenotazioni", to: "/booking" }, { label: "Contratti", to: "/booking/contratti" }] },
  { title: "Flotta", items: [{ label: "Fermi Tecnici", children: [{ label: "Fermi", to: "/fermi" }, { label: "Kanban Fermi", to: "/fermi/kanban" }] }] },
  { title: "Gestione", items: [{ label: "Statistiche", to: "/statistiche" }, { label: "Piano e fatturazione", to: "/upgrade" }] }
];
const catalogue = sections.flatMap(s => s.items.flatMap(i => i.children ?? [i]).map(i => ({ label: i.label, to: i.to!, group: s.title })));
test("mobile menu intersects existing routes with permissions and never adds catalogue-only destinations", () => {
  const permitted = allowedSearchSections([...catalogue, { label: "Profilo", to: "/profilo", group: "Account" }], ["vehicles:read"], false, false);
  const groups = mobileMenuSections(sections, permitted, "");
  assert.deepEqual(groups.map(s => s.title), ["Operatività"]);
  assert.deepEqual(groups.flatMap(s => s.items.map(i => i.to)), ["/booking", "/booking/contratti"]);
});
test("an authorization or site change removes formerly visible billing and operational destinations immediately", () => {
  assert.ok(mobileMenuSections(sections, allowedSearchSections(catalogue, ["*"], true, true), "").some(s => s.items.some(i => i.to === "/upgrade")));
  const limited = mobileMenuSections(sections, allowedSearchSections(catalogue, ["stoppages:read"], false, false), "");
  assert.deepEqual(limited.flatMap(s => s.items.map(i => i.to)), ["/fermi", "/fermi/kanban"]);
  assert.deepEqual(mobileMenuSections(sections, [], ""), []);
});
test("mobile lookup matches translated labels and groups without creating new destinations", () => {
  const en = (value: string) => translateText(value, "en");
  assert.deepEqual(mobileMenuSections(sections, catalogue, "  BOOKINGS ", en).flatMap(s => s.items.map(i => i.to)), ["/booking"]);
  assert.deepEqual(mobileMenuSections(sections, catalogue, "operativita contratti").flatMap(s => s.items.map(i => i.to)), ["/booking/contratti"]);
  assert.deepEqual(mobileMenuSections(sections, catalogue, "not-a-section"), []);
});
test("menu grouping preserves source order, flattens actual children and de-duplicates routes", () => {
  const result = mobileMenuSections([...sections, { title: "Duplicate", items: [{ label: "Alias", to: "/booking" }] }], catalogue, "");
  assert.deepEqual(result.map(s => s.title), ["Operatività", "Flotta", "Gestione"]);
  assert.equal(result.flatMap(s => s.items).length, catalogue.length);
  assert.deepEqual(result[1].items.map(i => i.to), ["/fermi", "/fermi/kanban"]);
});
