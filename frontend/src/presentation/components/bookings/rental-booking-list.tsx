import { useFleetumLanguage } from "../../i18n/fleetum-language";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import type { RentalBookingStatus } from "../../../application/usecases/rental-bookings-usecases";
import type { RentalBookingGridRow } from "./rental-booking-monthly-grid";

type Props = {
  rows: RentalBookingGridRow[];
  statusFilter: RentalBookingStatus | "";
  selectedBookingId?: string | null;
  getStatusLabel: (status: RentalBookingStatus) => string;
  onSelectBooking: (id: string) => void;
};
const formatDate = (value: string, locale: string) => new Date(value).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export const RentalBookingList = ({ rows, statusFilter, selectedBookingId, getStatusLabel, onSelectBooking }: Props) => {
  const { language } = useFleetumLanguage();
  const locale = language === "en" ? "en-GB" : "it-IT";
  const entries = rows.flatMap(({ vehicle, bookings }) => bookings.filter((booking) => !statusFilter || booking.status === statusFilter)
    .map((booking) => ({ ...booking, vehicle }))).sort((a, b) => a.pickupAt.localeCompare(b.pickupAt));
  return (
    <section className="booking-list" aria-label="Elenco prenotazioni">
      <div className="booking-list-heading"><h3>Prenotazioni del periodo</h3><span>{entries.length} risultati</span></div>
      {entries.length === 0 ? <div className="booking-empty"><CalendarDays className="h-8 w-8" aria-hidden="true" /><h3>Nessuna prenotazione da mostrare</h3><p>Prova un altro periodo o modifica i filtri. Puoi creare una prenotazione dal pulsante in alto.</p></div> : (
        <ul>
          {entries.map((booking) => <li key={booking.id}>
            <button type="button" className="booking-list-row" aria-pressed={selectedBookingId === booking.id} onClick={() => onSelectBooking(booking.id)} aria-label={`Apri prenotazione ${booking.code}, ${booking.customerName}`}>
              <span className="booking-list-customer"><strong translate="no">{booking.customerName}</strong><span>{booking.code}</span></span>
              <span className="booking-list-vehicle"><strong translate="no">{booking.vehicle.brand} {booking.vehicle.model}</strong><span>{booking.vehicle.plate} · {booking.vehicle.site?.name ?? "Sede non assegnata"}</span></span>
              <span className="booking-list-dates"><span><small>Consegna</small>{formatDate(booking.pickupAt, locale)}</span><span><small>Rientro</small>{formatDate(booking.returnAt, locale)}</span></span>
              <span className="booking-status" data-booking-status={booking.status}>{getStatusLabel(booking.status)}</span>
              <ArrowUpRight className="booking-list-arrow h-4 w-4" aria-hidden="true" />
            </button>
          </li>)}
        </ul>
      )}
    </section>
  );
};
