import assert from "node:assert/strict";
import test from "node:test";
import { canRunScheduledReport } from "../src/infrastructure/cron/reports-cron.js";

const scheduledAtEight = {
  enabled: true,
  frequency: "daily",
  hour: 8,
  minute: 0
};

test("downgraded Starter tenants do not receive previously configured scheduled reports", () => {
  const runAt = new Date(2026, 7, 3, 8, 0, 0);
  assert.equal(canRunScheduledReport("STARTER", scheduledAtEight, runAt), false);
  assert.equal(canRunScheduledReport("PRO", scheduledAtEight, runAt), true);
  assert.equal(canRunScheduledReport("ENTERPRISE", scheduledAtEight, runAt), true);
});

test("disabled schedules do not run and a missed minute can be recovered for entitled tenants", () => {
  assert.equal(canRunScheduledReport("PRO", { ...scheduledAtEight, enabled: false }, new Date(2026, 7, 3, 8, 0, 0)), false);
  assert.equal(canRunScheduledReport("PRO", scheduledAtEight, new Date(2026, 7, 3, 8, 1, 0)), true);
  assert.equal(canRunScheduledReport("PRO", scheduledAtEight, new Date(2026, 7, 3, 11, 1, 0)), false);
});

test("weekly and monthly schedules use the configured local calendar slot", () => {
  assert.equal(canRunScheduledReport("PRO", { ...scheduledAtEight, frequency: "weekly" }, new Date(2026, 7, 3, 8, 5)), true);
  assert.equal(canRunScheduledReport("PRO", { ...scheduledAtEight, frequency: "weekly" }, new Date(2026, 7, 4, 8, 5)), false);
  assert.equal(canRunScheduledReport("PRO", { ...scheduledAtEight, frequency: "monthly" }, new Date(2026, 7, 1, 8, 5)), true);
  assert.equal(canRunScheduledReport("PRO", { ...scheduledAtEight, frequency: "monthly" }, new Date(2026, 7, 2, 8, 5)), false);
});

test("both autumn instants map to a due local minute while a missing spring minute is skipped", () => {
  const originalTimeZone = process.env.TZ;
  process.env.TZ = "Europe/Rome";
  try {
    const atTwoThirty = { ...scheduledAtEight, hour: 2, minute: 30 };
    assert.equal(canRunScheduledReport("PRO", atTwoThirty, new Date("2026-10-25T00:30:00.000Z")), true);
    assert.equal(canRunScheduledReport("PRO", atTwoThirty, new Date("2026-10-25T01:30:00.000Z")), true);
    assert.equal(canRunScheduledReport("PRO", atTwoThirty, new Date("2026-03-29T01:30:00.000Z")), false);
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
});
