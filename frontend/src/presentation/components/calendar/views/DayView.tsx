import { useFleetumLanguage } from "../../../i18n/fleetum-language";
import { CalendarEvent, CalendarItem } from "../calendar-types";
import { EventBlock } from "../EventBlock";
import {
  DAY_GRID_HEIGHT,
  HOUR_HEIGHT,
  getNowLineTop,
  intersectsDay,
  positionDayEvents,
  toDateKey
} from "../calendar-utils";

const HOURS = Array.from({ length: 24 }, (_, idx) => idx);

type DayViewProps = {
  viewDate: Date;
  events: CalendarEvent[];
  calendars: CalendarItem[];
  onEventClick: (event: CalendarEvent, anchorRect: DOMRect) => void;
  onEventResizeEnd: (event: CalendarEvent, nextStart: string, nextEnd: string) => void;
  onEventMoveEnd: (event: CalendarEvent, nextDate: string, nextStart: string, nextEnd: string) => void;
  onCreateAt: (day: Date, minutes: number, anchorRect?: DOMRect | null) => void;
};

export const DayView = ({ viewDate, events, calendars, onEventClick, onEventResizeEnd, onEventMoveEnd, onCreateAt }: DayViewProps) => {
  const { language } = useFleetumLanguage();
  const locale = language === "en" ? "en-GB" : "it-IT";
  const dayEvents = positionDayEvents(events.filter((event) => intersectsDay(event, viewDate)), viewDate);
  const timedEvents = events.filter((event) => !event.allDay && intersectsDay(event, viewDate));
  const nowTop = getNowLineTop();
  const today = toDateKey(new Date()) === toDateKey(viewDate);

  return (
    <div className="calendar-day" role="group" aria-label="Calendario giornaliero">
      <header className="calendar-day__head">
        <div>
          <p className="calendar-day__date">{viewDate.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
          <p className="calendar-day__count">{timedEvents.length} {language === "en" ? "scheduled events" : "eventi pianificati"}</p>
        </div>
      </header>

      <div className="calendar-day__body">
        <div className="calendar-time-col">
          {HOURS.map((hour) => (
            <div key={hour} className="calendar-time-col__slot" style={{ top: hour * HOUR_HEIGHT }}>
              {`${String(hour).padStart(2, "0")}:00`}
            </div>
          ))}
        </div>

        <div
          className="calendar-day-col"
          onClick={(mouseEvent) => {
            if (mouseEvent.target !== mouseEvent.currentTarget) return;
            const rect = mouseEvent.currentTarget.getBoundingClientRect();
            const offset = mouseEvent.clientY - rect.top;
            const minute = Math.round((Math.max(0, Math.min(DAY_GRID_HEIGHT, offset)) / DAY_GRID_HEIGHT) * 1440);
            onCreateAt(viewDate, minute, new DOMRect(mouseEvent.clientX, mouseEvent.clientY, 1, 1));
          }}
        >
          {HOURS.map((hour) => (
            <div key={`hour-${hour}`} className="calendar-hour-line" style={{ top: hour * HOUR_HEIGHT }} />
          ))}
          {HOURS.map((hour) => (
            <div key={`half-${hour}`} className="calendar-half-line" style={{ top: hour * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
          ))}

          {today ? (
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
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
