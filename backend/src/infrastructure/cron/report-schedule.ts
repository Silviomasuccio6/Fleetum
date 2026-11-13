type ReportFrequency = "daily" | "weekly" | "monthly";

type ReportSchedule = {
  frequency: ReportFrequency;
  hour: number;
  minute: number;
};

const parseSchedule = (settings: unknown): ReportSchedule | null => {
  if (!settings || typeof settings !== "object" || !("enabled" in settings) || !settings.enabled) return null;

  const value = settings as Record<string, unknown>;
  const hour = Number(value.hour ?? 8);
  const minute = Number(value.minute ?? 0);
  const frequency = value.frequency ?? "weekly";
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  if (frequency !== "daily" && frequency !== "weekly" && frequency !== "monthly") return null;
  return { frequency, hour, minute };
};

// Calendar arithmetic is performed in UTC so a local skipped midnight cannot
// change which civil date is examined. Only the final slot uses process-local
// time, matching the existing report configuration and cron behavior.
const civilDay = (date: Date) => new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
const shiftCivilDay = (date: Date, days: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

const localSlot = (day: Date, schedule: ReportSchedule): Date | null => {
  const year = day.getUTCFullYear();
  const month = day.getUTCMonth();
  const date = day.getUTCDate();
  const slot = new Date(year, month, date, schedule.hour, schedule.minute, 0, 0);
  // Spring DST transitions can make the requested local hour nonexistent.
  if (
    slot.getFullYear() !== year || slot.getMonth() !== month || slot.getDate() !== date ||
    slot.getHours() !== schedule.hour || slot.getMinutes() !== schedule.minute
  ) {
    return null;
  }
  // The Date constructor picks the first occurrence of a repeated fall hour.
  return slot;
};

const scheduleDay = (anchor: Date, frequency: ReportFrequency, offset: number): Date => {
  if (frequency === "daily") return shiftCivilDay(anchor, offset);
  if (frequency === "weekly") {
    const daysSinceMonday = (anchor.getUTCDay() + 6) % 7;
    return shiftCivilDay(anchor, -daysSinceMonday + offset * 7);
  }
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + offset, 1));
};

export const reportTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Most recent real local slot, regardless of how long ago it occurred. */
export const latestDueOccurrence = (settings: unknown, now: Date): Date | null => {
  const schedule = parseSchedule(settings);
  if (!schedule || !Number.isFinite(now.getTime())) return null;
  const anchor = civilDay(now);
  for (let period = 0; ; period += 1) {
    const slot = localSlot(scheduleDay(anchor, schedule.frequency, -period), schedule);
    if (slot && slot.getTime() <= now.getTime()) return slot;
  }
};

/** First real local slot strictly later than the supplied instant. */
export const nextScheduledOccurrence = (settings: unknown, after: Date): Date | null => {
  const schedule = parseSchedule(settings);
  if (!schedule || !Number.isFinite(after.getTime())) return null;
  const anchor = civilDay(after);
  for (let period = 0; ; period += 1) {
    const slot = localSlot(scheduleDay(anchor, schedule.frequency, period), schedule);
    if (slot && slot.getTime() > after.getTime()) return slot;
  }
};

/** A save during the scheduled minute remains eligible; later saves are not retroactive. */
export const initialReportNextRunAt = (settings: unknown, savedAt: Date): Date | null => {
  const latest = latestDueOccurrence(settings, savedAt);
  if (latest && savedAt.getTime() < latest.getTime() + 60_000) return latest;
  return nextScheduledOccurrence(settings, savedAt);
};
