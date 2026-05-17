import { useEffect, useRef } from "react";
import { RentalBookingStatus } from "../../../application/usecases/rental-bookings-usecases";
import { ShieldCheck, Wrench } from "lucide-react";

type BookingCell = {
  id: string;
  code: string;
  status: RentalBookingStatus;
  customerName: string;
  pickupAt: string;
  returnAt: string;
  pickupKm?: number | null;
  returnKm?: number | null;
};

type VehicleRow = {
  vehicle: {
    id: string;
    plate: string;
    brand: string;
    model: string;
    deadlineStatus?: {
      maintenance: DeadlineIndicator;
      revision: DeadlineIndicator;
    };
    site?: { id: string; name: string; city?: string | null };
  };
  bookings: BookingCell[];
};

type DeadlineIndicator = {
  status: "OK" | "DUE_SOON" | "EXPIRED";
  label: string;
  detail: string;
};

type Props = {
  monthKey: string;
  monthDays: Date[];
  rows: VehicleRow[];
  className?: string;
  statusFilter?: RentalBookingStatus | "";
  selectedBookingId?: string | null;
  onSelectBooking: (bookingId: string) => void;
  onEmptyCellClick: (input: { vehicleId: string; date: Date }) => void;
  onBookingContextMenu: (input: { booking: BookingCell; x: number; y: number }) => void;
  getStatusClass: (status: RentalBookingStatus) => string;
};

const dayRange = (date: Date) => {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const overlapsDay = (booking: BookingCell, date: Date) => {
  const { start, end } = dayRange(date);
  const pickup = new Date(booking.pickupAt);
  const ret = new Date(booking.returnAt);
  return pickup < end && ret > start;
};

const bookingSpanInMonth = (booking: BookingCell, monthDays: Date[]) => {
  let startIndex = -1;
  let endIndex = -1;
  monthDays.forEach((date, index) => {
    if (!overlapsDay(booking, date)) return;
    if (startIndex === -1) startIndex = index;
    endIndex = index;
  });
  if (startIndex === -1 || endIndex === -1) return null;
  return {
    start: startIndex,
    span: endIndex - startIndex + 1
  };
};

const isSameCalendarDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const formatShortDateTime = (value: string) =>
  new Date(value).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

const deadlineToneClass = (status: DeadlineIndicator["status"]) => {
  if (status === "EXPIRED") return "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-800/70 dark:bg-rose-950/50 dark:text-rose-300";
  if (status === "DUE_SOON") return "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300";
  return "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300";
};

const fallbackDeadline = (label: string): DeadlineIndicator => ({
  status: "OK",
  label,
  detail: "Tutto ok"
});

export const RentalBookingMonthlyGrid = ({
  monthKey,
  monthDays,
  rows,
  className = "max-h-[68vh]",
  statusFilter,
  selectedBookingId,
  onSelectBooking,
  onEmptyCellClick,
  onBookingContextMenu,
  getStatusClass
}: Props) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const vehicleColumnWidth = 232;
  const dayColumnMinWidth = 34;
  const daysColumns = `repeat(${monthDays.length}, minmax(${dayColumnMinWidth}px, 1fr))`;
  const minGridWidth = vehicleColumnWidth + monthDays.length * dayColumnMinWidth;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  useEffect(() => {
    if (!scrollerRef.current) return;
    const todayIndex = monthDays.findIndex((date) => isSameCalendarDay(date, today));
    const nextScrollLeft =
      todayIndex >= 0
        ? Math.max(0, vehicleColumnWidth + todayIndex * dayColumnMinWidth - scrollerRef.current.clientWidth * 0.42)
        : 0;
    window.requestAnimationFrame(() => {
      if (!scrollerRef.current) return;
      scrollerRef.current.scrollLeft = nextScrollLeft;
    });
  }, [dayColumnMinWidth, monthDays, monthKey, todayKey, vehicleColumnWidth]);

  return (
    <div
      ref={scrollerRef}
      className={`${className} overflow-auto rounded-2xl border border-border/70 bg-card shadow-[0_18px_55px_-38px_rgba(15,23,42,0.55)]`}
    >
      <div style={{ minWidth: `${minGridWidth}px` }}>
        <div
          className="sticky top-0 z-40 grid border-b border-border/80 bg-card/95 backdrop-blur"
          style={{ gridTemplateColumns: `${vehicleColumnWidth}px repeat(${monthDays.length}, minmax(${dayColumnMinWidth}px, 1fr))` }}
        >
          <div className="sticky left-0 z-50 flex h-12 items-center overflow-hidden border-r border-border/80 bg-card px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground shadow-[10px_0_18px_-18px_rgba(15,23,42,0.75)]">
            Veicolo / targa
          </div>
          {monthDays.map((date) => {
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            const isToday = isSameCalendarDay(date, today);
            return (
            <div
              key={`head-${date.toISOString()}`}
              className={`flex h-12 flex-col items-center justify-center border-r border-border/70 px-1 text-center text-[10px] font-semibold last:border-r-0 ${
                isWeekend ? "bg-muted/30 text-muted-foreground" : "text-muted-foreground"
              }`}
              aria-current={isToday ? "date" : undefined}
            >
              <div className="uppercase tracking-[0.12em]">{date.toLocaleDateString("it-IT", { weekday: "short" }).slice(0, 2)}</div>
              <div
                className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                  isToday ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground"
                }`}
              >
                {date.getDate()}
              </div>
            </div>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <div className="flex min-h-[360px] items-center justify-center border-b border-border/60 px-6 text-center">
            <div className="max-w-sm">
              <p className="text-sm font-semibold text-foreground">Nessun veicolo visibile</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Prova a cambiare sede, stato o ricerca per visualizzare la disponibilità del mese.
              </p>
            </div>
          </div>
        ) : null}

        {rows.map((row) => {
          const filteredBookings = row.bookings.filter((booking) => (statusFilter ? booking.status === statusFilter : true));
          const maintenanceStatus = row.vehicle.deadlineStatus?.maintenance ?? fallbackDeadline("Manutenzione ok");
          const revisionStatus = row.vehicle.deadlineStatus?.revision ?? fallbackDeadline("Revisione ok");
          return (
          <div
            key={row.vehicle.id}
            className="grid border-b border-border/60 last:border-b-0"
            style={{ gridTemplateColumns: `${vehicleColumnWidth}px minmax(0, 1fr)` }}
          >
            <div className="sticky left-0 z-30 flex h-11 flex-col justify-center overflow-hidden border-r border-border/80 bg-card px-3 shadow-[10px_0_18px_-18px_rgba(15,23,42,0.65)]">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-primary/70" aria-hidden="true" />
                <p className="truncate text-[12px] font-semibold leading-none tracking-[0.03em]">{row.vehicle.plate}</p>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${deadlineToneClass(maintenanceStatus.status)}`}
                    title={`${maintenanceStatus.label} · ${maintenanceStatus.detail}`}
                    aria-label={`${row.vehicle.plate}: ${maintenanceStatus.label}. ${maintenanceStatus.detail}`}
                  >
                    <Wrench className="h-3 w-3" aria-hidden="true" />
                  </span>
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${deadlineToneClass(revisionStatus.status)}`}
                    title={`${revisionStatus.label} · ${revisionStatus.detail}`}
                    aria-label={`${row.vehicle.plate}: ${revisionStatus.label}. ${revisionStatus.detail}`}
                  >
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  </span>
                </span>
              </div>
              <p className="mt-1 truncate pl-4 text-[10px] leading-none text-muted-foreground">{row.vehicle.brand} {row.vehicle.model}</p>
            </div>
            <div className="relative">
              <div className="grid" style={{ gridTemplateColumns: daysColumns }}>
                {monthDays.map((date) => {
                  const dayBookings = filteredBookings.filter((booking) => overlapsDay(booking, date));
                  const first = dayBookings[0];
                  const isSelected = Boolean(first && selectedBookingId === first.id);
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  const isToday = isSameCalendarDay(date, today);

                  return (
                    <button
                      key={`${row.vehicle.id}-${date.toISOString()}`}
                      type="button"
                      className={`group relative h-11 border-r border-border/60 px-0.5 text-left transition-colors last:border-r-0 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        isWeekend ? "bg-muted/[0.18]" : "bg-card"
                      } ${isToday ? "bg-primary/[0.045]" : ""} ${first ? "hover:bg-primary/5" : "hover:bg-muted/35"} ${
                        isSelected ? "ring-1 ring-primary/50" : ""
                      }`}
                      onClick={() => {
                        if (first) onSelectBooking(first.id);
                        else onEmptyCellClick({ vehicleId: row.vehicle.id, date });
                      }}
                      onContextMenu={(event) => {
                        if (!first) return;
                        event.preventDefault();
                        onBookingContextMenu({ booking: first, x: event.clientX, y: event.clientY });
                      }}
                      aria-label={
                        first
                          ? `Prenotazione ${first.code} - ${first.customerName}`
                          : `Cella vuota ${row.vehicle.plate} ${date.toLocaleDateString("it-IT")}`
                      }
                    />
                  );
                })}
              </div>

              <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: daysColumns }}>
                {filteredBookings.map((booking) => {
                    const span = bookingSpanInMonth(booking, monthDays);
                    if (!span) return null;
                    const isSelected = selectedBookingId === booking.id;
                    const dateRange = `${formatShortDateTime(booking.pickupAt)} - ${formatShortDateTime(booking.returnAt)}`;
                    return (
                      <button
                        key={`bar-${booking.id}`}
                        type="button"
                        className={`pointer-events-auto mx-[2px] my-[7px] flex h-[28px] min-w-0 items-center rounded-[10px] border px-2 text-left text-[10px] font-semibold leading-none shadow-sm transition-[box-shadow,transform,filter] duration-150 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${getStatusClass(booking.status)} ${
                          isSelected ? "ring-2 ring-primary/80" : ""
                        }`}
                        style={{ gridColumn: `${span.start + 1} / span ${span.span}` }}
                        onClick={() => onSelectBooking(booking.id)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          onBookingContextMenu({ booking, x: event.clientX, y: event.clientY });
                        }}
                        title={`${booking.code} · ${booking.customerName} · ${dateRange}`}
                        aria-label={`Prenotazione ${booking.code} - ${booking.customerName}`}
                      >
                        <span className="block min-w-0 truncate">
                          {booking.code} · {booking.customerName}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
};
