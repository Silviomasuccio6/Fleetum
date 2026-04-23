import { useEffect, useRef } from "react";
import { RentalBookingStatus } from "../../../application/usecases/rental-bookings-usecases";

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
    site?: { id: string; name: string; city?: string | null };
  };
  bookings: BookingCell[];
};

type Props = {
  monthKey: string;
  monthDays: Date[];
  rows: VehicleRow[];
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

export const RentalBookingMonthlyGrid = ({
  monthKey,
  monthDays,
  rows,
  statusFilter,
  selectedBookingId,
  onSelectBooking,
  onEmptyCellClick,
  onBookingContextMenu,
  getStatusClass
}: Props) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const vehicleColumnWidth = 220;
  const dayColumnMinWidth = 30;
  const daysColumns = `repeat(${monthDays.length}, minmax(${dayColumnMinWidth}px, 1fr))`;
  const minGridWidth = vehicleColumnWidth + monthDays.length * dayColumnMinWidth;

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollLeft = 0;
  }, [monthKey]);

  return (
    <div ref={scrollerRef} className="overflow-x-auto rounded-lg border">
      <div style={{ minWidth: `${minGridWidth}px` }}>
        <div
          className="grid border-b bg-muted/20"
          style={{ gridTemplateColumns: `${vehicleColumnWidth}px repeat(${monthDays.length}, minmax(${dayColumnMinWidth}px, 1fr))` }}
        >
          <div className="sticky left-0 z-30 overflow-hidden border-r bg-muted px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground shadow-[6px_0_10px_-10px_rgba(15,23,42,0.55)]">
            Veicolo
          </div>
          {monthDays.map((date) => (
            <div key={`head-${date.toISOString()}`} className="border-r px-1 py-1 text-center text-[10px] font-semibold text-muted-foreground last:border-r-0">
              <div>{date.toLocaleDateString("it-IT", { weekday: "short" }).slice(0, 2)}</div>
              <div className="text-[11px] text-foreground">{date.getDate()}</div>
            </div>
          ))}
        </div>

        {rows.map((row) => (
          <div key={row.vehicle.id} className="grid border-b last:border-b-0" style={{ gridTemplateColumns: `${vehicleColumnWidth}px minmax(0, 1fr)` }}>
            <div className="sticky left-0 z-20 overflow-hidden border-r bg-card px-2 py-1.5 shadow-[6px_0_10px_-10px_rgba(15,23,42,0.45)]">
              <p className="truncate text-[12px] font-semibold">{row.vehicle.plate}</p>
              <p className="truncate text-[10px] text-muted-foreground">{row.vehicle.brand} {row.vehicle.model}</p>
            </div>
            <div className="relative">
              <div className="grid" style={{ gridTemplateColumns: daysColumns }}>
                {monthDays.map((date) => {
                  const filteredBookings = row.bookings.filter((booking) => (statusFilter ? booking.status === statusFilter : true));
                  const dayBookings = filteredBookings.filter((booking) => overlapsDay(booking, date));
                  const first = dayBookings[0];
                  const isSelected = Boolean(first && selectedBookingId === first.id);
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                  return (
                    <button
                      key={`${row.vehicle.id}-${date.toISOString()}`}
                      type="button"
                      className={`group relative h-8 border-r border-b-0 px-0.5 text-left transition last:border-r-0 ${
                        isWeekend ? "bg-muted/[0.18]" : "bg-card"
                      } ${first ? "hover:bg-primary/5" : "hover:bg-muted/35"} ${isSelected ? "ring-1 ring-primary/50" : ""}`}
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
                {row.bookings
                  .filter((booking) => (statusFilter ? booking.status === statusFilter : true))
                  .map((booking) => {
                    const span = bookingSpanInMonth(booking, monthDays);
                    if (!span) return null;
                    const isSelected = selectedBookingId === booking.id;
                    return (
                      <button
                        key={`bar-${booking.id}`}
                        type="button"
                        className={`pointer-events-auto mx-[1px] my-[5px] h-[22px] rounded-[7px] border px-1.5 text-left text-[9px] font-semibold leading-tight shadow-sm transition ${getStatusClass(booking.status)} ${
                          isSelected ? "ring-1 ring-primary" : ""
                        }`}
                        style={{ gridColumn: `${span.start + 1} / span ${span.span}` }}
                        onClick={() => onSelectBooking(booking.id)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          onBookingContextMenu({ booking, x: event.clientX, y: event.clientY });
                        }}
                        aria-label={`Prenotazione ${booking.code} - ${booking.customerName}`}
                      >
                        <span className="block truncate">
                          {booking.code} · {booking.customerName}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
