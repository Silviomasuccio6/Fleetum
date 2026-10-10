import assert from "node:assert/strict";
import test from "node:test";
import * as recovery from "../verify-restore-recovery.mjs";

const registry = Array.from({ length: 35 }, (_, index) => ({ model: `Model${index}`, legacyField: "amount" }));
const fieldRows = registry.map((field) => ({ model: field.model, field: field.legacyField, rowCount: 6, mismatchCount: 0, msg: "Exact money reconciliation field checked" }));
const completed = { checkedFields: 35, mismatchCount: 0, msg: "Exact money reconciliation completed" };
const output = (rows) => `npm script header\n${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

test("money evidence requires every audited populated field and the official final receipt", () => {
  assert.equal(typeof recovery.parseMoneyReconciliation, "function");
  const result = recovery.parseMoneyReconciliation(output([...fieldRows, completed]), registry);
  assert.equal(result.checkedFields, 35); assert.equal(result.mismatchCount, 0);
  assert.equal(result.fields.length, 35); assert.equal(result.fields[0].rowCount, 6);
  for (const rows of [fieldRows, [...fieldRows.slice(1), completed], [...fieldRows, fieldRows[0], completed], [...fieldRows, completed, completed]]) {
    assert.throws(() => recovery.parseMoneyReconciliation(output(rows), registry));
  }
});

test("money evidence rejects mismatch, empty-table false coverage and untyped counts", () => {
  assert.equal(typeof recovery.parseMoneyReconciliation, "function");
  for (const mutation of [{ mismatchCount: 1 }, { rowCount: 0 }, { rowCount: "6" }, { mismatchCount: "0" }]) {
    assert.throws(() => recovery.parseMoneyReconciliation(output([{ ...fieldRows[0], ...mutation }, ...fieldRows.slice(1), completed]), registry));
  }
  assert.throws(() => recovery.parseMoneyReconciliation(output([...fieldRows, { ...completed, checkedFields: 34 }]), registry));
});

test("dual-write evidence binds the official insert/update receipt to all 35 fields and 13 tables", () => {
  assert.equal(typeof recovery.parseDualWriteReceipt, "function");
  const receipt = { checkedFields: 35, checkedTables: 13, msg: "Exact money insert and update triggers verified" };
  assert.deepEqual(recovery.parseDualWriteReceipt(output([receipt])), { checkedFields: 35, checkedTables: 13 });
  for (const rows of [[], [receipt, receipt], [{ ...receipt, checkedTables: 12 }], [{ ...receipt, checkedFields: "35" }]]) {
    assert.throws(() => recovery.parseDualWriteReceipt(output(rows)));
  }
});
