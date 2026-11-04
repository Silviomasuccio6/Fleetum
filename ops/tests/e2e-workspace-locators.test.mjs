import test from "node:test";
import assert from "node:assert/strict";
import { vehiclePaginationTextPattern, bookingCalendarButtonNamePattern } from "../../tests/e2e/helpers/workspace-locators.mjs";

test("vehicle totals from the observed new UI retain every API pagination value in IT and EN", () => {
  const pattern = vehiclePaginationTextPattern({ page: 1, pageSize: 20, total: 143 });
  for (const text of ["Pagina 1 di 8 · Totale record: 143", "Page 1 of 8 · Total records: 143"]) {
    assert.match(text, pattern);
  }
  for (const text of ["Pagina 2 di 8 · Totale record: 143", "Pagina 1 di 7 · Totale record: 143",
    "Page 1 of 8 · Total records: 142", "Page 1 of 8 · Total records: 1430", "Total records: 143"]) {
    assert.doesNotMatch(text, pattern);
  }
});

test("empty fleet counters still require page one of one and reject invalid API metadata", () => {
  const pattern = vehiclePaginationTextPattern({ page: 1, pageSize: 20, total: 0 });
  assert.match("Pagina 1 di 1 · Totale record: 0", pattern);
  assert.doesNotMatch("Page 1 of 0 · Total records: 0", pattern);
  for (const change of [{ page: 0 }, { page: 2 }, { pageSize: 0 }, { total: -1 }, { total: 1.5 },
    { total: NaN }, { total: Infinity }, { total: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => vehiclePaginationTextPattern({ page: 1, pageSize: 20, total: 0, ...change }));
  }
});

test("localized integer grouping cannot hide an incorrect vehicle total", () => {
  const pattern = vehiclePaginationTextPattern({ page: 2, pageSize: 20, total: 1234 });
  for (const total of ["1234", "1.234", "1,234", "1\u00a0234"]) assert.match(`Page 2 of 62 · Total records: ${total}`, pattern);
  for (const total of ["12.34", "1.235", "12,340", "123"]) assert.doesNotMatch(`Page 2 of 62 · Total records: ${total}`, pattern);
});

test("booking labels retain the exact identity while allowing the new status and date suffix", () => {
  const pattern = bookingCalendarButtonNamePattern({ code: "QA.123+", customerName: "Cliente (QA)" });
  assert.match("Prenotazione QA.123+ - Cliente (QA), Confermata, 4 nov – 6 nov", pattern);
  assert.match("Booking QA.123+ - Cliente (QA), Confirmed, Nov 4 – Nov 6", pattern);
  assert.match("Prenotazione QA.123+ - Cliente (QA)", pattern);
  for (const label of ["Prenotazione QAX123 - Cliente QA", "Prenotazione QA.124+ - Cliente (QA)",
    "Prenotazione QA.123+ - Altro cliente", "Prenotazione QA.123+ - Cliente (QA) extra"]) assert.doesNotMatch(label, pattern);
  assert.throws(() => bookingCalendarButtonNamePattern({ code: "", customerName: "Cliente" }));
});
