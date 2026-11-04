import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { downloadSubscriptionInvoicePdf } from "../../../application/usecases/billing-usecases";
import { useSiteAccessStore, captureSiteStamp, assertSiteStamp } from "../../../application/stores/site-access-store";
import { Button } from "../ui/button";

export function InvoiceDownloadButton({ invoiceId, invoiceNumber }: { invoiceId: string; invoiceNumber: string }) {
  const revision = useSiteAccessStore(state => state.revision);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [status, setStatus] = useState("");
  const request = useRef<AbortController | null>(null), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; request.current?.abort(); request.current = null;
    setBusy(false); setError(null); setStatus("");
    return () => { mounted.current = false; request.current?.abort(); };
  }, [invoiceId, revision]);
  const download = async () => {
    if (request.current) return;
    const active = new AbortController(), stamp = captureSiteStamp(); request.current = active;
    setBusy(true); setError(null); setStatus("");
    try {
      const blob = await downloadSubscriptionInvoicePdf(invoiceId, active.signal);
      if (!mounted.current || active.signal.aborted || request.current !== active) return;
      assertSiteStamp(stamp);
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      try {
        anchor.href = url; anchor.download = `Fleetum_${invoiceNumber.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "abbonamento"}.pdf`;
        document.body.appendChild(anchor); anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (failure) { URL.revokeObjectURL(url); throw failure; } finally { anchor.remove(); }
      setStatus("Copia PDF pronta per il download.");
    } catch (failure) {
      if (mounted.current && !active.signal.aborted && request.current === active) setError((failure as Error).message || "Copia PDF non disponibile. Riprova.");
    } finally {
      if (request.current === active) { request.current = null; if (mounted.current && !active.signal.aborted) setBusy(false); }
    }
  };
  return <div className="max-w-64 space-y-2">
    <Button type="button" variant="outline" className="!min-h-[44px]" disabled={busy} aria-busy={busy} aria-label={`Scarica PDF ${invoiceNumber}`} onClick={() => void download()}>
      <Download className="h-4 w-4" aria-hidden="true" />{busy ? "Preparazione PDF…" : "Scarica"}
    </Button>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    <p role="status" aria-live="polite" className="sr-only">{status}</p>
  </div>;
}
