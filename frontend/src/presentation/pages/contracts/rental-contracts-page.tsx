import {collectionHref} from "../rental-payments/collection-presentation";
import {captureOperationContext,publishOperationFeedback} from "../../../application/stores/operation-feedback";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookingContractStatus,
  RentalBookingStatus,
  rentalBookingsUseCases,
  RentalContractsMonitoringItem,
  RentalContractsMonitoringTimelineItem
} from "../../../application/usecases/rental-bookings-usecases";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { FleetumBlockLoader, FleetumInlineLoader } from "../../components/brand/fleetum-logo-loader";
import { useAuthStore } from "../../../application/stores/auth-store";
import { CommerceDrawer,CommerceCollection,CommerceNotice } from "../../components/ui/commerce-workspace";
import { WorkspacePageHeader } from "../../components/ui/workspace-ui";
import type { PanelMotionHandle } from "../../components/ui/panel-motion";
import { Label } from "../../components/ui/label";
import { PageHeader } from "../../components/layout/page-header";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { cn } from "../../../lib/utils";

const PAGE_SIZE = 20;
const currency = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

const CONTRACT_STATUS_LABELS: Record<BookingContractStatus, string> = {
  DRAFT: "Bozza",
  READY: "Pronto",
  SENT: "Inviato",
  SIGNED: "Firmato",
  ERROR: "Errore"
};

const BOOKING_STATUS_LABELS: Record<RentalBookingStatus, string> = {
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

const toBadgeVariant = (value?: string | null): "outline" | "secondary" | "success" | "destructive" => {
  if (!value) return "outline";
  if (value === "SIGNED" || value === "SENT" || value === "READY" || value === "READY_FOR_HANDOVER") return "success";
  if (value === "ERROR" || value === "FAILED" || value === "CANCELED" || value === "NO_SHOW") return "destructive";
  if (value === "IN_RENT" || value === "CONFIRMED" || value === "CONTRACT_SIGNED") return "secondary";
  return "outline";
};

const formatWhen = (value?: string | Date | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const contractCodeBySite = (row: RentalContractsMonitoringItem) => {
  const siteName = row.booking.vehicle?.site?.name ?? "";
  const normalized = siteName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("")
    .slice(0, 4);
  const prefix = normalized || "SEDE";
  return `${prefix}-${row.booking.code}`;
};

const ContractsKpiCard = ({
  title,
  value,
  hint,
  valueTone = "default"
}: {
  title: string;
  value: number;
  hint: string;
  valueTone?: "default" | "success" | "danger" | "warning";
}) => {
  const valueClassName =
    valueTone === "success"
      ? "text-emerald-600 dark:text-emerald-300"
      : valueTone === "danger"
        ? "text-rose-600 dark:text-rose-300"
        : valueTone === "warning"
          ? "text-amber-600 dark:text-amber-300"
          : "text-foreground";

  return (
    <Card className="saas-surface dashboard-enterprise-kpi min-h-[138px]">
      <CardContent className="flex min-h-[138px] flex-col justify-center gap-2 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</p>
        <p className={cn("font-display text-[clamp(1.8rem,2.2vw,2.25rem)] font-semibold leading-none tracking-tight", valueClassName)}>
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
};

export const RentalContractsPage = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RentalContractsMonitoringItem[]>([]);
  const [timeline, setTimeline] = useState<RentalContractsMonitoringTimelineItem[]>([]);
  const [sites, setSites] = useState<Array<{ id: string; name: string; city?: string }>>([]);
  const [kpis, setKpis] = useState({
    contractsToSend: 0,
    sentToday: 0,
    signed: 0,
    inError: 0,
    exitsToday: 0,
    returnsToday: 0
  });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<"all" | "7d" | "30d" | "90d" | "custom">("all");
  const [contractStatus, setContractStatus] = useState<"" | BookingContractStatus>("");
  const [bookingStatus, setBookingStatus] = useState<"" | RentalBookingStatus>("");
  const [siteId, setSiteId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionPanelRow, setActionPanelRow] = useState<RentalContractsMonitoringItem | null>(null);
  const [actionPanelPreviewUrl, setActionPanelPreviewUrl] = useState<string | null>(null);
  const [actionPanelPreviewLoading, setActionPanelPreviewLoading] = useState(false);
  const [actionPanelPreviewError, setActionPanelPreviewError] = useState<string | null>(null);
  const [signatureModalRow, setSignatureModalRow] = useState<RentalContractsMonitoringItem | null>(null);
  const [signatureHasStroke, setSignatureHasStroke] = useState(false);
  const [signatureSubmitting, setSignatureSubmitting] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const signatureDrawingRef = useRef(false);
  const signatureLastPointRef = useRef<{ x: number; y: number } | null>(null);
  const contractEmailRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const permissions=useAuthStore(state=>state.user?.permissions)??[];
  const has=(permission:string)=>permissions.includes('*')||permissions.includes(permission);
  const canRead=has('vehicles:read'),canWrite=has('vehicles:write'),canReadSites=has('sites:read');
  const listSequence=useRef(0),previewSequence=useRef(0),actionRowRef=useRef<string|null>(null),panelMotion=useRef<PanelMotionHandle|null>(null),panelOrigin=useRef<HTMLElement|null>(null),signatureStrokeRef=useRef(false);
  const [sitesError,setSitesError]=useState<string|null>(null);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const loadContracts = async (targetPage: number) => {
    if(!canRead)return;const sequence=++listSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await rentalBookingsUseCases.listContractsMonitoring({
        page: targetPage,
        pageSize: PAGE_SIZE,
        period,
        status: contractStatus || undefined,
        bookingStatus: bookingStatus || undefined,
        siteId: siteId || undefined,
        search: search || undefined,
        dateFrom: period === "custom" && dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
        dateTo: period === "custom" && dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined
      });
      if(sequence!==listSequence.current)return;
      setRows(response.data ?? []);
      setTimeline(response.timeline ?? []);
      setKpis(response.kpis ?? kpis);
      setTotal(response.total ?? 0);
    } catch (e) {
      if(sequence===listSequence.current)setError((e as Error).message);
    } finally {
      if(sequence===listSequence.current)setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    void loadContracts(page);
    return()=>{listSequence.current++};
  }, [page, search, period, contractStatus, bookingStatus, siteId,canRead]);

  useEffect(() => {
    if(!canRead||!canReadSites)return;let mounted = true;
    masterDataUseCases
      .listSites({ page: 1, pageSize: 200 })
      .then((result) => {
        if (!mounted) return;
        setSites(result.data ?? []);
      })
      .catch(() => {
        if (mounted){setSites([]);setSitesError("Sedi non disponibili. Gli altri filtri restano utilizzabili.")}
      });
    return () => {
      mounted = false;
    };
  }, [canRead,canReadSites]);

  useEffect(() => {
    return () => {
      if (actionPanelPreviewUrl) URL.revokeObjectURL(actionPanelPreviewUrl);
    };
  }, [actionPanelPreviewUrl]);

  useEffect(() => {
    if (!signatureModalRow) return;
    const timer = window.setTimeout(() => {
      setupSignatureCanvas();
    }, 0);
    const onResize = () => setupSignatureCanvas(true);
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [signatureModalRow]);

  const closeActionPanel=()=>{
    if(actionBusyId||signatureModalRow)return;previewSequence.current++;actionRowRef.current=null;
    const done=()=>{setActionPanelRow(null);setActionPanelPreviewLoading(false);setActionPanelPreviewError(null);setActionPanelPreviewUrl(prev=>{if(prev)URL.revokeObjectURL(prev);return null})};
    if(panelMotion.current)panelMotion.current.dismiss(done);else done();
  };
  const loadActionPanelPreview=async(row:RentalContractsMonitoringItem)=>{
    if(!canRead)return;const sequence=++previewSequence.current;setActionPanelPreviewLoading(true);setActionPanelPreviewError(null);
    try{const blob=await rentalBookingsUseCases.downloadContractPdf(row.bookingId);if(sequence!==previewSequence.current||actionRowRef.current!==row.id)return;const url=URL.createObjectURL(blob);setActionPanelPreviewUrl(previous=>{if(previous)URL.revokeObjectURL(previous);return url})}
    catch(e){if(sequence===previewSequence.current&&actionRowRef.current===row.id){setActionPanelPreviewError((e as Error).message);setActionPanelPreviewUrl(previous=>{if(previous)URL.revokeObjectURL(previous);return null})}}
    finally{if(sequence===previewSequence.current)setActionPanelPreviewLoading(false)}
  };
  const openActionPanel=(row:RentalContractsMonitoringItem,origin?:HTMLElement)=>{if(!canRead||actionBusyId)return;panelOrigin.current=origin??null;actionRowRef.current=row.id;setActionPanelPreviewUrl(null);setActionPanelRow(row);setError(null);void loadActionPanelPreview(row)};
  useEffect(()=>()=>{previewSequence.current++;actionRowRef.current=null},[]);

  const setupSignatureCanvas = (preserve=false) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const keep=preserve&&signatureStrokeRef.current;const copy=keep?document.createElement("canvas"):null;if(copy){copy.width=canvas.width;copy.height=canvas.height;copy.getContext("2d")?.drawImage(canvas,0,0)}
    const width = Math.max(280, Math.floor(canvas.clientWidth || 640));
    const height = 220;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
    // Keep pixel buffer transparent so exported PNG blends with PDF signature box colors.
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    signatureDrawingRef.current = false;
    signatureLastPointRef.current = null;
    if(copy)ctx.drawImage(copy,0,0,width,height);signatureStrokeRef.current=keep;setSignatureHasStroke(keep);
  };

  const getSignaturePoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  const onSignaturePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if(!canWrite||signatureSubmitting)return;
    const canvas = signatureCanvasRef.current;
    const point = getSignaturePoint(event);
    if (!canvas || !point) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    signatureDrawingRef.current = true;
    signatureLastPointRef.current = point;
    canvas.setPointerCapture(event.pointerId);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = "#1f2937";
    ctx.fill();
    signatureStrokeRef.current=true;setSignatureHasStroke(true);
  };

  const onSignaturePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!signatureDrawingRef.current) return;
    const canvas = signatureCanvasRef.current;
    const point = getSignaturePoint(event);
    if (!canvas || !point) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const previous = signatureLastPointRef.current;
    if (!previous) {
      signatureLastPointRef.current = point;
      return;
    }
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    signatureLastPointRef.current = point;
    signatureStrokeRef.current=true;setSignatureHasStroke(true);
  };

  const endSignatureDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!signatureDrawingRef.current) return;
    const canvas = signatureCanvasRef.current;
    signatureDrawingRef.current = false;
    signatureLastPointRef.current = null;
    if (canvas && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  const closeSignatureModal = () => {
    if(signatureSubmitting)return;
    setSignatureModalRow(null);
    setSignatureSubmitting(false);
    signatureDrawingRef.current = false;
    signatureLastPointRef.current = null;
  };

  const openSignatureModal = (row: RentalContractsMonitoringItem) => {
    if(!canWrite||actionBusyId)return;setError(null);
    setSignatureModalRow(row);
  };

  const runDownload = async (row: RentalContractsMonitoringItem) => {
    const notificationScope=captureOperationContext();
    if(!canRead||actionBusyId)return false;
    setActionBusyId(row.id);
    setError(null);
    try {
      const blob = await rentalBookingsUseCases.downloadContractPdf(row.bookingId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Contratto_${row.booking.code}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 120000);
      publishOperationFeedback(setSuccess, `PDF scaricato: ${row.booking.code}`, notificationScope);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyId(null);
    }
  };

  const runSendEmail = async (row: RentalContractsMonitoringItem) => {
    const notificationScope=captureOperationContext();
    if(!canWrite||actionBusyId)return false;
    setActionBusyId(row.id);
    setError(null);
    try {
      const fingerprint = JSON.stringify({ contractId: row.id, bookingId: row.bookingId });
      if (contractEmailRequestRef.current?.fingerprint !== fingerprint) {
        contractEmailRequestRef.current = { fingerprint, key: globalThis.crypto.randomUUID() };
      }
      await rentalBookingsUseCases.sendContractEmail(
        row.bookingId,
        undefined,
        contractEmailRequestRef.current.key
      );
      contractEmailRequestRef.current = null;
      publishOperationFeedback(setSuccess, `Email contratto accodata (${row.booking.code}).`, notificationScope, "info");
      await loadContracts(page);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyId(null);
    }
  };

  const runSendWhatsapp = async (row: RentalContractsMonitoringItem) => {
    const notificationScope=captureOperationContext();
    if(!canWrite||actionBusyId)return false;
    setActionBusyId(row.id);
    setError(null);
    try {
      const result = await rentalBookingsUseCases.sendContractWhatsapp(row.bookingId, {
        phone: row.booking.customer?.phone ?? undefined
      });
      const popup = window.open(result.whatsappUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        setError("Popup WhatsApp bloccato dal browser. Consenti i popup e riprova.");
      } else {
        publishOperationFeedback(setSuccess, `WhatsApp pronto per ${row.booking.code}.`, notificationScope, "info");
      }
      await loadContracts(page);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyId(null);
    }
  };

  const runMarkSigned = async (row: RentalContractsMonitoringItem, signatureDataUrl?: string) => {
    const notificationScope=captureOperationContext();
    if(!canWrite||actionBusyId)return false;
    setActionBusyId(row.id);
    setError(null);
    try {
      const result = await rentalBookingsUseCases.markContractSigned(
        row.bookingId,
        signatureDataUrl ? { signatureDataUrl } : undefined
      );
      if (signatureDataUrl && !(result as unknown as { signatureSaved?: boolean }).signatureSaved) {
        throw new Error("Firma non acquisita nel contratto. Riprova.");
      }
      const alreadySigned = row.status === "SIGNED";
      publishOperationFeedback(setSuccess, alreadySigned ? `Contratto rifirmato (${row.booking.code}).` : `Contratto firmato (${row.booking.code}).`, notificationScope);
      await loadContracts(page);
      if (actionPanelRow?.id === row.id) {
        await loadActionPanelPreview(row);
      }
      return true;
    } catch (e) {
      setError((e as Error).message);return false;
    } finally {
      setActionBusyId(null);
    }
  };

  const submitSignature = async () => {
    if (!signatureModalRow||!canWrite||signatureSubmitting) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) {
      setError("Canvas firma non disponibile.");
      return;
    }
    if (!signatureHasStroke) {
      setError("Disegna la firma prima di confermare.");
      return;
    }

    setSignatureSubmitting(true);
    try {
      const signatureDataUrl = canvas.toDataURL("image/png");
      const saved=await runMarkSigned(signatureModalRow, signatureDataUrl);
      if(saved)closeSignatureModal();
    } finally {
      setSignatureSubmitting(false);
    }
  };

  const code=(row:RentalContractsMonitoringItem)=><><button className="commerce-name" onClick={event=>openActionPanel(row,event.currentTarget)} aria-haspopup="dialog" aria-expanded={actionPanelRow?.id===row.id}><strong data-panel-origin-title translate="no">{contractCodeBySite(row)}</strong></button><small>{row.booking.code}</small></>;
  const states=(row:RentalContractsMonitoringItem)=><div className="commerce-states"><span>Documento: <Badge variant={toBadgeVariant(row.status)}>{CONTRACT_STATUS_LABELS[row.status]}</Badge></span><span>Noleggio: <Badge variant={toBadgeVariant(row.booking.status)}>{BOOKING_STATUS_LABELS[row.booking.status]}</Badge></span></div>;
  const columns=[
   {key:'code',label:'Contratto',render:code},
   {key:'customer',label:'Cliente',render:(row:RentalContractsMonitoringItem)=>row.booking.customer?.id?<button className="commerce-link" onClick={()=>navigate(`/anagrafiche/clienti?customerId=${row.booking.customer!.id}`)}>{row.booking.customerName}</button>:<span>{row.booking.customerName}</span>},
   {key:'vehicle',label:'Veicolo',render:(row:RentalContractsMonitoringItem)=><><strong>{row.booking.vehicle?.plate||'—'}</strong><small>{row.booking.vehicle?.brand||'—'} {row.booking.vehicle?.model||''}</small></>},
   {key:'trip',label:'Periodo noleggio',render:(row:RentalContractsMonitoringItem)=><><span>Uscita: {formatWhen(row.booking.pickupAt)}</span><small>Rientro: {formatWhen(row.booking.returnAt)}</small></>},
   {key:'states',label:'Stati',render:states},
   {key:'delivery',label:'Ultimo invio',render:(row:RentalContractsMonitoringItem)=>row.latestDelivery?<><span>{row.latestDelivery.channel} · {row.latestDelivery.status}</span><small>{formatWhen(row.latestDelivery.sentAt||row.latestDelivery.createdAt)}</small></>:<span>—</span>},
   {key:'actions',label:'Azioni',render:(row:RentalContractsMonitoringItem)=><Button variant="outline" disabled={!!actionBusyId} onClick={event=>openActionPanel(row,event.currentTarget)} aria-label={`Apri contratto ${row.booking.code}`} aria-haspopup="dialog">Apri</Button>}
  ];
  const filterChange=(change:()=>void)=>{setPage(1);change()};
  if(!canRead)return <section className="contracts-workspace commerce-workspace"><h1>Contratti</h1><p>Il tuo ruolo non consente l’accesso ai contratti.</p></section>;
  return (
   <section className="contracts-workspace commerce-workspace" aria-label="Gestione contratti">
    <WorkspacePageHeader eyebrow="I TUOI DOCUMENTI" title="Contratti" description="Documenti, firme e invii. Segui ogni contratto insieme alla sua prenotazione." actions={<>{canWrite?<Button variant="outline" onClick={()=>navigate('/booking?template=1'+(rows[0]?.bookingId?'&bookingId='+encodeURIComponent(rows[0].bookingId):''))}>Modello aziendale</Button>:null}<Button onClick={()=>navigate('/booking')}>Apri prenotazioni</Button></>}/>
    {!actionPanelRow&&!signatureModalRow&&error?<CommerceNotice>{error}</CommerceNotice>:null}{success?<CommerceNotice tone="success">{success}</CommerceNotice>:null}
    <dl className="commerce-kpis" aria-label="Riepilogo contratti">{([['Da inviare',kpis.contractsToSend,'Pronti, non ancora inviati'],['Inviati oggi',kpis.sentToday,'Invii completati oggi'],['Firmati',kpis.signed,'Firma acquisita'],['In errore',kpis.inError,'Esiti da verificare'],['Uscite oggi',kpis.exitsToday,'Consegne della giornata'],['Rientri oggi',kpis.returnsToday,'Veicoli attesi oggi']]as const).map(([title,value,hint])=><div key={title}><dt>{title}</dt><dd>{loading||error?'—':value??'—'}</dd><dd className="commerce-hint">{hint}</dd></div>)}</dl>
    <section className="commerce-panel" aria-labelledby="contracts-list-title"><header className="commerce-panel-header"><div><h2 id="contracts-list-title">Elenco contratti <span>{loading?'—':total}</span></h2><p>Documenti generati e stato delle operazioni</p></div><Button variant="ghost" aria-label="Aggiorna contratti" disabled={loading} onClick={()=>void loadContracts(page)}>Aggiorna</Button></header>
     <div className="commerce-filters contracts-filters">
      <div><Label htmlFor="contracts-search">Cerca un contratto</Label><Input id="contracts-search" value={searchInput} onChange={event=>setSearchInput(event.target.value)} placeholder="Cliente, targa o codice prenotazione"/></div>
      <div><Label htmlFor="contracts-period">Periodo</Label><Select id="contracts-period" value={period} onChange={event=>filterChange(()=>setPeriod(event.target.value as typeof period))}><option value="all">Tutto il periodo</option><option value="7d">Ultimi 7 giorni</option><option value="30d">Ultimi 30 giorni</option><option value="90d">Ultimi 90 giorni</option><option value="custom">Personalizzato</option></Select></div>
      <div><Label htmlFor="contracts-status">Stato documento</Label><Select id="contracts-status" value={contractStatus} onChange={event=>filterChange(()=>setContractStatus(event.target.value as typeof contractStatus))}><option value="">Tutti i documenti</option>{Object.entries(CONTRACT_STATUS_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select></div>
      <div><Label htmlFor="contracts-booking-status">Stato prenotazione</Label><Select id="contracts-booking-status" value={bookingStatus} onChange={event=>filterChange(()=>setBookingStatus(event.target.value as typeof bookingStatus))}><option value="">Tutte le prenotazioni</option>{Object.entries(BOOKING_STATUS_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select></div>
      {canReadSites?<div><Label htmlFor="contracts-site">Sede</Label><Select id="contracts-site" value={siteId} onChange={event=>filterChange(()=>setSiteId(event.target.value))}><option value="">Tutte le sedi</option>{sites.map(site=><option translate="no" key={site.id} value={site.id}>{site.name}{site.city?' · '+site.city:''}</option>)}</Select></div>:null}
      {period==='custom'?<><div><Label htmlFor="contracts-from">Dal giorno</Label><Input id="contracts-from" type="date" value={dateFrom} onChange={event=>setDateFrom(event.target.value)}/></div><div><Label htmlFor="contracts-to">Al giorno</Label><Input id="contracts-to" type="date" value={dateTo} onChange={event=>setDateTo(event.target.value)}/></div><Button variant="outline" onClick={()=>{setPage(1);void loadContracts(1)}}>Applica periodo</Button></>:null}
     </div>
     {sitesError?<p className="commerce-hint" role="status">{sitesError}</p>:null}
     <div aria-busy={loading}>{loading?<div className="commerce-empty"><FleetumInlineLoader label="Caricamento contratti"/></div>:error&&!rows.length?<div className="commerce-empty"><p>Contratti non disponibili.</p><Button variant="outline" onClick={()=>void loadContracts(page)}>Riprova elenco contratti</Button></div>:!rows.length?<div className="commerce-empty"><h3>Nessun contratto trovato.</h3><p>Modifica i filtri oppure apri una prenotazione per preparare il contratto.</p><Button variant="outline" onClick={()=>navigate('/booking')}>Vai alle prenotazioni</Button></div>:<CommerceCollection rows={rows} columns={columns} caption="Contratti, clienti e stato degli invii" selectedId={actionPanelRow?.id}/>}</div>
     <footer className="commerce-pagination"><p role="status">Pagina {page} di {totalPages} · Totale {loading?'—':total}</p><div><Button variant="outline" disabled={page<=1||loading} onClick={()=>setPage(value=>value-1)}>Precedente</Button><Button variant="outline" disabled={page>=totalPages||loading} onClick={()=>setPage(value=>value+1)}>Successiva</Button></div></footer>
    </section>
    <details className="commerce-panel commerce-timeline" open><summary>Timeline operativa <span>Uscite, rientri e invii</span></summary>{!timeline.length?<p className="commerce-hint">Nessun evento recente.</p>:<ol>{timeline.map((item,index)=><li key={`${item.type}-${item.bookingId}-${index}`}><div><strong>{item.type==='PICKUP'?'Uscita':item.type==='RETURN'?'Rientro':`Invio ${item.channel??''}`}</strong><time>{formatWhen(item.occurredAt)}</time></div><p>{item.bookingCode} · {item.customerName}</p><small>{item.vehicle?.plate??'—'} {item.vehicle?.brand??''} {item.vehicle?.model??''}</small><small>{item.type==='DELIVERY'?`${item.recipient||'—'} · ${item.deliveryStatus||'—'}`:item.bookingStatus?BOOKING_STATUS_LABELS[item.bookingStatus]:'—'}</small></li>)}</ol>}</details>
    {actionPanelRow?<CommerceDrawer translateTitle={false} translateDescription={false} title={contractCodeBySite(actionPanelRow)} description={actionPanelRow.booking.customerName} onClose={closeActionPanel} motionRef={panelMotion} origin={panelOrigin.current} busy={!!actionBusyId} footer={<><Button variant="outline" disabled={!!actionBusyId} onClick={closeActionPanel}>Chiudi</Button><Button variant="outline" disabled={!!actionBusyId} onClick={()=>navigate(`/booking?bookingId=${actionPanelRow.bookingId}`)}>Apri prenotazione</Button>{has("rental-payments:read")?<Button variant="outline" disabled={!!actionBusyId} onClick={()=>navigate(collectionHref(actionPanelRow.bookingId,"/booking/contratti"))}>Pagamenti e garanzie</Button>:null}</>}>
     {error?<CommerceNotice>{error}</CommerceNotice>:null}{states(actionPanelRow)}
     <div className="contract-action-buttons">{canWrite?<><Button variant="outline" onClick={()=>void runSendEmail(actionPanelRow)} disabled={!!actionBusyId}>Invia Email</Button><Button variant="outline" onClick={()=>void runSendWhatsapp(actionPanelRow)} disabled={!!actionBusyId}>Invia WhatsApp</Button><Button onClick={()=>openSignatureModal(actionPanelRow)} disabled={!!actionBusyId}>{actionPanelRow.status==='SIGNED'?'Rifirma contratto':'Firma contratto'}</Button></>:<p className="commerce-hint">Modalità sola lettura.</p>}<Button variant="outline" onClick={()=>void runDownload(actionPanelRow)} disabled={!!actionBusyId}>Scarica PDF</Button></div>
     <p className="commerce-hint">Preparazione e rigenerazione restano nella sezione Contratto della prenotazione.</p>
     <section className="contract-preview" aria-label="Anteprima contratto">{actionPanelPreviewLoading?<FleetumBlockLoader label="Caricamento anteprima PDF" className="min-h-0 h-72"/>:actionPanelPreviewError?<div className="commerce-empty"><CommerceNotice>{actionPanelPreviewError}</CommerceNotice><Button variant="outline" onClick={()=>void loadActionPanelPreview(actionPanelRow)}>Riprova anteprima</Button></div>:actionPanelPreviewUrl?<iframe title={`Contratto ${actionPanelRow.booking.code}`} src={actionPanelPreviewUrl}/>:<p>Anteprima non disponibile.</p>}</section>
    </CommerceDrawer>:null}
    {signatureModalRow?<CommerceDrawer title={signatureModalRow.status==='SIGNED'?'Rifirma contratto':'Firma contratto'} description="Disegna con dito, mouse o trackpad. La firma verrà applicata al PDF." level={115} busy={signatureSubmitting} onClose={closeSignatureModal} footer={<><Button variant="outline" onClick={()=>setupSignatureCanvas()} disabled={signatureSubmitting}>Cancella firma</Button><Button onClick={()=>void submitSignature()} disabled={signatureSubmitting||!signatureHasStroke}>{signatureSubmitting?'Salvataggio...':'Conferma firma e aggiorna PDF'}</Button></>}>
     <p>{contractCodeBySite(signatureModalRow)} · {signatureModalRow.booking.customerName}</p>{error?<CommerceNotice>{error}</CommerceNotice>:null}
     <canvas ref={signatureCanvasRef} className="contract-signature" onPointerDown={onSignaturePointerDown} onPointerMove={onSignaturePointerMove} onPointerUp={endSignatureDraw} onPointerLeave={endSignatureDraw} aria-label="Canvas firma contratto"/>
    </CommerceDrawer>:null}
   </section>
  );
};
