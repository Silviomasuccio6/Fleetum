import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Download, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useLocation } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { statsUseCases } from "../../../application/usecases/stats-usecases";
import { stoppageStatusLabel } from "../../../domain/constants/stoppage-status";

import {WorkspacePageHeader} from '../../components/ui/workspace-ui';
import {CommerceDrawer,CommerceField,CommerceNotice} from '../../components/ui/commerce-workspace';
import {validateReportPeriod,reportDelta,saveReportBlob} from './stats-presentation';
import type {PanelMotionHandle} from '../../components/ui/panel-motion';
function ReportSection({title,description,actions,children}:{title:string;description?:string;actions?:ReactNode;children:ReactNode}){return <section className="commerce-panel report-section"><header className="commerce-panel-header"><div><h2>{title}</h2>{description?<p>{description}</p>:null}</div>{actions}</header><div className="report-section-body">{children}</div></section>}
function ChartData({rows,columns}:{rows:any[];columns:{key:string;label:string}[]}){return <details className="report-data"><summary>Mostra dati del grafico</summary><div className="report-table-scroll" tabIndex={0} role="region" aria-label="Dati del grafico"><table><caption className="sr-only">Dati del grafico</caption><thead><tr>{columns.map(c=><th scope="col" key={c.key}>{c.label}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{columns.map(c=><td key={c.key}>{row[c.key]}</td>)}</tr>)}</tbody></table></div></details>}

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { useAsync } from "../../hooks/use-async";
import { useEntitlements } from "../../hooks/use-entitlements";
import { useAuthStore } from "../../../application/stores/auth-store";

const priorityLabel: Record<string, string> = {
  LOW: "Bassa",
  MEDIUM: "Media",
  HIGH: "Alta",
  CRITICAL: "Critica"
};

const statusAccent: Record<string, string> = {
  OPEN: "destructive",
  IN_PROGRESS: "warning",
  WAITING_PARTS: "warning",
  SOLICITED: "secondary",
  CLOSED: "success",
  CANCELED: "secondary"
};

type PeriodPreset = "7d" | "15d" | "30d" | "90d" | "month" | "quarter" | "custom";
type DetailSort = "openDays_desc" | "openDays_asc" | "plate_asc";

type FilterState = {
  dateFrom: string;
  dateTo: string;
  siteId: string;
  workshopId: string;
  status: string;
  plate: string;
  brand: string;
  model: string;
};

const toInputDate = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const startOfQuarter = (date: Date) => {
  const month = date.getMonth();
  const quarterStartMonth = Math.floor(month / 3) * 3;
  return new Date(date.getFullYear(), quarterStartMonth, 1);
};

const toIsoStart = (dateInput: string) => new Date(`${dateInput}T00:00:00`).toISOString();
const toIsoEnd = (dateInput: string) => new Date(`${dateInput}T23:59:59`).toISOString();

const toPercent = reportDelta;

const formatDelta = (value: number | null) => {
  if (value == null || Number.isNaN(value)) return "n/d";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value || 0);

const formatNumber = (value: number) => new Intl.NumberFormat("it-IT").format(value || 0);

const defaultFilters = (): FilterState => {
  const today = new Date();
  const last90 = new Date(today.getTime() - 89 * 86400000);
  return {
    dateFrom: toInputDate(last90),
    dateTo: toInputDate(today),
    siteId: "",
    workshopId: "",
    status: "",
    plate: "",
    brand: "",
    model: ""
  };
};

const buildExportFilenameDate = () => new Date().toISOString().slice(0, 10);

export const StatsPage = () => {
  const location = useLocation();
  const { can } = useEntitlements();
  const user=useAuthStore(state=>state.user);
  const identity=`${user?.tenantId}:${user?.id}`;
  const has=(permission:string)=>Boolean(user?.permissions?.some(p=>p==='*'||p===permission));
  const canRead=has('stats:read'),canReadSites=has('sites:read'),canReadWorkshops=has('workshops:read'),canReadVehicles=has('vehicles:read');
  const canViewVehicleEconomics=has('vehicle:economics:read')&&canReadVehicles;
  const canExportReports=has('reports:export');
  const canReportsAdvanced=can('reports_advanced');
  const canAdvancedFilters=can('advanced_filters');
  const canExportCsv=can('export_csv');
  const canView=canRead&&canReportsAdvanced;
  const canDownload=canView&&canExportReports&&canExportCsv;
  const [filterErrors,setFilterErrors]=useState<Record<string,string>>({});
  const [exportError,setExportError]=useState(''),[exportSuccess,setExportSuccess]=useState(''),[exportBusy,setExportBusy]=useState(false);
  const exportLock=useRef(false),filterOrigin=useRef<HTMLElement|null>(null),filterMotion=useRef<PanelMotionHandle|null>(null),filterSummary=useRef<HTMLDivElement>(null);
  const identityRef=useRef(identity);identityRef.current=identity;
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("90d");
  const [draftFilters, setDraftFilters] = useState<FilterState>(() => defaultFilters());
  const [filters, setFilters] = useState<FilterState>(() => defaultFilters());
  const [detailQuery, setDetailQuery] = useState("");
  const [detailSort, setDetailSort] = useState<DetailSort>("openDays_desc");
  const [refreshKey, setRefreshKey] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reminderDetailsOpen, setReminderDetailsOpen] = useState(false);

  const emptyAnalytics = useMemo(
    () => ({
      kpis: {
        totalStoppages: 0,
        openStoppages: 0,
        closedStoppages: 0,
        criticalOpen: 0,
        overdueOpen: 0,
        newStoppagesLast30: 0,
        closedLast30: 0,
        averageClosureDays: 0,
        closureRateWithin7Days: 0,
        remindersTotal: 0,
        reminderSuccessRate: 0,
        estimatedOpenCost: 0
      },
      charts: {
        trendStoppages: [],
        byStatus: [],
        byPriority: [],
        byWorkshop: [],
        bySite: []
      },
      tables: {
        longestOpen: [],
        topVehiclesDowntime: [],
        reminderFailures: []
      }
    }),
    []
  );

  const masterData = useAsync(async()=>{
    const permissions=[canReadSites,canReadWorkshops,canReadVehicles];
    const methods=[masterDataUseCases.listSites,masterDataUseCases.listWorkshops,masterDataUseCases.listVehicles];
    const results=await Promise.allSettled(methods.map(async(method,index)=>{
      if(!canView||!permissions[index])return {data:[],total:0};
      const rows:any[]=[];let total=0;
      for(let page=1;page<=500;page++){
       if(identityRef.current!==identity)return {data:[],total:0};
       const response=await method({page,pageSize:200});rows.push(...response.data);total=response.total??rows.length;
       if(response.data.length===0||rows.length>=total)break;
      }
      return {data:rows,total};
    }));
    return {identity,results};
  },[identity,canView,canReadSites,canReadWorkshops,canReadVehicles,refreshKey]);

  const analyticsParams = useMemo(
    () => ({
      dateFrom: toIsoStart(filters.dateFrom),
      dateTo: toIsoEnd(filters.dateTo),
      siteId: filters.siteId || undefined,
      workshopId: filters.workshopId || undefined,
      status: filters.status || undefined,
      plate: filters.plate || undefined,
      brand: filters.brand || undefined,
      model: filters.model || undefined
    }),
    [filters]
  );

  const previousPeriod = useMemo(() => {
    const start = new Date(`${filters.dateFrom}T00:00:00`);
    const end = new Date(`${filters.dateTo}T23:59:59`);
    const spanMs = Math.max(1, end.getTime() - start.getTime() + 1);
    const previousEnd = new Date(start.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - spanMs + 1);

    return {
      dateFrom: previousStart.toISOString(),
      dateTo: previousEnd.toISOString()
    };
  }, [filters.dateFrom, filters.dateTo]);

  const previousParams = useMemo(
    () => ({
      dateFrom: previousPeriod.dateFrom,
      dateTo: previousPeriod.dateTo,
      siteId: filters.siteId || undefined,
      workshopId: filters.workshopId || undefined,
      status: filters.status || undefined,
      plate: filters.plate || undefined,
      brand: filters.brand || undefined,
      model: filters.model || undefined
    }),
    [previousPeriod, filters.siteId, filters.workshopId, filters.status, filters.plate, filters.brand, filters.model]
  );

  const analyticsKey=JSON.stringify([identity,analyticsParams,refreshKey]);
  const previousKey=JSON.stringify([identity,previousParams,refreshKey]);
  const stats=useAsync(async()=>({key:analyticsKey,value:canView?await statsUseCases.analytics(analyticsParams):emptyAnalytics}),[analyticsKey,canView]);
  const previousStats=useAsync(async()=>({key:previousKey,value:canView?await statsUseCases.analytics(previousParams):emptyAnalytics}),[previousKey,canView]);
  const metadata=masterData.data?.identity===identity?masterData.data.results:[];
  const options=(index:number)=>{const result=metadata[index];return result?.status==='fulfilled'?result.value.data:[]};
  const sites=options(0),workshops=options(1),vehicles=options(2);
  const metadataIncomplete=metadata.some(x=>x.status==='rejected'||(x.status==='fulfilled'&&x.value.total>x.value.data.length));
  const statsReady=!stats.loading&&!stats.error&&stats.data?.key===analyticsKey;
  const previousReady=!previousStats.loading&&!previousStats.error&&previousStats.data?.key===previousKey;
  const data=statsReady?stats.data!.value:emptyAnalytics;
  const prev=previousReady?previousStats.data!.value:emptyAnalytics;
  const [profitVehicleId,setProfitVehicleId]=useState(()=>new URLSearchParams(location.search).get('vehicleId')??'');
  useEffect(()=>{setProfitVehicleId(new URLSearchParams(location.search).get('vehicleId')??'')},[location.search]);
  useEffect(()=>{setExportError('');setExportSuccess('');setFiltersOpen(false)},[identity]);

  const profitabilityParams = useMemo(
    () => ({
      from: toIsoStart(filters.dateFrom),
      to: toIsoEnd(filters.dateTo),
      vehicleId: profitVehicleId || undefined,
      siteId: filters.siteId || undefined,
      includeVat: true,
      includeCosts: true
    }),
    [filters.dateFrom, filters.dateTo, filters.siteId, profitVehicleId]
  );

  const profitabilityKey=JSON.stringify([identity,profitabilityParams,refreshKey]);
  const profitability=useAsync(async()=>({key:profitabilityKey,value:canView&&canViewVehicleEconomics?await statsUseCases.vehicleProfitability(profitabilityParams):null}),[profitabilityKey,canView,canViewVehicleEconomics]);
  const profitReady=!profitability.loading&&!profitability.error&&profitability.data?.key===profitabilityKey;
  const profit=profitReady?profitability.data!.value:null;
  const trendData = useMemo(
    () =>
      (data.charts.trendStoppages ?? []).map((row: any) => ({
        opened: Number(row.opened ?? 0),
        closed: Number(row.closed ?? 0),
        reminders: Number(row.reminders ?? 0),
        day: row.day?.slice(5) ?? row.day
      })),
    [data]
  );

  const priorityData = useMemo(
    () =>
      (data.charts.byPriority ?? []).map((row: any) => ({
        count: Number(row.count ?? 0),
        priorityLabel: priorityLabel[row.priority] ?? row.priority
      })),
    [data]
  );

  const workshopData = useMemo(() => {
    const primary = (data.charts.byWorkshop ?? [])
      .map((row: any) => ({ name: String(row.name ?? "Officina"), count: Number(row.count ?? 0) }))
      .filter((row: any) => row.count > 0)
      .slice(0, 8);
    if (primary.length > 0) return primary;

    const fallbackMap = new Map<string, number>();
    for (const row of data.tables.longestOpen ?? []) {
      const key = String(row.workshop ?? "Officina n/d");
      fallbackMap.set(key, (fallbackMap.get(key) ?? 0) + 1);
    }
    return Array.from(fallbackMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [data]);

  const hasTrendData = useMemo(
    () => trendData.length > 0 && trendData.some((row: any) => row.opened > 0 || row.closed > 0 || row.reminders > 0),
    [trendData]
  );
  const siteData = useMemo(() => (data.charts.bySite ?? []).slice(0, 6), [data]);
  const topVehicles = useMemo(() => (data.tables.topVehiclesDowntime ?? []).slice(0, 4), [data]);
  const reminderFailures = useMemo(() => (data.tables.reminderFailures ?? []).slice(0, 6), [data]);

  const filteredLongestOpen = useMemo(() => {
    const query = detailQuery.trim().toLowerCase();
    const rows = (data.tables.longestOpen ?? []).filter((row: any) => {
      if (!query) return true;
      return (
        row.plate?.toLowerCase().includes(query) ||
        row.brand?.toLowerCase().includes(query) ||
        row.model?.toLowerCase().includes(query) ||
        row.site?.toLowerCase().includes(query) ||
        row.workshop?.toLowerCase().includes(query)
      );
    });

    const sorted = [...rows];
    if (detailSort === "openDays_desc") sorted.sort((a: any, b: any) => (b.openDays ?? 0) - (a.openDays ?? 0));
    if (detailSort === "openDays_asc") sorted.sort((a: any, b: any) => (a.openDays ?? 0) - (b.openDays ?? 0));
    if (detailSort === "plate_asc") sorted.sort((a: any, b: any) => String(a.plate ?? "").localeCompare(String(b.plate ?? ""), "it"));
    return sorted;
  }, [data, detailQuery, detailSort]);

  const applyPeriodPreset = (preset: PeriodPreset) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let from = new Date(today);

    switch (preset) {
      case "7d":
        from.setDate(today.getDate() - 6);
        break;
      case "15d":
        from.setDate(today.getDate() - 14);
        break;
      case "30d":
        from.setDate(today.getDate() - 29);
        break;
      case "90d":
        from.setDate(today.getDate() - 89);
        break;
      case "month":
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case "quarter":
        from = startOfQuarter(today);
        break;
      case "custom":
      default:
        setPeriodPreset("custom");
        return;
    }

    setPeriodPreset(preset);
    setDraftFilters((old) => ({ ...old, dateFrom: toInputDate(from), dateTo: toInputDate(today) }));
  };

  const resetFilters = () => {
    const fresh = defaultFilters();
    setPeriodPreset("90d");
    setDraftFilters(fresh);
    setFilters(fresh);
  };

  const closeFilters=()=>{const done=()=>setFiltersOpen(false);filterMotion.current?filterMotion.current.dismiss(done):done()};
  const applyFilters=()=>{
   const errors=validateReportPeriod(draftFilters.dateFrom,draftFilters.dateTo);setFilterErrors(errors);
   if(Object.keys(errors).length){window.setTimeout(()=>filterSummary.current?.focus(),0);return}
   setFilters({...draftFilters,plate:canAdvancedFilters?draftFilters.plate:'',brand:canAdvancedFilters?draftFilters.brand:'',model:canAdvancedFilters?draftFilters.model:''});closeFilters();
  };
  const download=async(factory:()=>Promise<Blob>,filename:string,allowed:boolean)=>{
   if(!allowed||exportLock.current)return;exportLock.current=true;setExportBusy(true);setExportError('');setExportSuccess('');const context=identity;
   try{const blob=await factory();if(context!==identityRef.current)return;saveReportBlob(blob,filename);setExportSuccess('Download avviato.')}
   catch(e){if(context===identityRef.current)setExportError((e as Error).message)}finally{exportLock.current=false;setExportBusy(false)}
  };
  const downloadXlsx=()=>download(()=>statsUseCases.downloadAnalyticsXlsx(analyticsParams),`gestione-fermi-report-enterprise-${buildExportFilenameDate()}.xlsx`,canDownload);
  const downloadCsv=()=>download(()=>statsUseCases.downloadAnalyticsCsv(analyticsParams),`gestione-fermi-report-analytics-${buildExportFilenameDate()}.csv`,canDownload);
  const downloadVehicleProfitability=(format:'pdf'|'xlsx'|'csv')=>download(()=>statsUseCases.downloadVehicleProfitability(format,profitabilityParams),`fleetum-report-redditivita-veicolo-${buildExportFilenameDate()}.${format}`,canDownload&&canViewVehicleEconomics);

  const kpis = [
    {
      label: "Fermi aperti",
      value: formatNumber(data.kpis.openStoppages),
      delta: toPercent(data.kpis.openStoppages, prev.kpis.openStoppages),
      inverse: true
    },
    {
      label: "Tempo medio fermo",
      value: `${formatNumber(data.kpis.averageClosureDays)} gg`,
      delta: toPercent(data.kpis.averageClosureDays, prev.kpis.averageClosureDays),
      inverse: true
    },
    {
      label: "Costo aperti stimato",
      value: formatCurrency(data.kpis.estimatedOpenCost),
      delta: toPercent(data.kpis.estimatedOpenCost, prev.kpis.estimatedOpenCost),
      inverse: true
    },
    {
      label: "SLA entro 7gg",
      value: `${formatNumber(data.kpis.closureRateWithin7Days)}%`,
      delta: toPercent(data.kpis.closureRateWithin7Days, prev.kpis.closureRateWithin7Days),
      inverse: false
    },
    {
      label: "Veicoli critici",
      value: formatNumber(data.kpis.criticalOpen),
      delta: toPercent(data.kpis.criticalOpen, prev.kpis.criticalOpen),
      inverse: true
    },
    {
      label: "Reminder successo",
      value: `${formatNumber(data.kpis.reminderSuccessRate)}%`,
      delta: toPercent(data.kpis.reminderSuccessRate, prev.kpis.reminderSuccessRate),
      inverse: false
    }
  ];

  const filterActive=Object.entries(filters).filter(([key,value])=>!['dateFrom','dateTo'].includes(key)&&value);
  const dateLabel=(value:string)=>new Date(value).toLocaleDateString('it-IT');
  const chartColors={primary:'var(--report-blue)',secondary:'var(--report-green)',accent:'var(--report-amber)',violet:'var(--report-violet)'};
  const chartGrid=<CartesianGrid stroke="var(--ws-line)" strokeDasharray="3 3" vertical={false}/>;
  const chartTooltip=<Tooltip cursor={false} isAnimationActive={false} contentStyle={{background:'hsl(var(--card))',color:'hsl(var(--foreground))',border:'1px solid var(--ws-line)',borderRadius:8}}/>;
  const exportButtons=(economic=false)=><div className="report-export" aria-label={economic?'Esporta redditività':'Esporta statistiche'}>{(economic?['pdf','xlsx','csv']:['xlsx','csv']).map(format=><Button key={format} variant="outline" disabled={!canDownload||(economic&&!canViewVehicleEconomics)||exportBusy} aria-busy={exportBusy} onClick={()=>void(economic?downloadVehicleProfitability(format as 'pdf'|'xlsx'|'csv'):format==='xlsx'?downloadXlsx():downloadCsv())}><Download aria-hidden="true" className="h-4 w-4"/>{format==='xlsx'?'Excel':format.toUpperCase()}</Button>)}</div>;
  return <section className="reports-workspace commerce-workspace">
   <WorkspacePageHeader eyebrow="CONTROLLO E ANALISI" title="Statistiche e report" description="Leggi l’operatività della flotta e valuta la redditività nello stesso periodo." actions={canView?<><Button variant="outline" disabled={stats.loading||profitability.loading} onClick={()=>setRefreshKey(x=>x+1)}><RefreshCw className="h-4 w-4" aria-hidden="true"/>Aggiorna</Button><Button onClick={e=>{filterOrigin.current=e.currentTarget;setDraftFilters({...filters});setFilterErrors({});setFiltersOpen(true)}}><SlidersHorizontal className="h-4 w-4" aria-hidden="true"/>Periodo e filtri</Button></>:null}/>
   {!canRead?<CommerceNotice>Il tuo ruolo non consente l’accesso alle statistiche.</CommerceNotice>:!canReportsAdvanced?<div className="commerce-panel directory-state"><h2>Report avanzati non inclusi</h2><p>Il piano attuale non include questa analisi.</p></div>:<>
    <div className="report-period"><div><span>Periodo applicato</span><strong>{dateLabel(analyticsParams.dateFrom)} — {dateLabel(analyticsParams.dateTo)}</strong><small>Confronto: {dateLabel(previousPeriod.dateFrom)} — {dateLabel(previousPeriod.dateTo)}</small></div><div className="report-applied-filters">{filterActive.length?filterActive.map(([key,value])=><span key={key}>{key==='siteId'?sites.find((x:any)=>x.id===value)?.name||'Sede selezionata':key==='workshopId'?workshops.find((x:any)=>x.id===value)?.name||'Officina selezionata':key==='status'?stoppageStatusLabel[value]??value:value}</span>):<span>Tutte le sedi e le officine</span>}</div></div>
    {metadataIncomplete?<p className="report-note" role="status">Alcuni filtri anagrafici non sono disponibili. Aggiorna per riprovare; i report restano consultabili.</p>:null}
    {exportError?<CommerceNotice>{exportError}</CommerceNotice>:null}{exportSuccess?<CommerceNotice tone="success">{exportSuccess}</CommerceNotice>:null}
    <div className="report-section-heading"><div><h2>Operatività della flotta</h2><p>Fermi, tempi e comunicazioni nel periodo applicato.</p></div>{exportButtons()}</div>
    {!canDownload?<p className="report-note">L’export richiede il permesso report e un piano con esportazione.</p>:null}
    {stats.error?<CommerceNotice>{stats.error}</CommerceNotice>:null}
    {!statsReady?<div className="commerce-panel directory-state" role="status">{stats.error?'Dati operativi non disponibili. Premi Aggiorna per riprovare.':'Caricamento statistiche…'}</div>:<>
     <dl className="report-metrics">{kpis.map(kpi=>{const delta=previousReady?kpi.delta:null;const good=delta!=null&&delta!==0&&(kpi.inverse?delta<0:delta>0);const Icon=delta!=null&&delta<0?ArrowDownRight:ArrowUpRight;return <div key={kpi.label}><dt>{kpi.label}</dt><dd className="report-metric-value">{kpi.value}</dd><dd className="report-delta" data-tone={delta==null||delta===0?'neutral':good?'good':'bad'}>{delta!=null&&delta!==0?<Icon aria-hidden="true"/>:null}{delta==null?'Confronto non disponibile':formatDelta(delta)+' vs periodo precedente'}</dd></div>})}</dl>
     <details className="report-explanation"><summary>Come leggere gli indicatori</summary><p>Tempi in giorni, importi in euro. Il costo dei fermi aperti è una stima. SLA indica la quota di chiusure entro 7 giorni; il successo reminder riguarda gli invii registrati. Le variazioni confrontano il periodo precedente di uguale durata, con gli stessi filtri. Se la base precedente è zero, la variazione percentuale non è stimabile.</p></details>
     <ReportSection title="Andamento giornaliero" description="Numero di aperture, chiusure e reminder registrati ogni giorno.">
      <div className="report-chart">{trendData.length?<ResponsiveContainer width="100%" height="100%"><ComposedChart data={trendData} accessibilityLayer>{chartGrid}<XAxis dataKey="day"/><YAxis allowDecimals={false}/>{chartTooltip}<Legend/><Bar dataKey="opened" fill={chartColors.primary} name="Aperti" isAnimationActive={false} radius={[3,3,0,0]}/><Bar dataKey="closed" fill={chartColors.secondary} name="Chiusi" isAnimationActive={false} radius={[3,3,0,0]}/><Line dataKey="reminders" stroke={chartColors.accent} name="Reminder" isAnimationActive={false} dot={false} strokeWidth={2}/></ComposedChart></ResponsiveContainer>:<p>Nessun dato trend nel periodo selezionato.</p>}</div>
      {!hasTrendData?<p className="report-note">Nel periodo selezionato i valori sono tutti a zero. Puoi allargare il periodo o rimuovere i filtri.</p>:null}
      <ChartData rows={trendData} columns={[{key:'day',label:'Giorno'},{key:'opened',label:'Aperti'},{key:'closed',label:'Chiusi'},{key:'reminders',label:'Reminder'}]}/>
     </ReportSection>
     <div className="report-two-columns">
      <ReportSection title="Officine per numero di fermi" description={(data.charts.byWorkshop??[]).length?'Prime 8 officine nel periodo.':'Distribuzione ricavata dai soli fermi aperti mostrati nel dettaglio.'}>
       <div className="report-chart report-chart-small">{workshopData.length?<ResponsiveContainer width="100%" height="100%"><BarChart data={workshopData} accessibilityLayer>{chartGrid}<XAxis dataKey="name" hide/><YAxis allowDecimals={false}/>{chartTooltip}<Bar dataKey="count" name="Fermi" fill={chartColors.primary} isAnimationActive={false} radius={[3,3,0,0]}/></BarChart></ResponsiveContainer>:<p>Nessun dato officine.</p>}</div><ChartData rows={workshopData} columns={[{key:'name',label:'Officina'},{key:'count',label:'Fermi'}]}/>
      </ReportSection>
      <ReportSection title="Distribuzione priorità" description="Numero di fermi per livello di priorità."><div className="report-chart report-chart-small">{priorityData.length?<ResponsiveContainer width="100%" height="100%"><BarChart data={priorityData} accessibilityLayer>{chartGrid}<XAxis dataKey="priorityLabel"/><YAxis allowDecimals={false}/>{chartTooltip}<Bar dataKey="count" name="Fermi" fill={chartColors.violet} isAnimationActive={false} radius={[3,3,0,0]}/></BarChart></ResponsiveContainer>:<p>Nessun dato priorità.</p>}</div><ChartData rows={priorityData} columns={[{key:'priorityLabel',label:'Priorità'},{key:'count',label:'Fermi'}]}/></ReportSection>
     </div>
     <ReportSection title="Dettaglio fermi aperti" description="Ricerca e ordinamento agiscono soltanto su questa tabella, senza cambiare totali ed export.">
      <div className="report-detail-filters"><CommerceField id="report-detail-query" label="Cerca nel dettaglio"><Input value={detailQuery} onChange={e=>setDetailQuery(e.target.value)} placeholder="Targa, sede, officina…"/></CommerceField><CommerceField id="report-detail-sort" label="Ordina per"><Select value={detailSort} onChange={e=>setDetailSort(e.target.value as DetailSort)}><option value="openDays_desc">Giorni aperto: alto → basso</option><option value="openDays_asc">Giorni aperto: basso → alto</option><option value="plate_asc">Targa: A → Z</option></Select></CommerceField></div>
      <div className="report-table-scroll" tabIndex={0} role="region" aria-label="Tabella fermi aperti"><Table><caption className="sr-only">Fermi aperti nel periodo applicato</caption><TableHeader><TableRow>{['Veicolo','Sede','Officina','Stato','Priorità','Giorni aperto'].map(x=><TableHead scope="col" key={x}>{x}</TableHead>)}</TableRow></TableHeader><TableBody>{filteredLongestOpen.length?filteredLongestOpen.map((row:any)=><TableRow key={row.id}><TableCell><strong>{row.plate}</strong><small className="report-cell-secondary">{row.brand} {row.model}</small></TableCell><TableCell>{row.site}</TableCell><TableCell>{row.workshop}</TableCell><TableCell><Badge variant={(statusAccent[row.status] as any)||'secondary'}>{stoppageStatusLabel[row.status]??row.status}</Badge></TableCell><TableCell>{priorityLabel[row.priority]??row.priority}</TableCell><TableCell>{row.openDays}</TableCell></TableRow>):<TableRow><TableCell colSpan={6}>Nessun fermo aperto trovato con i criteri selezionati.</TableCell></TableRow>}</TableBody></Table></div>
     </ReportSection>
     <div className="report-three-columns"><ReportSection title="Veicoli per fermo cumulato" description="Primi 4 veicoli restituiti dal report."><ul className="report-ranking">{topVehicles.map((row:any)=><li key={row.plate}><span><strong>{row.plate}</strong><small>{row.brand} {row.model}</small></span><span>{row.openDays} gg<small>{row.count} fermi</small></span></li>)}</ul>{!topVehicles.length?<p>Nessun dato disponibile.</p>:null}</ReportSection>
      <ReportSection title="Distribuzione sedi" description="Prime 6 sedi restituite dal report."><ul className="report-ranking">{siteData.map((row:any)=><li key={row.name}><span>{row.name}</span><strong>{row.count}</strong></li>)}</ul>{!siteData.length?<p>Nessun dato sedi.</p>:null}</ReportSection>
      <ReportSection title="Reminder falliti" description="Ultimi 6 errori restituiti dal report."><Button variant="outline" aria-expanded={reminderDetailsOpen} aria-controls="report-reminders" onClick={()=>setReminderDetailsOpen(x=>!x)}>{reminderDetailsOpen?'Nascondi dettagli':'Mostra dettagli'}</Button>{reminderDetailsOpen?<div id="report-reminders" className="report-failures">{reminderFailures.length?reminderFailures.map((row:any)=><div key={row.id}><strong>{row.recipient}</strong><small>{row.type} · {new Date(row.sentAt).toLocaleString('it-IT')}</small><p>{row.errorMessage||'Errore non specificato'}</p></div>):<p>Nessun reminder fallito nel periodo filtrato.</p>}</div>:null}</ReportSection>
     </div>
    </>}
    <div className="report-section-heading"><div><h2>Redditività veicoli</h2><p>Fatturato, costi e recupero dell’investimento.</p></div>{exportButtons(true)}</div>
    {!canViewVehicleEconomics?<div className="commerce-panel directory-state"><p>I dati economici richiedono i permessi di lettura dei veicoli e delle loro informazioni economiche.</p></div>:<>
     <div className="report-economic-filters"><CommerceField id="report-profit-vehicle" label="Veicolo"><Select value={profitVehicleId} onChange={e=>setProfitVehicleId(e.target.value)}><option value="">Tutti i veicoli</option>{profitVehicleId&&!vehicles.some((v:any)=>v.id===profitVehicleId)?<option value={profitVehicleId}>Veicolo selezionato dal collegamento</option>:null}{vehicles.map((v:any)=><option translate="no" key={v.id} value={v.id}>{v.plate} · {v.brand} {v.model}</option>)}</Select></CommerceField><p className="report-note">Questo report usa periodo, sede e veicolo. Officina, stato, targa, marca e modello del report operativo non si applicano. Importi in EUR, IVA e costi inclusi.</p></div>
     {profitability.error?<CommerceNotice>{profitability.error}</CommerceNotice>:null}
     {!profit?<div className="commerce-panel directory-state" role="status">{profitability.error?'Report economico non disponibile. Premi Aggiorna per riprovare.':'Caricamento redditività…'}</div>:<>
      <dl className="report-metrics">{[['Fatturato generato',formatCurrency(profit.summary.totalRevenue)],['Giorni noleggiati',formatNumber(profit.summary.rentedDays)],['Occupazione',`${profit.summary.utilizationRate??0}%`],['Margine stimato',formatCurrency(profit.summary.grossMargin)],['Investimento recuperato',profit.investment.recoveredPercentage==null?'n/d':`${formatNumber(profit.investment.recoveredPercentage)}%`],['Residuo break-even',profit.investment.remainingToBreakEven==null?'n/d':formatCurrency(profit.investment.remainingToBreakEven)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd className="report-metric-value">{value}</dd></div>)}</dl>
      <ReportSection title="Ricavi, costi e margine" description="Andamento mensile in euro, dai dati restituiti dal report."><div className="report-chart">{profit.trend?.length?<ResponsiveContainer width="100%" height="100%"><ComposedChart data={profit.trend} accessibilityLayer>{chartGrid}<XAxis dataKey="month"/><YAxis/>{chartTooltip}<Legend/><Bar dataKey="revenue" name="Ricavi" fill={chartColors.primary} isAnimationActive={false} radius={[3,3,0,0]}/><Bar dataKey="costs" name="Costi" fill={chartColors.secondary} isAnimationActive={false} radius={[3,3,0,0]}/><Line dataKey="margin" name="Margine" stroke={chartColors.accent} strokeWidth={2} dot={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer>:<p>Nessun trend economico nel periodo selezionato.</p>}</div><ChartData rows={profit.trend??[]} columns={[{key:'month',label:'Mese'},{key:'revenue',label:'Ricavi · EUR'},{key:'costs',label:'Costi · EUR'},{key:'margin',label:'Margine · EUR'}]}/>
       <div className="report-investment"><h3>Qualità dei dati e investimento</h3><p>Base dati: booking, contratti e pricing snapshot. ROI e break-even sono indicativi e dipendono da prezzo di acquisto e costi configurati.</p><p>{profit.investment.purchasePrice!=null?`Investimento configurato: ${formatCurrency(profit.investment.purchasePrice)}.`:'Prezzo acquisto non configurato: inseriscilo nella scheda veicolo per calcolare ROI e break-even.'}</p><p>{profit.investment.breakEvenReached===true?'Break-even raggiunto sul periodo/dati disponibili.':profit.investment.remainingToBreakEven!=null?`Mancano ${formatCurrency(profit.investment.remainingToBreakEven)} al break-even.`:'Break-even non stimabile con i dati attuali.'}</p>{profit.dataQuality?.notes?.map((note:string,i:number)=><p key={i}>{note}</p>)}</div>
      </ReportSection>
      <ReportSection title="Dettaglio redditività" description="Primi 8 veicoli restituiti dal report. Gli export includono i dati dell’intero report filtrato."><div className="report-table-scroll" tabIndex={0} role="region" aria-label="Tabella redditività veicoli"><Table><caption className="sr-only">Redditività per veicolo</caption><TableHeader><TableRow>{['Veicolo','Sede','Ricavi · EUR','Costi · EUR','Margine · EUR','Giorni','ROI'].map(x=><TableHead scope="col" key={x}>{x}</TableHead>)}</TableRow></TableHeader><TableBody>{profit.vehicles?.length?profit.vehicles.slice(0,8).map((v:any)=><TableRow key={v.vehicleId}><TableCell><strong>{v.plate}</strong><small className="report-cell-secondary">{v.brand} {v.model}</small></TableCell><TableCell>{v.siteName??'—'}</TableCell><TableCell>{formatCurrency(v.revenue)}</TableCell><TableCell>{formatCurrency(v.costs)}</TableCell><TableCell>{formatCurrency(v.margin)}</TableCell><TableCell>{formatNumber(v.rentedDays)}</TableCell><TableCell>{v.recoveredPercentage==null?'n/d':`${v.recoveredPercentage}%`}</TableCell></TableRow>):<TableRow><TableCell colSpan={7}>Nessun veicolo nel periodo selezionato.</TableCell></TableRow>}</TableBody></Table></div></ReportSection>
     </>}
    </>}
   </>}
   {filtersOpen&&canView?<CommerceDrawer title="Periodo e filtri" description="I filtri vengono applicati solo alla conferma." origin={filterOrigin.current} motionRef={filterMotion} onClose={closeFilters} footer={<><Button variant="outline" onClick={()=>{resetFilters();setFilterErrors({});closeFilters()}}>Azzera filtri</Button><Button onClick={applyFilters}>Applica filtri</Button></>}>
    {Object.keys(filterErrors).length?<div ref={filterSummary} tabIndex={-1} role="alert" className="commerce-notice commerce-error"><p>Controlla il periodo selezionato.</p>{Object.entries(filterErrors).map(([key,value])=><p key={key}><a href={'#report-'+key} onClick={e=>{e.preventDefault();document.getElementById('report-'+key)?.focus()}}>{value}</a></p>)}</div>:null}
    <div className="commerce-form-group"><h3>Periodo di analisi</h3><CommerceField id="report-period" label="Periodo"><Select value={periodPreset} onChange={e=>applyPeriodPreset(e.target.value as PeriodPreset)}>{[['7d','Ultimi 7 giorni'],['15d','Ultimi 15 giorni'],['30d','Ultimi 30 giorni'],['90d','Ultimi 90 giorni'],['month','Mese corrente'],['quarter','Trimestre corrente'],['custom','Personalizzato']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></CommerceField><div className="commerce-field-grid">{(['dateFrom','dateTo'] as const).map(key=><CommerceField key={key} id={'report-'+key} label={key==='dateFrom'?'Dal':'Al'} error={filterErrors[key]}><Input type="date" value={draftFilters[key]} onChange={e=>{setPeriodPreset('custom');setDraftFilters(old=>({...old,[key]:e.target.value}))}}/></CommerceField>)}</div></div>
    <div className="commerce-form-group"><h3>Flotta e operatività</h3>{canReadSites?<CommerceField id="report-site" label="Sede"><Select value={draftFilters.siteId} onChange={e=>setDraftFilters(old=>({...old,siteId:e.target.value}))}><option value="">Tutte le sedi</option>{sites.map((x:any)=><option translate="no" key={x.id} value={x.id}>{x.name}</option>)}</Select></CommerceField>:null}{canReadWorkshops?<CommerceField id="report-workshop" label="Officina"><Select value={draftFilters.workshopId} onChange={e=>setDraftFilters(old=>({...old,workshopId:e.target.value}))}><option value="">Tutte le officine</option>{workshops.map((x:any)=><option translate="no" key={x.id} value={x.id}>{x.name}</option>)}</Select></CommerceField>:null}<CommerceField id="report-status" label="Stato"><Select value={draftFilters.status} onChange={e=>setDraftFilters(old=>({...old,status:e.target.value}))}><option value="">Tutti gli stati</option>{Object.entries(stoppageStatusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></CommerceField></div>
    {canAdvancedFilters?<div className="commerce-form-group"><h3>Ricerca veicolo</h3>{(['plate','brand','model'] as const).map(key=><CommerceField key={key} id={'report-'+key} label={key==='plate'?'Targa':key==='brand'?'Marca':'Modello'}><Input value={draftFilters[key]} onChange={e=>setDraftFilters(old=>({...old,[key]:e.target.value}))}/></CommerceField>)}</div>:<p className="report-note">I filtri avanzati non sono inclusi nel piano attuale.</p>}
   </CommerceDrawer>:null}
  </section>;
};
