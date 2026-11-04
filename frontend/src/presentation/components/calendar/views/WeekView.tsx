import { useFleetumLanguage } from "../../../i18n/fleetum-language";
import { CalendarEvent, CalendarItem } from "../calendar-types";
import { EventBlock } from "../EventBlock";
import {
  DAY_GRID_HEIGHT,
  HOUR_HEIGHT,
  addDays,
  getNowLineTop,
  intersectsDay,
  positionDayEvents,
  toDateKey
} from "../calendar-utils";
import { getWeekStart } from "../hooks/useCalendar";
import { cn } from "../../../../lib/utils";

type WeekViewProps = {
  viewDate: Date;
  selDay: Date;
  events: CalendarEvent[];
  calendars: CalendarItem[];
  onPickDay: (day: Date) => void;
  onEventClick: (event: CalendarEvent, anchorRect: DOMRect) => void;
  onEventResizeEnd: (event: CalendarEvent, nextStart: string, nextEnd: string) => void;
  onEventMoveEnd: (event: CalendarEvent, nextDate: string, nextStart: string, nextEnd: string) => void;
  onCreateAt: (day: Date, minutes: number, anchorRect?: DOMRect | null) => void;
};

const HOURS = Array.from({ length: 24 }, (_, idx) => idx);

export const WeekView = ({
  viewDate,
  selDay,
  events,
  calendars,
  onPickDay,
  onEventClick,
  onEventResizeEnd,
  onEventMoveEnd,
  onCreateAt
}: WeekViewProps) => {
  const { language } = useFleetumLanguage();
  const locale = language === "en" ? "en-GB" : "it-IT";
  const weekStart = getWeekStart(viewDate);
  const weekDays = Array.from({ length: 7 }, (_, idx) => addDays(weekStart, idx));
  const todayKey = toDateKey(new Date());
  const selectedKey = toDateKey(selDay);
  const nowTop = getNowLineTop();

  return (
    <div className="calendar-week" role="group" aria-label="Calendario settimanale">
      <div className="calendar-week__header">
        <div className="calendar-week__time-head" />
        {weekDays.map((day) => {
          const key = toDateKey(day);
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;

          return (
            <button
              key={key}
              type="button"
              className={cn("calendar-week__day-head", isToday && "is-today", isSelected && "is-selected")}
              onClick={() => onPickDay(day)}
              aria-current={isToday ? "date" : undefined}
                aria-pressed={isSelected}
                aria-label={day.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            >
              <span className="calendar-week__weekday">{day.toLocaleDateString(locale, { weekday: "short" })}</span>
              <span className="calendar-week__daynum">{day.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div className="calendar-week__body">
        <div className="calendar-time-col">
          {HOURS.map((hour) => (
            <div key={hour} className="calendar-time-col__slot" style={{ top: hour * HOUR_HEIGHT }}>
              {`${String(hour).padStart(2, "0")}:00`}
            </div>
          ))}
        </div>

        {weekDays.map((day) => {
          const key = toDateKey(day);
          const dayEvents = positionDayEvents(events.filter((event) => intersectsDay(event, day)), day);
          const isToday = key === todayKey;

          return (
            <div
              key={key}
              className={cn("calendar-day-col", isToday && "is-today")}
              onClick={(mouseEvent) => {
                if (mouseEvent.target !== mouseEvent.currentTarget) return;
                const rect = mouseEvent.currentTarget.getBoundingClientRect();
                const offset = mouseEvent.clientY - rect.top;
                const minute = Math.round((Math.max(0, Math.min(DAY_GRID_HEIGHT, offset)) / DAY_GRID_HEIGHT) * 1440);
                onCreateAt(day, minute, new DOMRect(mouseEvent.clientX, mouseEvent.clientY, 1, 1));
              }}
            >
              {HOURS.map((hour) => (
                <div key={`hour-${hour}`} className="calendar-hour-line" style={{ top: hour * HOUR_HEIGHT }} />
              ))}
              {HOURS.map((hour) => (
                <div key={`half-${hour}`} className="calendar-half-line" style={{ top: hour * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
              ))}

              {isToday ? (
                <div className="calendar-now-line" style={{ top: nowTop }}>
                  <i />
                </div>
              ) : null}

              {dayEvents.map((positioned) => {
                const calendar = calendars.find((item) => item.id === positioned.event.calendarId) ?? calendars[0];
                return (
                  <EventBlock
                    key={`${positioned.event.id}-${positioned.top}`}
                    event={positioned.event}
                    calendar={calendar}
                    top={positioned.top}
                    left={positioned.left}
                    width={positioned.width}
                    height={positioned.height}
                    onClick={onEventClick}
                    onResizeEnd={onEventResizeEnd}
                    onMoveEnd={onEventMoveEnd}
                    allowHorizontalDayShift
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
