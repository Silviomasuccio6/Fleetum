import assert from "node:assert/strict";
import test from "node:test";
import {
  initialReportNextRunAt,
  latestDueOccurrence,
  nextScheduledOccurrence,
  reportTimeZone
} from "../src/infrastructure/cron/report-schedule.js";

test("a spring DST gap has no slot and the next real daily slot is used", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Rome";
  try {
    const settings = { enabled: true, frequency: "daily", hour: 2, minute: 30 };
    assert.equal(reportTimeZone(), "Europe/Rome");
    assert.equal(
      latestDueOccurrence(settings, new Date("2026-03-29T12:00:00.000Z"))?.toISOString(),
      "2026-03-28T01:30:00.000Z"
    );
    assert.equal(
      nextScheduledOccurrence(settings, new Date("2026-03-28T01:30:00.000Z"))?.toISOString(),
      "2026-03-30T00:30:00.000Z"
    );
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("the repeated autumn hour is one local slot", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Rome";
  try {
    const settings = { enabled: true, frequency: "daily", hour: 2, minute: 30 };
    const first = new Date("2026-10-25T00:30:00.000Z");
    const second = new Date("2026-10-25T01:30:00.000Z");
    assert.equal(latestDueOccurrence(settings, first)?.toISOString(), first.toISOString());
    assert.equal(latestDueOccurrence(settings, second)?.toISOString(), first.toISOString());
    assert.equal(
      nextScheduledOccurrence(settings, first)?.toISOString(),
      "2026-10-26T01:30:00.000Z"
    );
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("saving after a slot does not initialize a retroactive cursor", () => {
  const settings = { enabled: true, frequency: "daily", hour: 8, minute: 0 };
  const slot = new Date(2032, 5, 11, 8, 0, 0, 0);
  assert.equal(
    initialReportNextRunAt(settings, new Date(slot.getTime() + 30_000))?.getTime(),
    slot.getTime()
  );
  assert.equal(
    initialReportNextRunAt(settings, new Date(slot.getTime() + 60_000))?.getTime(),
    new Date(2032, 5, 12, 8, 0, 0, 0).getTime()
  );
});
