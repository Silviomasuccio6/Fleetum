import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarDays, Car, Check, ChevronRight, CircleHelp, Clock3, CreditCard, Gauge, Layers3, Menu, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useDialogFocus } from "./presentation/hooks/use-dialog-focus";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./ui-glass.css";

// Standalone visual example: synthetic constants only, no API or product stores.
// This HTML entry is intentionally excluded from the production build.
type Operation = { code: string; client: string; initials: string; car: string; plate: string; time: string; site: string; state: string; tone: "green" | "amber" | "blue"; amount: string };
const departures: Operation[] = [
  { code: "FL-1042", client: "Marco Riva", initials: "MR", car: "Volkswagen Golf", plate: "QA 101 AA", time: "09:30", site: "Milano Centrale", state: "Pronta al ritiro", tone: "green", amount: "285,00 €" },
  { code: "FL-1043", client: "Giulia Conti", initials: "GC", car: "Fiat 500", plate: "QA 102 AA", time: "11:00", site: "Milano Centrale", state: "Da completare", tone: "amber", amount: "165,00 €" },
  { code: "FL-1044", client: "Andrea Bianchi", initials: "AB", car: "Toyota Yaris Cross", plate: "QA 103 AA", time: "14:00", site: "Aeroporto", state: "Confermata", tone: "blue", amount: "360,00 €" },
  { code: "FL-1045", client: "Elena Serra", initials: "ES", car: "Audi A3", plate: "QA 104 AA", time: "16:30", site: "Milano Centrale", state: "Confermata", tone: "blue", amount: "420,00 €" }
];
const returns: Operation[] = [
  { code: "FL-1036", client: "Luca Moretti", initials: "LM", car: "Jeep Avenger", plate: "QA 105 AA", time: "10:00", site: "Aeroporto", state: "In noleggio", tone: "blue", amount: "310,00 €" },
  { code: "FL-1037", client: "Sara Costa", initials: "SC", car: "Ford Puma", plate: "QA 106 AA", time: "12:30", site: "Milano Centrale", state: "In noleggio", tone: "blue", amount: "240,00 €" },
  { code: "FL-1038", client: "Paolo Greco", initials: "PG", car: "Renault Clio", plate: "QA 107 AA", time: "18:00", site: "Milano Centrale", state: "In noleggio", tone: "blue", amount: "195,00 €" }
];
const navigation = [
  { label: "Dashboard", href: "#panoramica", icon: Gauge, active: true },
  { label: "Prenotazioni", href: "/booking", icon: CalendarDays, active: false },
  { label: "Flotta", href: "#flotta", icon: Car, active: false },
  { label: "Attività del giorno", href: "#operazioni", icon: Clock3, active: false }
];

const curve = (values: number[], maximum: number) => {
  const points = values.map((value, i) => [36 + i * 100, 178 - value * 140 / maximum]);
  return points.reduce((path, point, i) => {
    if (!i) return `M ${point[0]} ${point[1]}`;
    const previous = points[i - 1];
    const middle = (previous[0] + point[0]) / 2;
    return `${path} C ${middle} ${previous[1]}, ${middle} ${point[1]}, ${point[0]} ${point[1]}`;
  }, "");
};

function GlassDashboard() {
  const [glass, setGlass] = useState(true);
  const [range, setRange] = useState<"week" | "month">("week");
  const [tab, setTab] = useState<"departures" | "returns">("departures");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Operation | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(Boolean(selected), dialog, () => setSelected(null));
  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [selected]);
  const rows = (tab === "departures" ? departures : returns).filter((item) => `${item.client} ${item.car} ${item.code} ${item.plate}`.toLocaleLowerCase("it").includes(query.toLocaleLowerCase("it")));
  const values = range === "week" ? [7, 11, 9, 15, 12, 17, 16] : [28, 35, 31, 39, 34, 41, 38];
  const comparison = range === "week" ? [6, 8, 7, 10, 9, 12, 11] : [22, 29, 27, 34, 30, 35, 31];
  const maximum = range === "week" ? 20 : 50;
  const ticks = range === "week" ? [0, 5, 10, 15, 20] : [0, 10, 20, 30, 40, 50];
  const chartLabels = range === "week" ? ["Mer 14", "Gio 15", "Ven 16", "Sab 17", "Dom 18", "Lun 19", "Mar 20"] : ["21 set", "25 set", "29 set", "3 ott", "7 ott", "11 ott", "16 ott"];
  const total = values.reduce((sum, value) => sum + value, 0);
  const previousTotal = comparison.reduce((sum, value) => sum + value, 0);
  const growth = Math.round((total / previousTotal - 1) * 100);
  const navLinks = navigation.map(({ label, href, icon: Icon, active }) => <a key={label} href={href} aria-current={active ? "page" : undefined} className={`gd-nav-link${active ? " is-active" : ""}`} onClick={() => setMenuOpen(false)}><Icon size={19} aria-hidden="true" /><span>{label}</span>{active && <span className="gd-nav-indicator" />}</a>);

  return <div className="glass-example" data-material={glass ? "glass" : "solid"}>
    <a className="gd-skip" href="#main">Vai al contenuto</a>
    <aside className="gd-sidebar gd-material" aria-label="Menu dell’esempio">
      <a href="#panoramica" className="gd-brand" aria-label="Fleetum, panoramica"><img src="/brand/fleetum-logo-for-light-bg.svg" alt="Fleetum" width="139" height="42" /></a>
      <div className="gd-workspace"><span className="gd-workspace-icon"><Car size={19} aria-hidden="true" /></span><div><strong>Fleetum Rental</strong><span>Workspace dimostrativo</span></div></div>
      <p className="gd-nav-caption">IL TUO GESTIONALE</p>
      <nav aria-label="Navigazione dell’esempio">{navLinks}</nav>
      <div className="gd-sidebar-bottom">
        <div className="gd-style-note"><Layers3 size={20} aria-hidden="true" /><strong>Un nuovo punto di vista.</strong><p>Superfici leggere.<br />Tutto al posto giusto.</p><a href="#materiali">Esplora il materiale <ArrowRight size={14} aria-hidden="true" /></a></div>
        <a className="gd-back-link" href="/dashboard"><ArrowRight size={16} aria-hidden="true" />Torna al pilota attuale</a>
        <div className="gd-profile"><span className="gd-avatar">UD</span><div><strong>Utente Demo</strong><span>Amministratore · esempio</span></div></div>
      </div>
    </aside>

    <div className="gd-body">
      <header className="gd-topbar gd-material">
        <div className="gd-breadcrumb"><span>Workspace</span><ChevronRight size={14} aria-hidden="true" /><strong>Dashboard</strong></div>
        <span className="gd-demo-badge"><span />Anteprima · dati fittizi</span>
        <button className="gd-menu-button gd-icon-button" aria-label={menuOpen ? "Chiudi menu" : "Apri menu"} aria-expanded={menuOpen} aria-controls="gd-mobile-menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button>
      </header>
      <nav id="gd-mobile-menu" className="gd-mobile-menu gd-material" aria-label="Navigazione mobile" hidden={!menuOpen}>{navLinks}<a href="/dashboard" className="gd-back-link">Torna al pilota attuale <ArrowRight size={16} aria-hidden="true" /></a></nav>

      <main id="main" className="gd-main">
        <section className="gd-page-heading" id="panoramica" aria-labelledby="gd-title">
          <div><p className="gd-eyebrow">MARTEDÌ 20 OTTOBRE 2026</p><h1 id="gd-title">La giornata, a colpo d’occhio<span>.</span></h1><p>La tua flotta e le attività di oggi, in un unico spazio.</p></div>
          <a href="/booking" className="gd-primary-button"><CalendarDays size={18} aria-hidden="true" />Apri calendario<ArrowUpRight size={16} aria-hidden="true" /></a>
        </section>

        <div className="gd-metrics" aria-label="Riepilogo dimostrativo">
          <section className="gd-metric gd-panel"><div className="gd-metric-label"><span>Ricavi di ottobre</span><span className="gd-metric-icon blue"><CreditCard size={19} aria-hidden="true" /></span></div><p className="gd-metric-value">24.680<span> €</span></p><p className="gd-metric-foot"><span className="gd-positive"><ArrowUpRight size={13} aria-hidden="true" />12,8%</span><span>rispetto a settembre</span></p></section>
          <section className="gd-metric gd-panel"><div className="gd-metric-label"><span>Noleggi in corso</span><span className="gd-metric-icon violet"><CalendarDays size={19} aria-hidden="true" /></span></div><p className="gd-metric-value">8<span> noleggi</span></p><p className="gd-metric-foot"><span className="gd-small-dot blue" />Tutti con contratto firmato</p></section>
          <section className="gd-metric gd-panel"><div className="gd-metric-label"><span>Veicoli disponibili</span><span className="gd-metric-icon teal"><Car size={19} aria-hidden="true" /></span></div><p className="gd-metric-value">18<span> / 28</span></p><p className="gd-metric-foot">Pronti per una nuova prenotazione</p></section>
          <section className="gd-metric gd-panel"><div className="gd-metric-label"><span>Rientri di oggi</span><span className="gd-metric-icon amber"><ArrowDownLeft size={19} aria-hidden="true" /></span></div><p className="gd-metric-value">3<span> rientri</span></p><p className="gd-metric-foot"><Clock3 size={13} aria-hidden="true" />Il prossimo alle 10:00</p></section>
        </div>

        <div className="gd-insights">
          <section className="gd-chart gd-panel" aria-labelledby="gd-chart-title">
            <div className="gd-section-heading"><div><h2 id="gd-chart-title">Andamento prenotazioni</h2><p>{range === "week" ? "Una visione chiara del tuo lavoro." : "Totali per intervalli di 4–5 giorni."}</p></div><div className="gd-segmented" role="group" aria-label="Periodo del grafico"><button aria-pressed={range === "week"} onClick={() => setRange("week")}>7 giorni</button><button aria-pressed={range === "month"} onClick={() => setRange("month")}>30 giorni</button></div></div>
            <div className="gd-chart-summary" aria-live="polite"><strong>{total}</strong><span>prenotazioni</span><span className="gd-positive"><ArrowUpRight size={14} aria-hidden="true" />{growth}%</span></div>
            <svg className="gd-line-chart" viewBox="0 0 680 216" role="img" aria-labelledby="gd-chart-description">
              <title id="gd-chart-description">Prenotazioni negli ultimi {range === "week" ? "7 giorni, per giorno" : "30 giorni, raggruppate in intervalli di 4–5 giorni con la data iniziale indicata"}. {values.map((value, i) => `${chartLabels[i]}: ${value}`).join("; ")}. Il tratteggio indica il periodo precedente.</title>
              <defs><linearGradient id="gd-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5575ed" stopOpacity=".20" /><stop offset="100%" stopColor="#5575ed" stopOpacity="0" /></linearGradient></defs>
              {ticks.map((tick) => <g key={tick}><line x1="36" y1={178 - tick * 140 / maximum} x2="636" y2={178 - tick * 140 / maximum} className="gd-chart-grid" /><text x="9" y={182 - tick * 140 / maximum}>{tick}</text></g>)}
              <path d={`${curve(values, maximum)} L 636 178 L 36 178 Z`} fill="url(#gd-chart-fill)" />
              <path d={curve(comparison, maximum)} className="gd-comparison-line" /><path d={curve(values, maximum)} className="gd-current-line" />
              {values.map((value, i) => <circle key={i} cx={36 + i * 100} cy={178 - value * 140 / maximum} r="3.5" fill="#fff" stroke="#4164d9" strokeWidth="2" />)}
              {chartLabels.map((label, i) => <text key={label} x={36 + i * 100} y="206" textAnchor="middle">{label}</text>)}
            </svg>
            <div className="gd-chart-legend"><span><i />Periodo selezionato</span><span><i />Periodo precedente</span></div>
          </section>

          <section id="flotta" className="gd-fleet gd-panel" aria-labelledby="gd-fleet-title"><div className="gd-section-heading"><div><h2 id="gd-fleet-title">La tua flotta</h2><p>Disponibilità di oggi</p></div><Car size={19} className="gd-muted-icon" aria-hidden="true" /></div>
            <div className="gd-donut" role="img" aria-label="28 veicoli totali: 18 disponibili, 8 in noleggio, 2 in manutenzione"><div><strong>28</strong><span>veicoli totali</span></div></div>
            <dl className="gd-fleet-legend"><div><dt><i className="blue" />Disponibili</dt><dd>18</dd></div><div><dt><i className="violet" />In noleggio</dt><dd>8</dd></div><div><dt><i className="amber" />In manutenzione</dt><dd>2</dd></div></dl>
          </section>
        </div>

        <section id="operazioni" className="gd-operations gd-panel" aria-labelledby="gd-operations-title">
          <div className="gd-section-heading"><div><h2 id="gd-operations-title">In programma oggi</h2><p>Partenze e rientri, senza perdere il filo.</p></div><a href="/booking" className="gd-text-link">Tutte le prenotazioni<ArrowUpRight size={15} aria-hidden="true" /></a></div>
          <div className="gd-operation-controls"><div className="gd-operation-tabs" role="group" aria-label="Tipo di operazione"><button aria-pressed={tab === "departures"} onClick={() => setTab("departures")}>Partenze<span>4</span></button><button aria-pressed={tab === "returns"} onClick={() => setTab("returns")}>Rientri<span>3</span></button></div><label className="gd-search"><Search size={17} aria-hidden="true" /><span className="gd-sr-only">Cerca nelle attività di oggi</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca cliente o veicolo…" /></label></div>
          <div className="gd-table" role="table" aria-label={tab === "departures" ? "Partenze di oggi" : "Rientri di oggi"}>
            <div className="gd-table-head" role="row"><span role="columnheader">CLIENTE</span><span role="columnheader">VEICOLO</span><span role="columnheader">ORARIO E SEDE</span><span role="columnheader">STATO</span><span role="columnheader" className="gd-sr-only">Dettagli</span></div>
            <div role="rowgroup">{rows.map((item) => <div className="gd-table-row" role="row" key={item.code}><div role="cell" className="gd-client"><span className="gd-avatar" aria-hidden="true">{item.initials}</span><span><strong>{item.client}</strong><small>{item.code}</small></span></div><div role="cell"><strong>{item.car}</strong><small>{item.plate}</small></div><div role="cell"><strong>{item.time}</strong><small>{item.site}</small></div><div role="cell"><span className={`gd-status ${item.tone}`}>{item.state}</span></div><div role="cell"><button className="gd-icon-button" aria-label={`Apri dettaglio ${item.code}`} onClick={() => setSelected(item)}><ChevronRight size={18} aria-hidden="true" /></button></div></div>)}</div>
          </div>
          {!rows.length && <p className="gd-empty" role="status">Nessuna attività corrisponde alla ricerca.</p>}
          <div className="gd-table-foot"><span>{rows.length} attività in elenco</span><span><Check size={14} aria-hidden="true" />Dati dimostrativi · nessun salvataggio</span></div>
        </section>

        <section id="materiali" className="gd-material-switch gd-material" aria-labelledby="gd-material-title"><div className="gd-material-description"><span className="gd-material-symbol"><Sparkles size={20} aria-hidden="true" /></span><div><h2 id="gd-material-title">Minimalismo. Con un tocco di vetro.</h2><p>Confronta le finiture sulla stessa Dashboard.</p></div></div><button className="gd-switch-control" role="switch" aria-checked={glass} onClick={() => setGlass(!glass)}><span>Effetto vetro</span><span className="gd-switch-track"><span /></span></button></section>
        <footer className="gd-footer"><span>FLEETUM · STUDIO UI</span><span>Esempio di stile · versione chiara</span><a href="/ui-preview.html"><SlidersHorizontal size={13} aria-hidden="true" />Componenti del pilota</a></footer>
      </main>
    </div>

    {selected && <div className="gd-dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><div ref={dialog} className="gd-detail gd-material" role="dialog" aria-modal="true" aria-labelledby="gd-detail-title" tabIndex={-1}><div className="gd-section-heading"><span className="gd-eyebrow">PRENOTAZIONE DIMOSTRATIVA</span><button className="gd-icon-button" aria-label="Chiudi dettaglio" onClick={() => setSelected(null)}><X size={20} aria-hidden="true" /></button></div><h2 id="gd-detail-title">{selected.code}</h2><span className={`gd-status ${selected.tone}`}>{selected.state}</span><dl><div><dt>Cliente fittizio</dt><dd>{selected.client}</dd></div><div><dt>Veicolo</dt><dd>{selected.car}<small>{selected.plate}</small></dd></div><div><dt>{tab === "departures" ? "Ritiro" : "Rientro"}</dt><dd>20 ottobre, ore {selected.time}<small>{selected.site}</small></dd></div><div><dt>Totale dimostrativo</dt><dd>{selected.amount}</dd></div></dl><p className="gd-detail-note"><CircleHelp size={17} aria-hidden="true" />Questa finestra mostra il trattamento visivo dei dettagli. I dati sono fittizi e non vengono salvati.</p><button className="gd-primary-button" onClick={() => setSelected(null)}>Torna alla Dashboard<ArrowRight size={16} aria-hidden="true" /></button></div></div>}
  </div>;
}

createRoot(document.getElementById("glass-root")!).render(<GlassDashboard />);
