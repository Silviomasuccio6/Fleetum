import { useFleetumLanguage } from "../../../i18n/fleetum-language";
import { CalendarEvent, CalendarItem } from "../calendar-types";
import { getMonthGridDays, toDateKey } from "../calendar-utils";
import { cn } from "../../../../lib/utils";

type MonthViewProps = {
  viewDate: Date;
  selDay: Date;
  events: CalendarEvent[];
  calendars: CalendarItem[];
  onPickDay: (date: Date) => void;
};

export const MonthView = ({ viewDate, selDay, events, calendars, onPickDay }: MonthViewProps) => {
  const { language } = useFleetumLanguage();
  const locale = language === "en" ? "en-GB" : "it-IT";
  const days = getMonthGridDays(viewDate);
  const todayKey = toDateKey(new Date());
  const selectedKey = toDateKey(selDay);

  const eventsByDate = days.reduce<Record<string, CalendarEvent[]>>((acc, day) => {
    const key = toDateKey(day);
    acc[key] = events
      .filter((event) => event.date === key)
      .sort((a, b) => `${a.start}`.localeCompare(`${b.start}`));
    return acc;
  }, {});

  return (
    <div className="calendar-month" role="group" aria-label="Calendario mensile">
      <div className="calendar-month__weekdays">
        {days.slice(0, 7).map((day) => (
          <span key={toDateKey(day)}>{day.toLocaleDateString(locale, { weekday: "short" })}</span>
        ))}
      </div>

      <div className="calendar-month__grid">
        {days.map((day) => {
          const key = toDateKey(day);
          const dayEvents = eventsByDate[key] ?? [];
          const isOtherMonth = day.getMonth() !== viewDate.getMonth();
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;

          return (
            <button
              key={key}
              type="button"
              className={cn(
                "calendar-month__cell",
                isOtherMonth && "is-om",
                isToday && "is-today",
                isSelected && "is-selected"
              )}
              onClick={() => onPickDay(day)}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
              aria-label={day.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            >
              <span className={cn("calendar-month__daynum", isToday && "is-today", isSelected && "is-selected")}>{day.getDate()}</span>

              <div className="calendar-month__events">
                {dayEvents.slice(0, 3).map((event) => {
                  const calendar = calendars.find((item) => item.id === event.calendarId) ?? calendars[0];
                  return (
                    <span
                      key={event.id}
                      className="calendar-month__event"
                      translate="no"
                      style={{ background: calendar.bg, color: calendar.tc }}
                    >
                      {event.title}
                    </span>
                  );
                })}
                {dayEvents.length > 3 ? <span className="calendar-month__more">+{dayEvents.length - 3}</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
