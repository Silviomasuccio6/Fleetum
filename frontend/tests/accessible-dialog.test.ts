import assert from "node:assert/strict";
import test from "node:test";
import {
  getDialogFocusTarget,
  getCrudFieldId,
  shouldRestoreDialogFocus,
  shouldCloseDialogOnKey
} from "../src/presentation/components/ui/accessible-dialog.js";

test("dialog focus wraps in both directions and stays put between its edges", () => {
  const first = { id: "first" };
  const middle = { id: "middle" };
  const last = { id: "last" };
  const focusable = [first, middle, last];

  assert.equal(getDialogFocusTarget(focusable, last, false), first);
  assert.equal(getDialogFocusTarget(focusable, first, true), last);
  assert.equal(getDialogFocusTarget(focusable, middle, false), null);
  assert.equal(getDialogFocusTarget(focusable, { id: "outside" }, false), first);
});

test("Escape closes an idle dialog but cannot interrupt an in-flight save", () => {
  assert.equal(shouldCloseDialogOnKey("Escape", false), true);
  assert.equal(shouldCloseDialogOnKey("Escape", true), false);
  assert.equal(shouldCloseDialogOnKey("Enter", false), false);
});

test("CRUD field ids are unique and do not expose arbitrary field keys", () => {
  assert.equal(getCrudFieldId("crud-r1", 0), "crud-r1-field-0");
  assert.equal(getCrudFieldId("crud-r1", 1), "crud-r1-field-1");
});

test("focus restoration waits until a successful save has re-enabled the opener", () => {
  assert.equal(shouldRestoreDialogFocus(true, false, true), false);
  assert.equal(shouldRestoreDialogFocus(true, false, false), true);
  assert.equal(shouldRestoreDialogFocus(false, false, false), false);
  assert.equal(shouldRestoreDialogFocus(true, true, false), false);
});
