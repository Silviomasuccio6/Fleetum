import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the exact helpers used by the payment forms and partial-capture prompt.
const source = readFileSync(new URL("../src/presentation/components/rental-payments/RentalPaymentGuaranteePanel.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["eurosToCents", "optionalEurosToCents"]);
const declarations = parsed.statements.filter((statement) => ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && names.has(declaration.name.text)));
assert.equal(declarations.length, 2);
const code = declarations.map((statement) => statement.getText(parsed)).join("\n");
const context = vm.createContext({});
vm.runInContext(ts.transpileModule(code + "\nglobalThis.helpers = { eurosToCents, optionalEurosToCents };", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
const { eurosToCents, optionalEurosToCents } = context.helpers as { eurosToCents: (value: string) => number | null; optionalEurosToCents: (value: string) => number | null };

test("payment inputs accept decimal comma and decimal point without inflating the amount", () => {
  for (const value of ["75", "75,00", "75.00", " 75.00 "]) assert.equal(eurosToCents(value), 7500, value);
  assert.equal(eurosToCents("0.01"), 1);
  assert.equal(eurosToCents("12,3"), 1230);
});

test("partial-capture defaults round-trip existing cent amounts", () => {
  for (const cents of [1, 99, 7550, 75000, 123456]) assert.equal(eurosToCents(String(cents / 100)), cents);
});

test("payment inputs preserve Italian grouping and reject malformed or unsafe amounts", () => {
  assert.equal(eurosToCents("1.234,56"), 123456);
  assert.equal(eurosToCents("1.234"), 123400);
  assert.equal(eurosToCents("1,234.56"), 123456);
  for (const value of ["", "0", "-1", "1e3", "75..00", "1,234", "0.001", "12.3456", "Infinity", "9007199254740992"]) assert.equal(eurosToCents(value), null, value);
});

test("optional administration fee is zero only when omitted", () => {
  assert.equal(optionalEurosToCents(" "), 0);
  assert.equal(optionalEurosToCents("10.00"), 1000);
  assert.equal(optionalEurosToCents("oops"), null);
});
