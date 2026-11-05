import { useFleetumLanguage } from "../../i18n/fleetum-language";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { Car, MapPin, ShieldCheck, Wrench } from "lucide-react";
import type { RentalBookingStatus } from "../../../application/usecases/rental-bookings-usecases";

type BookingCell = {
  id: string; code: string; status: RentalBookingStatus; customerName: string;
  pickupAt: string; returnAt: string; pickupKm?: number | null; returnKm?: number | null;
};
type DeadlineIndicator = { status: "OK" | "DUE_SOON" | "EXPIRED"; label: string; detail: string };
export type RentalBookingGridRow = {
  vehicle: {
    id: string; plate: string; brand: string; model: string;
    deadlineStatus?: { maintenance: DeadlineIndicator; revision: DeadlineIndicator };
    site?: { id: string; name: string; city?: string | null };
  };
  bookings: BookingCell[];
};
type Props = {
  monthKey: string; monthDays: Date[]; rows: RentalBookingGridRow[]; className?: string;
  statusFilter?: RentalBookingStatus | ""; selectedBookingId?: string | null;
  onSelectBooking: (bookingId: string) => void;
  onEmptyCellClick: (input: { vehicleId: string; date: Date }) => void;
  onBookingContextMenu: (input: { booking: BookingCell; x: number; y: number }) => void;
  getStatusClass: (status: RentalBookingStatus) => string;
};
const statusLabels: Record<RentalBookingStatus, string> = {
  DRAFT: "Bozza", QUOTED: "Preventivo", HOLD: "Opzione", CONFIRMED: "Confermata", CONTRACT_SIGNED: "Contratto firmato",
  READY_FOR_HANDOVER: "Pronta consegna", IN_RENT: "In noleggio", CLOSED: "Chiusa", CANCELED: "Annullata", NO_SHOW: "No-show"
};
const overlapsDay = (booking: BookingCell, date: Date) => {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return new Date(booking.pickupAt) < end && new Date(booking.returnAt) > start;
};
const spanInMonth = (booking: BookingCell, days: Date[]) => {
  const indices = days.flatMap((date, index) => overlapsDay(booking, date) ? [index] : []);
  return indices.length ? { start: indices[0], end: indices[indices.length - 1], span: indices.length } : null;
};
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const formatDate = (value: string, locale: string) => new Date(value).toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export const RentalBookingMonthlyGrid = ({ monthKey, monthDays, rows, className = "booking-calendar-scroller", statusFilter, selectedBookingId, onSelectBooking, onEmptyCellClick, onBookingContextMenu, getStatusClass }: Props) => {
  const { language } = useFleetumLanguage();
  const locale = language === "en" ? "en-GB" : "it-IT";
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const vehicleWidth = 248;
  const dayWidth = 38;
  const daysColumns = `repeat(${monthDays.length}, minmax(${dayWidth}px, 1fr))`;
  const today = new Date();
  const todayKey = today.toDateString();
  const todayIndex = monthDays.findIndex((date) => sameDay(date, today));
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      if (scroller) scroller.scrollLeft = todayIndex < 0 ? 0 : Math.max(0, todayIndex * dayWidth - (scroller.clientWidth - vehicleWidth) / 2);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [monthDays, monthKey, todayIndex, todayKey]);

  const moveCalendarFocus = (event: KeyboardEvent<HTMLButtonElement>, rowIndex: number, columnIndex: number) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [rowIndex, columnIndex - 1], ArrowRight: [rowIndex, columnIndex + 1], ArrowUp: [rowIndex - 1, columnIndex], ArrowDown: [rowIndex + 1, columnIndex], Home: [rowIndex, 0], End: [rowIndex, monthDays.length - 1] };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    const row = Math.max(0, Math.min(rows.length - 1, next[0]));
    const day = Math.max(0, Math.min(monthDays.length - 1, next[1]));
    const target = scrollerRef.current?.querySelector<HTMLButtonElement>(`[data-calendar-cell="${row}-${day}"]`);
    target?.focus({ preventScroll: true });
    const scroller = scrollerRef.current;
    if (scroller && target) {
      const bounds = scroller.getBoundingClientRect();
      const cell = target.getBoundingClientRect();
      if (cell.left < bounds.left + vehicleWidth) scroller.scrollLeft -= bounds.left + vehicleWidth - cell.left;
      if (cell.right > bounds.right) scroller.scrollLeft += cell.right - bounds.right;
      if (cell.top < bounds.top + 60) scroller.scrollTop -= bounds.top + 60 - cell.top;
      if (cell.bottom > bounds.bottom) scroller.scrollTop += cell.bottom - bounds.bottom;
    }
  };

  return (
    <div ref={scrollerRef} className={className} role="region" aria-label="Calendario mensile disponibilità veicoli" tabIndex={0}>
      <div style={{ minWidth: vehicleWidth + monthDays.length * dayWidth }}>
        <div className="booking-calendar-head" style={{ gridTemplateColumns: `${vehicleWidth}px ${daysColumns}` }}>
          <div className="booking-calendar-vehicle-head"><Car className="h-4 w-4" aria-hidden="true" />Veicolo e sede</div>
          {monthDays.map((date) => <div key={date.toISOString()} className="booking-calendar-day" aria-current={sameDay(date, today) ? "date" : undefined} data-weekend={date.getDay() === 0 || date.getDay() === 6}>
            <span>{date.toLocaleDateString(locale, { weekday: "short" }).slice(0, 2)}</span><strong>{date.getDate()}</strong>
          </div>)}
        </div>
        {rows.length === 0 ? <div className="booking-empty"><Car className="h-8 w-8" aria-hidden="true" /><h3>Nessun veicolo visibile</h3><p>Prova a cambiare sede o ricerca per visualizzare la disponibilità del mese.</p></div> : null}
        {rows.map((row, rowIndex) => {
          const bookings = row.bookings.filter((booking) => !statusFilter || booking.status === statusFilter);
          // A return and a new pickup can share a day. Use separate visual lanes.
          const laneEnds: number[] = [];
          const bars = [...bookings].sort((a, b) => a.pickupAt.localeCompare(b.pickupAt)).flatMap((booking) => {
            const span = spanInMonth(booking, monthDays);
            if (!span) return [];
            let lane = laneEnds.findIndex((end) => end < span.start);
            if (lane === -1) lane = laneEnds.length;
            laneEnds[lane] = span.end;
            return [{ booking, span, lane }];
          });
          // Each lane keeps a 44px target, 6px gaps, 12px vertical padding and the row border.
          const height = Math.max(74, laneEnds.length * 44 + Math.max(0, laneEnds.length - 1) * 6 + 13);
          return <div className="booking-calendar-row" key={row.vehicle.id} style={{ gridTemplateColumns: `${vehicleWidth}px minmax(0,1fr)`, minHeight: height }}>
            <div className="booking-calendar-vehicle">
              <span className="booking-calendar-car"><Car className="h-4 w-4" aria-hidden="true" /></span>
              <div className="booking-calendar-vehicle-text"><strong translate="no">{row.vehicle.plate}</strong><p translate="no">{row.vehicle.brand} {row.vehicle.model}</p><p><MapPin className="mr-1 inline h-3 w-3" aria-hidden="true" />{row.vehicle.site?.name ?? "Sede non assegnata"}</p></div>
              <span className="booking-calendar-health">
                {row.vehicle.deadlineStatus ? <>
                  <span role="img" data-deadline-status={row.vehicle.deadlineStatus.maintenance.status} title={row.vehicle.deadlineStatus.maintenance.detail} aria-label={`${row.vehicle.deadlineStatus.maintenance.label}: ${row.vehicle.deadlineStatus.maintenance.detail}`}><Wrench className="h-3 w-3" aria-hidden="true" /></span>
                  <span role="img" data-deadline-status={row.vehicle.deadlineStatus.revision.status} title={row.vehicle.deadlineStatus.revision.detail} aria-label={`${row.vehicle.deadlineStatus.revision.label}: ${row.vehicle.deadlineStatus.revision.detail}`}><ShieldCheck className="h-3 w-3" aria-hidden="true" /></span>
                </> : null}
              </span>
            </div>
            <div className="booking-calendar-track" style={{ gridTemplateColumns: daysColumns }}>
              {monthDays.map((date, dayIndex) => {
                const first = bookings.find((booking) => overlapsDay(booking, date));
                return <button key={date.toISOString()} type="button" data-calendar-cell={`${rowIndex}-${dayIndex}`} className="booking-calendar-cell" data-weekend={date.getDay() === 0 || date.getDay() === 6} data-today={sameDay(date, today)} tabIndex={dayIndex === Math.max(0, todayIndex) ? 0 : -1}
                  onKeyDown={(event) => moveCalendarFocus(event, rowIndex, dayIndex)}
                  onClick={() => first ? onSelectBooking(first.id) : onEmptyCellClick({ vehicleId: row.vehicle.id, date })}
                  onContextMenu={(event) => { if (first) { event.preventDefault(); onBookingContextMenu({ booking: first, x: event.clientX, y: event.clientY }); } }}
                  aria-label={first ? `${row.vehicle.plate}, ${date.toLocaleDateString(locale)}, ${first.customerName}, ${statusLabels[first.status]}` : `Cella vuota ${row.vehicle.plate} ${date.toLocaleDateString(locale)}`} />;
              })}
              <div className="booking-calendar-bars" style={{ gridTemplateColumns: daysColumns }}>
                {bars.map(({ booking, span, lane }) => <button key={booking.id} type="button" className={`booking-calendar-bar ${getStatusClass(booking.status)}`} data-booking-status={booking.status} aria-pressed={selectedBookingId === booking.id} style={{ gridColumn: `${span.start + 1} / span ${span.span}`, gridRow: lane + 1 }}
                  onClick={() => onSelectBooking(booking.id)} onContextMenu={(event) => {event.preventDefault(); onBookingContextMenu({ booking, x: event.clientX, y: event.clientY });}}
                  title={`${booking.code} · ${booking.customerName} · ${statusLabels[booking.status]} · ${formatDate(booking.pickupAt, locale)} – ${formatDate(booking.returnAt, locale)}`}
                  aria-label={`Prenotazione ${booking.code} - ${booking.customerName}, ${statusLabels[booking.status]}, ${formatDate(booking.pickupAt, locale)} – ${formatDate(booking.returnAt, locale)}`}>
                  <span translate="no">{booking.customerName}</span>
                </button>)}
              </div>
            </div>
          </div>;
        })}
      </div>
    </div>
  );
};
