import assert from "node:assert/strict";
import test from "node:test";
import {
  translateElementAttributes,
  translateTextNode
} from "../src/presentation/components/i18n/global-text-translator";

const textNode = (initial: string, tagName = "SPAN") => {
  let value = initial;
  let translatorWrites = 0;
  const node = {
    parentElement: { tagName },
    get textContent() { return value; },
    set textContent(next: string) { value = next; translatorWrites += 1; }
  } as unknown as Text;
  return {
    node,
    render(next: string) { value = next; },
    value: () => value,
    writes: () => translatorWrites
  };
};

const element = (initial: Record<string, string>) => {
  const attributes = new Map(Object.entries(initial));
  let writes = 0;
  return {
    node: {
      getAttribute: (key: string) => attributes.get(key) ?? null,
      hasAttribute: (key: string) => attributes.has(key),
      setAttribute(key: string, value: string) { attributes.set(key, value); writes += 1; }
    } as unknown as Element,
    render(key: string, value: string) { attributes.set(key, value); },
    remove(key: string) { attributes.delete(key); },
    value: (key: string) => attributes.get(key),
    writes: () => writes
  };
};

for (const language of ["it", "en"] as const) {
  test(`vehicle totals remain current after rendering and observer passes in ${language}`, () => {
    const counter = textNode("0");
    translateTextNode(counter.node, language);
    for (const total of ["22", "2", "0", "21"]) {
      counter.render(total);
      translateTextNode(counter.node, language);
      translateTextNode(counter.node, language);
      assert.equal(counter.value(), total);
    }
  });
}

test("changing language and page does not restore the first page number", () => {
  const page = textNode("1");
  translateTextNode(page.node, "it");
  translateTextNode(page.node, "en");
  page.render("2");
  translateTextNode(page.node, "en");
  translateTextNode(page.node, "it");
  assert.equal(page.value(), "2");
});

test("updated dynamic translated text survives language changes and repeated passes", () => {
  const progress = textNode("10% completato");
  translateTextNode(progress.node, "en");
  assert.equal(progress.value(), "10% completed");
  progress.render("75% completato");
  translateTextNode(progress.node, "en");
  assert.equal(progress.value(), "75% completed");
  const writes = progress.writes();
  translateTextNode(progress.node, "en");
  assert.equal(progress.writes(), writes, "a translator mutation must converge without another write");
  translateTextNode(progress.node, "it");
  assert.equal(progress.value(), "75% completato");
});

test("an updated English render becomes the current source when returning to Italian", () => {
  const label = textNode("Veicoli");
  translateTextNode(label.node, "en");
  assert.equal(label.value(), "Vehicles");
  label.render("Customers");
  translateTextNode(label.node, "en");
  translateTextNode(label.node, "it");
  assert.equal(label.value(), "Clienti");
});

test("spacing follows the current render rather than the initial number", () => {
  const counter = textNode(" 0 ");
  translateTextNode(counter.node, "en");
  counter.render("\n 23 \t");
  translateTextNode(counter.node, "en");
  assert.equal(counter.value(), "\n 23 \t");
});

test("a cleared and reused text node does not regain its old label", () => {
  const label = textNode("Veicoli");
  translateTextNode(label.node, "en");
  label.render("");
  translateTextNode(label.node, "en");
  assert.equal(label.value(), "");
  label.render("Clienti");
  translateTextNode(label.node, "en");
  assert.equal(label.value(), "Customers");
});

test("numeric nodes cause no translator writes or feedback mutations", () => {
  const number = textNode("22");
  for (const language of ["it", "en", "it", "en"] as const) translateTextNode(number.node, language);
  assert.equal(number.value(), "22");
  assert.equal(number.writes(), 0);
});

test("code and editable text are left unchanged", () => {
  for (const tag of ["CODE", "PRE", "SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT"]) {
    const content = textNode("Veicoli", tag);
    translateTextNode(content.node, "en");
    assert.equal(content.value(), "Veicoli");
    assert.equal(content.writes(), 0);
  }
});

for (const attribute of ["title", "aria-label", "placeholder"] as const) {
  test(`a current ${attribute} replaces the previously translated value`, () => {
    const initial = attribute === "placeholder" ? "Cerca per targa, marca, modello, sede..." : "Veicoli";
    const updated = attribute === "placeholder" ? "Cerca cliente per nome, documento, email..." : "Clienti";
    const expected = attribute === "placeholder" ? "Search customer by name, document, email..." : "Customers";
    const label = element({ [attribute]: initial });
    translateElementAttributes(label.node, "en");
    label.render(attribute, updated);
    translateElementAttributes(label.node, "en");
    assert.equal(label.value(attribute), expected);
    const writes = label.writes();
    translateElementAttributes(label.node, "en");
    assert.equal(label.writes(), writes);
    translateElementAttributes(label.node, "it");
    assert.equal(label.value(attribute), updated);
  });
}

test("removed and then reused accessibility attributes preserve the new label", () => {
  const label = element({ "aria-label": "Veicoli" });
  translateElementAttributes(label.node, "en");
  label.remove("aria-label");
  translateElementAttributes(label.node, "en");
  assert.equal(label.value("aria-label"), undefined);
  label.render("aria-label", "Clienti");
  translateElementAttributes(label.node, "en");
  assert.equal(label.value("aria-label"), "Customers");
});
