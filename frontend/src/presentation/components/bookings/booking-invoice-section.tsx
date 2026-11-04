import { useEffect, useRef, useState } from "react";
import { Download, ReceiptText } from "lucide-react";
import { downloadBookingInvoiceDraft } from "../../../application/usecases/booking-invoice-usecases";
import { Button } from "../ui/button";
import { BookingDetailSection } from "./booking-detail-section";

export function BookingInvoiceSection({ bookingId, bookingCode, canRead }: { bookingId: string; bookingCode: string; canRead: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    request.current?.abort(); request.current = null;
    setBusy(false); setError(null); setStatus(null);
    return () => { mounted.current = false; request.current?.abort(); };
  }, [bookingId]);
  const download = async () => {
    if (!canRead || request.current) return;
    const active = new AbortController(); request.current = active;
    setBusy(true); setError(null); setStatus(null);
    try {
      const blob = await downloadBookingInvoiceDraft(bookingId, active.signal);
      if (!mounted.current || active.signal.aborted || request.current !== active) return;
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      try {
        anchor.href = url;
        anchor.download = `Bozza_fattura_${bookingCode.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "noleggio"}.pdf`;
        document.body.appendChild(anchor); anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (failure) { URL.revokeObjectURL(url); throw failure; }
      finally { anchor.remove(); }
      setStatus("Bozza PDF pronta per il download.");
    } catch (failure) {
      if (mounted.current && !active.signal.aborted) setError((failure as Error).message || "Bozza fattura non disponibile. Riprova.");
    } finally {
      if (request.current === active) request.current = null;
      if (mounted.current && !active.signal.aborted) setBusy(false);
    }
  };
  if (!canRead) return null;
  return (
    <BookingDetailSection title="Fattura di noleggio" description="Bozza PDF dai dati della prenotazione." icon={<ReceiptText />}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Il documento usa i dati aziendali, il cliente e gli importi salvati nella pratica. Verificalo prima dell’emissione.</p>
        <Button type="button" variant="outline" className="!min-h-[44px] w-full whitespace-normal sm:w-auto" disabled={busy} aria-busy={busy} onClick={() => void download()}>
          <Download className="h-4 w-4 shrink-0" aria-hidden="true" />{busy ? "Preparazione bozza PDF…" : "Scarica bozza PDF"}
        </Button>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">{status}</p>
      </div>
    </BookingDetailSection>
  );
}
