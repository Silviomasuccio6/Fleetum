import { useFleetumLanguage } from "../../i18n/fleetum-language";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { CalendarItem } from "./calendar-types";
import { Button } from "../ui/button";
import { getMonthGridDays, toDateKey } from "./calendar-utils";
import { cn } from "../../../lib/utils";

type CalendarSidebarProps = {
  miniDate: Date;
  selDay: Date;
  calendars: CalendarItem[];
  hasEventsOnDate: (dateKey: string) => boolean;
  onMiniNav: (dir: -1 | 1) => void;
  onPickDay: (date: Date) => void;
  onToggleCalendar: (calendarId: number, visible: boolean) => void;
  onCreateEvent: () => void;
};

export const CalendarSidebar = ({
  miniDate,
  selDay,
  calendars,
  hasEventsOnDate,
  onMiniNav,
  onPickDay,
  onToggleCalendar,
  onCreateEvent
}: CalendarSidebarProps) => {
  const { language } = useFleetumLanguage();
  const locale = language === "en" ? "en-GB" : "it-IT";
  const miniDays = getMonthGridDays(miniDate);
  const todayKey = toDateKey(new Date());
  const selectedKey = toDateKey(selDay);

  return (
    <aside className="calendar-sidebar">
      <div className="calendar-sidebar__head">
        <h3 className="calendar-sidebar__title">Calendari</h3>
        <Button size="sm" onClick={onCreateEvent}>
          <Plus className="h-4 w-4" />
          Nuovo evento
        </Button>
      </div>

      <section className="calendar-mini" aria-label="Mini calendario">
        <div className="calendar-mini__toolbar">
          <button type="button" className="calendar-mini__nav" onClick={() => onMiniNav(-1)} aria-label="Mese precedente">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="calendar-mini__month">{miniDate.toLocaleDateString(locale, { month: "long", year: "numeric" })}</p>
          <button type="button" className="calendar-mini__nav" onClick={() => onMiniNav(1)} aria-label="Mese successivo">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="calendar-mini__weekdays">
          {miniDays.slice(0, 7).map((day) => (
            <span key={toDateKey(day)}>{day.toLocaleDateString(locale, { weekday: "narrow" })}</span>
          ))}
        </div>

        <div className="calendar-mini__grid" role="group" aria-label="Giorni del mini calendario">
          {miniDays.map((day) => {
            const key = toDateKey(day);
            const isToday = key === todayKey;
            const isSelected = key === selectedKey;
            const isOtherMonth = day.getMonth() !== miniDate.getMonth();
            const showDot = hasEventsOnDate(key);

            return (
              <button
                key={key}
                type="button"
                className={cn(
                  "calendar-mini__day",
                  isToday && "is-today",
                  isSelected && "is-selected",
                  isOtherMonth && "is-om"
                )}
                onClick={() => onPickDay(day)}
                aria-current={isToday ? "date" : undefined}
                aria-pressed={isSelected}
                aria-label={day.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              >
                <span>{day.getDate()}</span>
                {showDot ? <i className="calendar-mini__dot" /> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="calendar-list" aria-label="Lista calendari">
        {calendars.map((calendar) => (
          <label key={calendar.id} className="calendar-list__item">
            <input
              type="checkbox"
              checked={calendar.visible}
              onChange={(event) => onToggleCalendar(calendar.id, event.target.checked)}
            />
            <span className="calendar-list__swatch" style={{ background: calendar.color }} />
            <span translate="no">{calendar.name}</span>
          </label>
        ))}
      </section>
    </aside>
  );
};
