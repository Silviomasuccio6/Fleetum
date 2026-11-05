import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarPlus, CalendarDays, Gauge, Wrench, Car, Clock } from "lucide-react";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { FleetumInlineLoader } from "../../components/brand/fleetum-logo-loader";
import { CardStat } from "../../components/common/table";
import { PageHeader } from "../../components/layout/page-header";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";

import {useOperationsAccess} from "../../components/operations/operations-workspace";

type DeadlineRow = {
  vehicleId: string;
  plate: string;
  brand: string;
  model: string;
  siteName: string;
  currentKm: number | null;
  maintenanceIntervalKm: number | null;
  remainingKm: number | null;
  lastRevisionAt: string | null;
  revisionDueAt: string | null;
  daysToRevision: number | null;
  dueByKm: boolean;
  dueSoonByKm: boolean;
  dueByRevision: boolean;
  dueSoonByRevision: boolean;
  status: "SCADUTA" | "IN_SCADENZA" | "OK";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  actions: string[];
};

type DeadlineResponse = {
  kpis: {
    total: number;
    dueNowKm: number;
    dueSoonKm: number;
    dueNowRevision: number;
    dueSoonRevision: number;
    critical: number;
  };
  data: DeadlineRow[];
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("it-IT");
};

const formatMonthYear = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
};

const formatKm = (value?: number | null) => (typeof value === "number" ? value.toLocaleString("it-IT") : "-");

const severityBadgeVariant = (severity: DeadlineRow["severity"]) => {
  if (severity === "CRITICAL" || severity === "HIGH") return "destructive";
  if (severity === "MEDIUM") return "warning";
  return "secondary";
};

import {Link} from "react-router-dom";
import {WorkspacePageHeader,WorkspaceMetricStrip} from "../../components/ui/workspace-ui";
import {CommerceCollection,CommerceNotice} from "../../components/ui/commerce-workspace";
import {Label} from "../../components/ui/label";
const deadlineStatus={SCADUTA:"Scaduta",IN_SCADENZA:"In scadenza",OK:"In regola"};
const deadlineSeverity={CRITICAL:"Critica",HIGH:"Alta",MEDIUM:"Media",LOW:"Bassa"};
const threshold=(value:string,fallback:number)=>value.trim()!==""&&Number.isFinite(Number(value))?Math.max(0,Number(value)):fallback;
export const VehicleDeadlinesPage = () => {
 const {canRead,canWrite,identity}=useOperationsAccess("vehicles");
 const [rows,setRows]=useState<DeadlineRow[]>([]);
 const [kpis,setKpis]=useState<DeadlineResponse["kpis"]|null>(null);
 const [kmWarning,setKmWarning]=useState("1000");
 const [revisionWarningDays,setRevisionWarningDays]=useState("30");
 const [loading,setLoading]=useState(false);
 const [syncingAll,setSyncingAll]=useState(false);
 const [syncingVehicleId,setSyncingVehicleId]=useState<string|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [success,setSuccess]=useState<string|null>(null);
 const [showAll,setShowAll]=useState(false);
 const sequence=useRef(0),syncLock=useRef(false);
 useEffect(()=>{sequence.current++;setRows([]);setKpis(null);return()=>{sequence.current++}},[identity,canRead]);
 const params=()=>({kmWarning:threshold(kmWarning,1000),revisionWarningDays:threshold(revisionWarningDays,30)});
 const load=async()=>{
  const current=++sequence.current;if(!canRead)return;
  setLoading(true);setError(null);
  try{const result=await masterDataUseCases.listVehicleDeadlines(params()) as DeadlineResponse;if(current!==sequence.current)return;setRows(result.data??[]);setKpis(result.kpis??null)}
  catch(e){if(current===sequence.current)setError((e as Error).message)}finally{if(current===sequence.current)setLoading(false)}
 };
 useEffect(()=>{void load()},[canRead,identity]);
 const sync=async(vehicleId?:string)=>{
  if(!canWrite||syncLock.current)return;syncLock.current=true;setError(null);setSuccess(null);setSyncingAll(!vehicleId);setSyncingVehicleId(vehicleId||null);
  try{const result=await masterDataUseCases.syncVehicleDeadlinesCalendar({...params(),includeSoon:true,...(vehicleId?{vehicleIds:[vehicleId]}:{})});setSuccess(`Calendario aggiornato: ${result.created} creati, ${result.updated} aggiornati, ${result.removed} rimossi.`);await load()}
  catch(e){setError((e as Error).message)}finally{syncLock.current=false;setSyncingAll(false);setSyncingVehicleId(null)}
 };
 const busy=syncingAll||!!syncingVehicleId;
 const activeAlerts=useMemo(()=>showAll?rows:rows.filter(row=>row.status!=="OK"),[rows,showAll]);
 const columns=[
  {key:"vehicle",label:"Veicolo",render:(r:DeadlineRow)=><><Link className="commerce-name" to={`/anagrafiche/veicoli?vehicleId=${encodeURIComponent(r.vehicleId)}`}><strong>{r.plate}</strong></Link><small>{r.brand} {r.model} · {r.siteName}</small></>},
  {key:"km",label:"Manutenzione",render:(r:DeadlineRow)=><><strong>{r.remainingKm==null?"Non disponibile":`${formatKm(r.remainingKm)} km residui`}</strong><small>{formatKm(r.currentKm)} km attuali · ogni {formatKm(r.maintenanceIntervalKm)} km</small></>},
  {key:"revision",label:"Revisione",render:(r:DeadlineRow)=><>{formatMonthYear(r.revisionDueAt)}<small>Ultima revisione: {formatDate(r.lastRevisionAt)}</small><small>{r.daysToRevision==null?"Scadenza non disponibile":r.daysToRevision<0?`Scaduta da ${Math.abs(r.daysToRevision)} giorni`:`Fra ${r.daysToRevision} giorni`}</small></>},
  {key:"status",label:"Urgenza",render:(r:DeadlineRow)=><><Badge variant={severityBadgeVariant(r.severity)}>{deadlineStatus[r.status]}</Badge><small>Priorità {deadlineSeverity[r.severity]}</small><small>{r.actions.join(" · ")||"Nessuna azione richiesta"}</small></>},
  {key:"actions",label:"Calendario",render:(r:DeadlineRow)=>canWrite?<Button variant="outline" disabled={busy||loading} onClick={()=>void sync(r.vehicleId)}>{syncingVehicleId===r.vehicleId?"Sincronizzazione...":"Segna nel calendario"}</Button>:<span className="operations-hint">Sola lettura</span>}
 ];
 if(!canRead)return <section className="operations-workspace"><h1>Scadenziario veicoli</h1><p>Il tuo ruolo non consente l’accesso ai veicoli.</p></section>;
 return (
  <section className="operations-workspace">
   <WorkspacePageHeader eyebrow="PREVENZIONE E CONTINUITÀ" title="Scadenziario veicoli" description="Revisione e manutenzione chilometrica, con le priorità e i prossimi interventi." actions={canWrite?<Button disabled={busy||loading} onClick={()=>void sync()}><CalendarPlus aria-hidden="true" className="h-4 w-4"/>{syncingAll?"Sincronizzazione...":"Sincronizza tutto nel calendario"}</Button>:undefined}/>
   {error?<CommerceNotice>{error}</CommerceNotice>:null}{success?<CommerceNotice tone="success">{success}</CommerceNotice>:null}
   <WorkspaceMetricStrip loading={loading||!!error||!kpis} items={[
    {label:"Alert totali",value:kpis?.total??"—",hint:"Tutti i veicoli",icon:Car},
    {label:"Km scaduti",value:kpis?.dueNowKm??"—",hint:"Intervento necessario",icon:Gauge},
    {label:"Km in scadenza",value:kpis?.dueSoonKm??"—",hint:"Entro la soglia scelta",icon:Wrench},
    {label:"Revisioni scadute",value:kpis?.dueNowRevision??"—",hint:"Da verificare",icon:CalendarDays},
    {label:"Revisioni in scadenza",value:kpis?.dueSoonRevision??"—",hint:"Entro il periodo scelto",icon:Clock},
    {label:"Critici",value:kpis?.critical??"—",hint:"Priorità più alta",icon:AlertTriangle}
   ]}/>
   <section className="commerce-panel"><header className="commerce-panel-header"><div><h2>Soglie di avviso</h2><p>Imposta quando anticipare gli avvisi. Il valore zero è consentito.</p></div></header><form className="operations-thresholds" onSubmit={e=>{e.preventDefault();void load()}}><div><Label htmlFor="deadline-km">Preavviso manutenzione · km</Label><Input id="deadline-km" type="number" min={0} value={kmWarning} onChange={e=>setKmWarning(e.target.value)} disabled={busy}/></div><div><Label htmlFor="deadline-days">Preavviso revisione · giorni</Label><Input id="deadline-days" type="number" min={0} value={revisionWarningDays} onChange={e=>setRevisionWarningDays(e.target.value)} disabled={busy}/></div><Button type="submit" variant="outline" disabled={loading||busy}>{loading?"Aggiornamento...":"Aggiorna scadenziario"}</Button></form></section>
   <section className="commerce-panel"><header className="commerce-panel-header"><div><h2>Scadenze della flotta <span>{loading||error?"—":activeAlerts.length}</span></h2><p>Priorità espresse con stato, testo e colore</p></div><label className="operations-check"><input type="checkbox" checked={showAll} onChange={e=>setShowAll(e.target.checked)}/>Mostra anche i veicoli in regola</label></header>
   {loading?<div className="commerce-empty"><FleetumInlineLoader label="Caricamento scadenziario"/></div>:error?<div className="commerce-empty"><p>Lo scadenziario non è disponibile.</p><Button variant="outline" onClick={()=>void load()}>Riprova scadenziario</Button></div>:!activeAlerts.length?<div className="commerce-empty"><h3>Nessuna scadenza attiva</h3><p>Nessun veicolo richiede un intervento con i parametri correnti.</p></div>:<CommerceCollection rows={activeAlerts.map(r=>({...r,id:r.vehicleId}))} columns={columns} caption="Scadenze, priorità e interventi dei veicoli"/>}</section>
  </section>
 );
};
