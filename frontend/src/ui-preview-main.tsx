import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarDays, Car, Clock3, Plus, X } from "lucide-react";
import { Button } from "./presentation/components/ui/button";
import { Input } from "./presentation/components/ui/input";
import { Label } from "./presentation/components/ui/label";
import { Select } from "./presentation/components/ui/select";
import { WorkspacePageHeader, WorkspaceMetricStrip } from "./presentation/components/ui/workspace-ui";
import { useDialogFocus } from "./presentation/hooks/use-dialog-focus";
import { initTheme, getStoredTheme, setTheme } from "./infrastructure/theme/theme-manager";
import "./presentation/styles/fonts.css";
import "./presentation/styles/global.css";
import "./presentation/styles/workspace.css";

initTheme();
const Foundations = () => {
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, dialog, () => setOpen(false));
  return <div className="workspace-shell" style={{ minHeight: "100vh", padding: "40px 24px" }}>
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <WorkspacePageHeader eyebrow="FLEETUM · SISTEMA GRAFICO" title="Componenti e regole" description="La base comune per tutte le schermate del gestionale." actions={<><a href="/booking" className="rounded-lg border px-4 py-2">Apri Prenotazioni</a><Button variant="outline" onClick={() => setTheme(getStoredTheme() === "dark" ? "light" : "dark")}>Cambia tema</Button></>} />
      <div className="booking-workspace" style={{ marginTop: 24 }}>
        <WorkspaceMetricStrip items={[{ label: "Veicoli", value: 12, hint: "Nel periodo selezionato", icon: Car }, { label: "Consegne", value: 3, hint: "Previste oggi", icon: CalendarDays }, { label: "Rientri", value: 2, hint: "Previsti oggi", icon: Clock3 }]} />
        <div className="grid gap-5 md:grid-cols-2">
          <section className="saas-surface p-6"><h2 className="mb-4 text-base font-semibold">Azioni e gerarchia</h2><div className="flex flex-wrap gap-3">
            <Button onClick={() => setNotice("Azione principale selezionata.")}><Plus className="h-4 w-4" aria-hidden="true" />Azione principale</Button>
            <Button variant="outline" onClick={() => setNotice("Azione secondaria selezionata.")}>Secondaria</Button><Button variant="ghost" onClick={() => setNotice("")}>Azzera messaggio</Button><Button disabled>Non disponibile</Button>
          </div><p className="mt-4 text-sm text-muted-foreground">Una priorità riconoscibile, dimensioni e stati coerenti.</p><p role="status" className="mt-3 text-sm">{notice}</p></section>
          <section className="saas-surface p-6"><h2 className="mb-4 text-base font-semibold">Campi e filtri</h2><div className="space-y-4"><div><Label htmlFor="sample-name">Nome cliente</Label><Input id="sample-name" placeholder="Es. Cliente dimostrativo" /></div><div><Label htmlFor="sample-site">Sede</Label><Select id="sample-site"><option>Tutte le sedi</option><option>Milano Centrale</option><option>Aeroporto</option></Select></div></div></section>
          <section className="saas-surface p-6"><h2 className="mb-4 text-base font-semibold">Stati leggibili</h2><div className="flex flex-wrap gap-3">{[["CONFIRMED", "Confermata"], ["IN_RENT", "In noleggio"], ["QUOTED", "Preventivo"], ["HOLD", "Opzione"], ["CLOSED", "Chiusa"], ["CANCELED", "Annullata"]].map(([state, label]) => <span key={state} className="booking-status" data-booking-status={state}>{label}</span>)}</div><p className="mt-4 text-sm text-muted-foreground">Il testo mantiene il significato anche senza distinguere il colore.</p></section>
          <section className="saas-surface p-6"><h2 className="mb-4 text-base font-semibold">Finestre e tastiera</h2><Button variant="outline" onClick={() => setOpen(true)}>Apri finestra di esempio</Button><p className="mt-4 text-sm text-muted-foreground">Focus iniziale, tabulazione interna, chiusura con Esc e ritorno al pulsante.</p></section>
        </div>
      </div>
    </div>
    {open ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div role="dialog" aria-modal="true" aria-labelledby="sample-dialog-title" tabIndex={-1} ref={dialog} className="saas-surface w-full max-w-md p-6"><div className="flex items-center justify-between gap-4"><h2 id="sample-dialog-title" className="text-lg font-semibold">Esempio di finestra</h2><Button variant="ghost" size="icon" aria-label="Chiudi finestra" onClick={() => setOpen(false)}><X className="h-4 w-4" aria-hidden="true" /></Button></div><p className="my-5 text-sm text-muted-foreground">Le azioni hanno etichette esplicite e il focus resta nella finestra.</p><Button onClick={() => { setOpen(false); setNotice("Esempio confermato."); }}>Conferma esempio</Button></div></div> : null}
  </div>;
};
createRoot(document.getElementById("root")!).render(<Foundations />);
