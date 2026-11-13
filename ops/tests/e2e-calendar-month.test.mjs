import assert from "node:assert/strict";
import test from "node:test";
import { calendarMonthSteps, openBookingMonth } from "../../tests/e2e/helpers/calendar.mjs";

test("21-day fixtures cross October to November and year boundaries", () => {
  assert.deepEqual(calendarMonthSteps("2026-10", "2026-11"), [{ month: "2026-11", button: "Mese successivo" }]);
  assert.deepEqual(calendarMonthSteps("2026-12", "2027-01"), [{ month: "2027-01", button: "Mese successivo" }]);
});
test("same month performs no navigation", () => assert.deepEqual(calendarMonthSteps("2026-11", "2026-11"), []));
test("backward navigation preserves month ordering across a year", () => {
  assert.deepEqual(calendarMonthSteps("2027-02", "2026-12"), [
    { month: "2027-01", button: "Mese precedente" }, { month: "2026-12", button: "Mese precedente" }
  ]);
});
test("malformed or out-of-range months fail rather than clicking indefinitely", () => {
  for (const month of ["2026-00", "2026-13", "2026-1", "2026/10", undefined]) assert.throws(() => calendarMonthSteps(month, "2026-11"));
  assert.throws(() => calendarMonthSteps("2026-10", "9999-12"), /fixture range/);
});

function browserFixture({ ok = true, month = "2026-11" } = {}) {
  const calls = [];
  let waiting;
  let visibleMonth = "2026-10";
  return { calls, visibleMonth: () => visibleMonth, page: {
    evaluate: async (fn, input) => fn(input),
    waitForResponse: (matches) => {
      calls.push("wait");
      return new Promise(resolve => { waiting = () => {
        // Ignore a concurrent response for another month or endpoint.
        assert.equal(matches({ url: () => "https://staging.invalid/api/master-data/vehicles?month=2026-11", request: () => ({ method: () => "GET" }) }), false);
        assert.equal(matches({ url: () => "https://staging.invalid/api/rental-bookings/availability/month?month=2026-12", request: () => ({ method: () => "GET" }) }), false);
        const response = { url: () => "https://staging.invalid/api/rental-bookings/availability/month?month=2026-11",
          request: () => ({ method: () => "GET" }), ok: () => ok, json: async () => ({ month }) };
        assert.equal(matches(response), true); resolve(response);
      }; });
    },
    getByRole: (role, options) => {
      assert.equal(role, "button"); assert.deepEqual(options, { name: "Mese successivo", exact: true });
      return { click: async () => { calls.push("click"); assert.ok(waiting, "register response wait before click"); visibleMonth = "2026-11"; waiting(); } };
    }
  } };
}
test("actual failure scenario opens November before selecting its booking", async () => {
  const f = browserFixture();
  assert.notEqual(f.visibleMonth(), "2026-11", "original setup keeps October, with no November booking button");
  assert.equal(await openBookingMonth(f.page, "2026-11-04T09:00:00.000Z", "2026-10"), "2026-11");
  assert.equal(f.visibleMonth(), "2026-11"); assert.deepEqual(f.calls, ["wait", "click"]);
});
test("failed availability or wrong response month fails the flow", async () => {
  for (const config of [{ ok: false }, { month: "2026-10" }]) {
    const f = browserFixture(config);
    await assert.rejects(openBookingMonth(f.page, "2026-11-04T09:00:00.000Z", "2026-10"), /did not load/);
  }
});
test("invalid pickup date rejects before any navigation", async () => {
  const f = browserFixture();
  await assert.rejects(openBookingMonth(f.page, "not-a-date", "2026-10"), /Invalid booking/);
  assert.deepEqual(f.calls, []);
});
