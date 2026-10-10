import assert from "node:assert/strict";
import test from "node:test";
import {
  getUiRecoveryCopy,
  renderBootstrapFailure
} from "../src/presentation/components/errors/ui-recovery.js";

type FakeElement = {
  id: string;
  className: string;
  textContent: string | null;
  type?: string;
  children: FakeElement[];
  listeners: Record<string, () => void>;
  append: (...children: FakeElement[]) => void;
  replaceChildren: (...children: FakeElement[]) => void;
  setAttribute: (name: string, value: string) => void;
  addEventListener: (name: string, listener: () => void) => void;
};

const fakeElement = (): FakeElement => ({
  id: "",
  className: "",
  textContent: null,
  children: [],
  listeners: {},
  append(...children) {
    this.children.push(...children);
  },
  replaceChildren(...children) {
    this.children = children;
  },
  setAttribute() {},
  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }
});

test("the bootstrap fallback stays visible and reloads only after a manual action", () => {
  const root = fakeElement();
  let reloads = 0;
  const documentRef = {
    body: fakeElement(),
    getElementById: () => root,
    createElement: () => fakeElement()
  };

  renderBootstrapFailure(documentRef as unknown as Document, () => {
    reloads += 1;
  });

  assert.equal(reloads, 0);
  const main = root.children[0];
  const card = main.children[0];
  assert.equal(card.children[1].textContent, getUiRecoveryCopy("bootstrap").title);
  const retryButton = card.children.at(-1)!;
  assert.equal(retryButton.textContent, "Riprova");
  retryButton.listeners.click();
  assert.equal(reloads, 1);
});

test("recovery copy is generic and never interpolates exception details", () => {
  const sensitiveError = "Errore per mario.rossi@example.it su tenant segreto";
  const copy = JSON.stringify(getUiRecoveryCopy("route"));

  assert.equal(copy.includes(sensitiveError), false);
  assert.match(copy, /Riprova/);
});
