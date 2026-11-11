import type { ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, CalendarDays, Car, ChevronRight, CircleAlert, FileText, Gauge } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { WorkspaceMetricStrip } from "../ui/workspace-ui";
import { Button } from "../ui/button";
import { WorkspaceChartFrame } from "../ui/workspace-chart-frame";
import { FleetCompositionChart } from "./fleet-composition-chart";

type Amount = number | string | null;
type BookingItem = { status?: string; id?: string; bookingId?: string; code?: string; customer?: string; vehicle?: string; pickupAt?: string; returnAt?: string; returnKm?: number | null; contractStatus?: string; reason?: string; severity?: string; type?: string };
export type BookingDashboard = {
  kpis?: Partial<Record<"totalRentalVehicles" | "availableToday" | "occupiedToday" | "activeBookings" | "pickupsToday" | "returnsToday" | "utilizationRateToday" | "overdueReturns", Amount>>;
  contractKpis?: Partial<Record<"toGenerate" | "toSend" | "sentToday" | "signed" | "errors" | "unsigned", Amount>>;
  economicKpis?: Partial<Record<"expectedRevenueMonth" | "finalRevenueMonth" | "averageTicket" | "revenuePerVehicle" | "revenuePerRentalDay" | "extraKmActual", Amount>>;
  charts?: { trend?: Array<{ day: string; created: number; pickups: number; returns: number }>; utilization?: Array<{ day: string; utilization: number; occupied: number }>; contractStatusDistribution?: Array<{ status: string; count: number }>; topVehicles?: Array<{ plate: string; model: string; occupiedDays: number; revenue: Amount }> };
  lists?: { nextPickups?: BookingItem[]; nextReturns?: BookingItem[]; criticalBookings?: BookingItem[] };
};

export const dashboardNumber = (value?: Amount, money = false) => {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.NumberFormat("it-IT", money ? { style: "currency", currency: "EUR" } : { maximumFractionDigits: 1 }).format(parsed);
};
export const bookingDestination = (id?: string) => id ? `/rental-bookings/${encodeURIComponent(id)}` : "/booking";
const statusLabels: Record<string, string> = { DRAFT: "Bozza", READY: "Pronto", SENT: "Inviato", SIGNED: "Firmato", NOT_READY: "Da preparare", ERROR: "Errore", HIGH: "Alta", MEDIUM: "Media" };
const dateLabel = (value?: string) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "—";
  return new Date(value).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
const dayLabel = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8)}/${value.slice(5, 7)}` : value;

const Panel = ({ title, subtitle, icon, children, className = "", action }: { title: string; subtitle?: string; icon?: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) => (
  <section className={`dashboard-panel ${className}`} aria-label={title}>
    <header className="dashboard-panel-header"><div><h2>{icon}{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>{action}</header>
    <div className="dashboard-panel-body">{children}</div>
  </section>
);
const Empty = ({ missing, children }: { missing?: boolean; children: ReactNode }) => <p className="dashboard-empty">{missing ? "Dati della sezione non disponibili." : children}</p>;
const BookingRow = ({ item, returnRow, critical, navigate, enabled }: { item: BookingItem; returnRow?: boolean; critical?: boolean; navigate: (to: string) => void; enabled: boolean }) => (
  <li>
    <button type="button" className="dashboard-booking-row" disabled={!enabled} onClick={() => navigate(bookingDestination(item.bookingId ?? item.id))} aria-label={`Apri prenotazione ${item.code ?? ""}, ${item.customer ?? ""}`}>
      <span className={`dashboard-row-icon ${critical ? "dashboard-row-alert" : ""}`} aria-hidden="true">{critical ? <CircleAlert /> : returnRow ? <ArrowDownLeft /> : <ArrowUpRight />}</span>
      <span className="dashboard-row-copy"><strong translate={critical ? "yes" : "no"}>{critical ? item.reason : item.customer}</strong><span translate="no">{critical ? `${item.customer ?? ""} · ${item.vehicle ?? ""}` : item.vehicle}</span><small><span translate="no">{dateLabel(returnRow ? item.returnAt : item.pickupAt)} · {item.code}</span>{returnRow ? <> · Km: <span>{item.returnKm ?? "mancanti"}</span></> : null}</small></span>
      <span className="dashboard-row-end"><span className={`dashboard-status ${item.severity === "HIGH" || item.contractStatus === "ERROR" ? "dashboard-status-alert" : ""}`}>{statusLabels[critical ? item.severity ?? "" : item.contractStatus ?? ""] ?? (critical ? item.severity : item.contractStatus)}</span>{enabled ? <ChevronRight aria-hidden="true" /> : null}</span>
    </button>
  </li>
);
const ChartTable = ({ rows, columns }: { rows: Array<Record<string, string | number>>; columns: Array<{ key: string; title: string }> }) => (
  <details className="dashboard-chart-data"><summary>Visualizza dati del grafico</summary><div className="dashboard-table-scroll"><table><caption>Dati del periodo visualizzato</caption><thead><tr>{columns.map(c => <th key={c.key} scope="col">{c.title}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{columns.map(c => <td key={c.key}>{row[c.key]}</td>)}</tr>)}</tbody></table></div></details>
);

export const DashboardOverview = ({ booking, onNavigate, canOpenBookings, canOpenCustomers }: { booking?: unknown; onNavigate: (to: string) => void; canOpenBookings: boolean; canOpenCustomers: boolean }) => {
  const data = booking && typeof booking === "object" ? booking as BookingDashboard : undefined;
  const k = data?.kpis;
  const economics = data?.economicKpis;
  const contracts = data?.contractKpis;
  const trend = data?.charts?.trend?.map(row => ({ ...row, day: dayLabel(row.day) })) ?? [];
  const utilization = data?.charts?.utilization?.map(row => ({ ...row, day: dayLabel(row.day) })) ?? [];
  const critical = data?.lists?.criticalBookings;
  const pending = (rows: BookingItem[] | undefined, returning: boolean) => rows?.filter(row => !["CLOSED", "CANCELED", "NO_SHOW", ...(returning ? [] : ["IN_RENT"])].includes(row.status ?? ""));
  const nextPickups = pending(data?.lists?.nextPickups, false), nextReturns = pending(data?.lists?.nextReturns, true);
  const axes = { fill: "currentColor", fontSize: 12 };
  const tooltip = { background: "var(--ws-soft-surface, hsl(var(--card)))", color: "hsl(var(--foreground))", border: "1px solid var(--ws-line)", borderRadius: 10 };
  return <div className="dashboard-overview">
    {!data ? <div role="status" className="dashboard-notice">Gli indicatori di noleggio non sono disponibili in questa risposta. Le altre sezioni restano consultabili.</div> : null}
    <WorkspaceMetricStrip items={[
      { label: "Disponibili oggi", value: dashboardNumber(k?.availableToday), hint: `Su ${dashboardNumber(k?.totalRentalVehicles)} veicoli · stima sulle prenotazioni`, icon: Car },
      { label: "Uscite oggi", value: dashboardNumber(k?.pickupsToday), hint: "Da preparare e consegnare", icon: ArrowUpRight },
      { label: "Rientri oggi", value: dashboardNumber(k?.returnsToday), hint: `Rientri scaduti: ${dashboardNumber(k?.overdueReturns)}`, icon: ArrowDownLeft },
      { label: "Prenotazioni aperte", value: dashboardNumber(k?.activeBookings), hint: `${dashboardNumber(k?.occupiedToday)} prenotazioni nella giornata`, icon: CalendarDays }
    ]} />
    <div className="dashboard-daily-grid">
      <Panel title="Prossime attività" subtitle="Uscite e rientri programmati. Apri una riga per lavorare sulla prenotazione." icon={<CalendarDays aria-hidden="true" />} action={canOpenBookings ? <Button variant="ghost" onClick={() => onNavigate("/booking")}>Calendario <ChevronRight aria-hidden="true" className="h-4 w-4" /></Button> : undefined}>
        <div className="dashboard-agenda">
          {([['Prossime uscite', nextPickups, false], ['Prossimi rientri', nextReturns, true]] as const).map(([title, rows, returnRow]) => <section key={title} aria-label={title}><h3>{title}<span>{rows?.length ?? "—"}</span></h3>{rows?.length ? <ul>{rows.map(item => <BookingRow key={item.id} item={item} returnRow={returnRow} navigate={onNavigate} enabled={canOpenBookings} />)}</ul> : <Empty missing={!rows}>Nessuna attività programmata in questa sezione.</Empty>}</section>)}
        </div>
      </Panel>
      <Panel title="Da presidiare" subtitle="Criticità segnalate per le prenotazioni." icon={<CircleAlert aria-hidden="true" />} className="dashboard-priorities">
        {critical?.length ? <ul className="dashboard-priority-list">{critical.map(item => <BookingRow key={`${item.bookingId}-${item.type}`} item={item} critical navigate={onNavigate} enabled={canOpenBookings} />)}</ul> : <Empty missing={!critical}>Nessuna criticità segnalata.</Empty>}
        {!canOpenBookings ? <p className="dashboard-permission-note">Il tuo ruolo può consultare il riepilogo; l’accesso alle prenotazioni richiede il relativo permesso.</p> : null}
      </Panel>
    </div>
    <div className="dashboard-analysis-grid">
      <Panel title="Andamento prenotazioni" subtitle="Ultimi 30 giorni · prenotazioni create, uscite e rientri.">
        {trend.length ? <><WorkspaceChartFrame data={trend} label="Grafico delle prenotazioni create, delle uscite e dei rientri. Gli stessi valori sono nella tabella sottostante."><ResponsiveContainer width="100%" height="100%"><LineChart data={trend}><CartesianGrid stroke="var(--ws-line)" vertical={false} /><XAxis dataKey="day" tick={axes} minTickGap={24} tickLine={false} axisLine={false}/><YAxis tick={axes} allowDecimals={false} tickLine={false} axisLine={false}/><Tooltip contentStyle={tooltip} isAnimationActive={false}/><Legend/><Line dataKey="created" name="Create" stroke="var(--dashboard-blue)" strokeWidth={2.5} dot={false} isAnimationActive={false}/><Line dataKey="pickups" name="Uscite" stroke="var(--dashboard-teal)" strokeDasharray="6 4" strokeWidth={2} dot={false} isAnimationActive={false}/><Line dataKey="returns" name="Rientri" stroke="var(--dashboard-amber)" strokeDasharray="2 3" strokeWidth={2} dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></WorkspaceChartFrame><ChartTable rows={trend} columns={[{key:'day',title:'Giorno'},{key:'created',title:'Create'},{key:'pickups',title:'Uscite'},{key:'returns',title:'Rientri'}]}/></> : <Empty missing={!data?.charts?.trend}>Nessun dato di andamento disponibile.</Empty>}
      </Panel>
      <Panel title="Economia del noleggio" subtitle="Mese corrente · ricavi previsti e consuntivi.">
        <dl className="dashboard-economics"><div><dt>Totale previsto</dt><dd>{dashboardNumber(economics?.expectedRevenueMonth,true)}</dd></div><div><dt>Totale consuntivo</dt><dd>{dashboardNumber(economics?.finalRevenueMonth,true)}</dd></div></dl>
        <dl className="dashboard-small-facts">{[['Ticket medio',economics?.averageTicket,true],['Per veicolo',economics?.revenuePerVehicle,true],['Per giorno di noleggio',economics?.revenuePerRentalDay,true],['Km extra reali',economics?.extraKmActual,false]].map(([label,value,money])=><div key={String(label)}><dt>{String(label)}</dt><dd>{dashboardNumber(value as Amount|undefined,Boolean(money))}</dd></div>)}</dl>
      </Panel>
    </div>
    <Panel title="Contratti da seguire" subtitle="Stato attuale dei contratti · invii di oggi evidenziati." icon={<FileText aria-hidden="true" />} action={canOpenBookings ? <Button variant="ghost" onClick={()=>onNavigate('/booking/contratti')}>Apri contratti <ChevronRight aria-hidden="true" className="h-4 w-4"/></Button> : undefined}>
      <dl className="dashboard-contract-metrics">{([['Da generare','toGenerate'],['Da inviare','toSend'],['Inviati oggi','sentToday'],['Firmati','signed'],['Errori','errors'],['Senza firma','unsigned']] as const).map(([label,key])=><div key={key}><dt>{label}</dt><dd>{dashboardNumber(contracts?.[key])}</dd></div>)}</dl>
      <div className="dashboard-contract-distribution">{data?.charts?.contractStatusDistribution?.map(row=><span key={row.status}>{statusLabels[row.status]??row.status}<b>{dashboardNumber(row.count)}</b></span>)}</div>
    </Panel>
    <div className="dashboard-analysis-grid">
      <Panel title="Occupazione della flotta" subtitle="Ultimi 30 giorni · rapporto tra prenotazioni nella giornata e veicoli di noleggio." icon={<Gauge aria-hidden="true" />}>
        <p className="dashboard-permission-note">Rapporto di oggi: <strong>{dashboardNumber(k?.utilizationRateToday)}{dashboardNumber(k?.utilizationRateToday) === "—" ? "" : "%"}</strong></p>
        {utilization.length ? <><WorkspaceChartFrame data={utilization} label="Rapporto giornaliero tra prenotazioni e flotta. Valori consultabili nella tabella sottostante."><ResponsiveContainer width="100%" height="100%"><AreaChart data={utilization}><CartesianGrid stroke="var(--ws-line)" vertical={false}/><XAxis dataKey="day" tick={axes} minTickGap={24}/><YAxis tick={axes} unit="%"/><Tooltip contentStyle={tooltip} isAnimationActive={false}/><Area dataKey="utilization" name="Rapporto %" stroke="var(--dashboard-blue)" fill="var(--dashboard-fill)" strokeWidth={2} isAnimationActive={false}/></AreaChart></ResponsiveContainer></WorkspaceChartFrame><ChartTable rows={utilization} columns={[{key:'day',title:'Giorno'},{key:'utilization',title:'Rapporto %'},{key:'occupied',title:'Prenotazioni'}]}/></> : <Empty missing={!data?.charts?.utilization}>Nessun dato di occupazione disponibile.</Empty>}
      </Panel>
      <Panel title="Ripartizione della flotta" subtitle="Oggi · stima sulle prenotazioni."><FleetCompositionChart kpis={k} /></Panel>
    </div>
      <Panel title="Veicoli più prenotati" subtitle="Mese corrente · ordinamento per giorni di noleggio.">
        {data?.charts?.topVehicles?.length ? <ol className="dashboard-vehicle-ranking">{data.charts.topVehicles.map((item,i)=><li key={item.plate}><span className="dashboard-rank">{i+1}</span><div><strong translate="no">{item.plate}</strong><span translate="no">{item.model}</span></div><div><strong>{dashboardNumber(item.occupiedDays)} gg</strong><span>{dashboardNumber(item.revenue,true)}</span></div></li>)}</ol> : <Empty missing={!data?.charts?.topVehicles}>Nessun veicolo nel periodo.</Empty>}
      </Panel>
    <nav className="dashboard-shortcuts" aria-label="Altre attività">{canOpenBookings ? <><Button variant="outline" onClick={()=>onNavigate('/booking')}>Pianifica un noleggio</Button><Button variant="outline" onClick={()=>onNavigate('/booking/listini')}>Listini</Button></> : null}{canOpenCustomers ? <Button variant="outline" onClick={()=>onNavigate('/anagrafiche/clienti')}>Clienti</Button> : null}{canOpenBookings ? <><Button variant="outline" onClick={()=>onNavigate('/anagrafiche/scadenziario')}>Scadenziario</Button><Button variant="outline" onClick={()=>onNavigate('/anagrafiche/manutenzioni')}>Manutenzioni</Button></> : null}</nav>
  </div>;
};
