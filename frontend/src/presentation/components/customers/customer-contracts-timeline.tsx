import { BookingContractStatus, RentalCustomerContractTimelineItem } from "../../../application/usecases/rental-bookings-usecases";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Select } from "../ui/select";

const contractStatusLabel: Record<BookingContractStatus, string> = {
  DRAFT: "Bozza",
  READY: "Pronto",
  SENT: "Inviato",
  SIGNED: "Firmato",
  ERROR: "Errore"
};

const bookingStatusLabel: Record<string, string> = {
  DRAFT: "Bozza",
  QUOTED: "Preventivo",
  HOLD: "Opzione",
  CONFIRMED: "Confermata",
  CONTRACT_SIGNED: "Contratto firmato",
  READY_FOR_HANDOVER: "Pronta consegna",
  IN_RENT: "In noleggio",
  CLOSED: "Chiusa",
  CANCELED: "Annullata",
  NO_SHOW: "No-show"
};

const currency = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

type Props = {
  items: RentalCustomerContractTimelineItem[];
  loading: boolean;
  error: string | null;
  period: "all" | "7d" | "30d" | "90d" | "custom";
  status: "" | BookingContractStatus;
  dateFrom: string;
  dateTo: string;
  onPeriodChange: (value: "all" | "7d" | "30d" | "90d" | "custom") => void;
  onStatusChange: (value: "" | BookingContractStatus) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onApplyFilters: () => void;
  onOpenBooking: (bookingId: string) => void;
  onDownloadPdf: (bookingId: string) => void;
  onSendEmail: (bookingId: string) => void;
  onMarkSigned: (bookingId: string) => void;
};

export const CustomerContractsTimeline = ({
  items,
  loading,
  error,
  period,
  status,
  dateFrom,
  dateTo,
  onPeriodChange,
  onStatusChange,
  onDateFromChange,
  onDateToChange,
  onApplyFilters,
  onOpenBooking,
  onDownloadPdf,
  onSendEmail,
  onMarkSigned
}: Props) => {
  return (
    <Card className="saas-surface">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Storico Noleggi & Contratti</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-[180px_180px_1fr_auto]">
          <div className="space-y-1">
            <Label>Periodo</Label>
            <Select value={period} onChange={(event) => onPeriodChange(event.target.value as Props["period"])}>
              <option value="all">Tutto</option>
              <option value="7d">7 giorni</option>
              <option value="30d">30 giorni</option>
              <option value="90d">90 giorni</option>
              <option value="custom">Personalizzato</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Stato contratto</Label>
            <Select value={status} onChange={(event) => onStatusChange(event.target.value as Props["status"])}>
              <option value="">Tutti</option>
              <option value="DRAFT">Bozza</option>
              <option value="READY">Pronto</option>
              <option value="SENT">Inviato</option>
              <option value="SIGNED">Firmato</option>
              <option value="ERROR">Errore</option>
            </Select>
          </div>
          {period === "custom" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Da</Label>
                <input
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  type="date"
                  value={dateFrom}
                  onChange={(event) => onDateFromChange(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>A</Label>
                <input
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  type="date"
                  value={dateTo}
                  onChange={(event) => onDateToChange(event.target.value)}
                />
              </div>
            </div>
          ) : (
            <div />
          )}
          <div className="flex items-end">
            <Button variant="outline" onClick={onApplyFilters}>
              Applica filtri
            </Button>
          </div>
        </div>

        {loading ? <p className="text-xs text-muted-foreground">Caricamento timeline contratti...</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            Nessun contratto trovato con i filtri correnti.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <article key={item.id} className="rounded-xl border border-border/70 bg-background/80 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">
                      {item.booking.code} · {item.booking.vehicle.plate}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.booking.pickupAt).toLocaleString("it-IT")} →{" "}
                      {new Date(item.booking.returnAt).toLocaleString("it-IT")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.booking.vehicle.brand} {item.booking.vehicle.model}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={item.status === "SIGNED" ? "success" : item.status === "ERROR" ? "destructive" : "secondary"}>
                      {contractStatusLabel[item.status]}
                    </Badge>
                    <Badge variant="outline">{bookingStatusLabel[item.booking.status] ?? item.booking.status}</Badge>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>Previsto: {item.booking.expectedTotal != null ? currency.format(item.booking.expectedTotal) : "-"}</span>
                  <span>Finale: {item.booking.finalTotal != null ? currency.format(item.booking.finalTotal) : "-"}</span>
                  <span>Invio: {item.lastSentAt ? new Date(item.lastSentAt).toLocaleString("it-IT") : "-"}</span>
                  <span>Firma: {item.signedAt ? new Date(item.signedAt).toLocaleString("it-IT") : "-"}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => onOpenBooking(item.bookingId)} aria-label="Apri dettaglio prenotazione">
                    Apri prenotazione
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onDownloadPdf(item.bookingId)} aria-label="Scarica contratto PDF">
                    Scarica PDF
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onSendEmail(item.bookingId)} aria-label="Invia contratto via email">
                    Invia email
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onMarkSigned(item.bookingId)} aria-label="Marca contratto firmato">
                    Marca firmato
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
