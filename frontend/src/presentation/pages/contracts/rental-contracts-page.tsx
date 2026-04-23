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
import { PageHeader } from "../../components/layout/page-header";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";

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

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const loadContracts = async (targetPage: number) => {
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
      setRows(response.data ?? []);
      setTimeline(response.timeline ?? []);
      setKpis(response.kpis ?? kpis);
      setTotal(response.total ?? 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
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
  }, [page, search, period, contractStatus, bookingStatus, siteId]);

  useEffect(() => {
    let mounted = true;
    masterDataUseCases
      .listSites({ page: 1, pageSize: 200 })
      .then((result) => {
        if (!mounted) return;
        setSites(result.data ?? []);
      })
      .catch(() => {
        if (mounted) setSites([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (actionPanelPreviewUrl) URL.revokeObjectURL(actionPanelPreviewUrl);
    };
  }, [actionPanelPreviewUrl]);

  useEffect(() => {
    if (!actionPanelRow) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActionPanelRow(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actionPanelRow]);

  useEffect(() => {
    if (!signatureModalRow) return;
    const timer = window.setTimeout(() => {
      setupSignatureCanvas();
    }, 0);
    const onResize = () => setupSignatureCanvas();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSignatureModal();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [signatureModalRow]);

  const closeActionPanel = () => {
    setActionPanelRow(null);
    setActionPanelPreviewLoading(false);
    setActionPanelPreviewError(null);
    setActionPanelPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const loadActionPanelPreview = async (row: RentalContractsMonitoringItem) => {
    setActionPanelPreviewLoading(true);
    setActionPanelPreviewError(null);
    try {
      const blob = await rentalBookingsUseCases.downloadContractPdf(row.bookingId);
      const url = URL.createObjectURL(blob);
      setActionPanelPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch (e) {
      setActionPanelPreviewError((e as Error).message);
      setActionPanelPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    } finally {
      setActionPanelPreviewLoading(false);
    }
  };

  const openActionPanel = (row: RentalContractsMonitoringItem) => {
    setActionPanelRow(row);
    void loadActionPanelPreview(row);
  };

  const setupSignatureCanvas = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const width = Math.max(280, Math.floor(canvas.clientWidth || 640));
    const height = 220;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    signatureDrawingRef.current = false;
    signatureLastPointRef.current = null;
    setSignatureHasStroke(false);
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
    setSignatureHasStroke(true);
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
    setSignatureHasStroke(true);
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
    setSignatureModalRow(null);
    setSignatureSubmitting(false);
    signatureDrawingRef.current = false;
    signatureLastPointRef.current = null;
  };

  const openSignatureModal = (row: RentalContractsMonitoringItem) => {
    setSignatureModalRow(row);
  };

  const runDownload = async (row: RentalContractsMonitoringItem) => {
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
      setSuccess(`PDF scaricato: ${row.booking.code}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyId(null);
    }
  };

  const runSendEmail = async (row: RentalContractsMonitoringItem) => {
    setActionBusyId(row.id);
    setError(null);
    try {
      await rentalBookingsUseCases.sendContractEmail(row.bookingId);
      setSuccess(`Email contratto accodata (${row.booking.code}).`);
      await loadContracts(page);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyId(null);
    }
  };

  const runSendWhatsapp = async (row: RentalContractsMonitoringItem) => {
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
        setSuccess(`WhatsApp pronto per ${row.booking.code}.`);
      }
      await loadContracts(page);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyId(null);
    }
  };

  const runMarkSigned = async (row: RentalContractsMonitoringItem, signatureDataUrl?: string) => {
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
      setSuccess(alreadySigned ? `Contratto rifirmato (${row.booking.code}).` : `Contratto firmato (${row.booking.code}).`);
      await loadContracts(page);
      if (actionPanelRow?.id === row.id) {
        await loadActionPanelPreview(row);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusyId(null);
    }
  };

  const submitSignature = async () => {
    if (!signatureModalRow) return;
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
      await runMarkSigned(signatureModalRow, signatureDataUrl);
      closeSignatureModal();
    } finally {
      setSignatureSubmitting(false);
    }
  };

  return (
    <section className="space-y-3">
      <PageHeader
        title="Contratti Noleggio"
        subtitle="Monitoraggio operativo contratti, invii multicanale e collegamenti rapidi con booking/clienti."
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Card className="saas-surface"><CardContent className="py-3"><p className="text-[11px] uppercase text-muted-foreground">Da inviare</p><p className="text-2xl font-semibold">{kpis.contractsToSend}</p></CardContent></Card>
        <Card className="saas-surface"><CardContent className="py-3"><p className="text-[11px] uppercase text-muted-foreground">Inviati oggi</p><p className="text-2xl font-semibold">{kpis.sentToday}</p></CardContent></Card>
        <Card className="saas-surface"><CardContent className="py-3"><p className="text-[11px] uppercase text-muted-foreground">Firmati</p><p className="text-2xl font-semibold">{kpis.signed}</p></CardContent></Card>
        <Card className="saas-surface"><CardContent className="py-3"><p className="text-[11px] uppercase text-muted-foreground">In errore</p><p className="text-2xl font-semibold">{kpis.inError}</p></CardContent></Card>
        <Card className="saas-surface"><CardContent className="py-3"><p className="text-[11px] uppercase text-muted-foreground">Uscite oggi</p><p className="text-2xl font-semibold">{kpis.exitsToday}</p></CardContent></Card>
        <Card className="saas-surface"><CardContent className="py-3"><p className="text-[11px] uppercase text-muted-foreground">Rientri oggi</p><p className="text-2xl font-semibold">{kpis.returnsToday}</p></CardContent></Card>
      </div>

      <Card className="saas-surface">
        <CardContent className="space-y-2 py-4">
          <div className="grid gap-2 xl:grid-cols-[1fr_160px_180px_180px_200px_auto]">
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Cerca cliente, targa, codice booking..."
            />
            <Select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}>
              <option value="all">Periodo: tutto</option>
              <option value="7d">Periodo: 7gg</option>
              <option value="30d">Periodo: 30gg</option>
              <option value="90d">Periodo: 90gg</option>
              <option value="custom">Periodo: custom</option>
            </Select>
            <Select value={contractStatus} onChange={(event) => setContractStatus(event.target.value as "" | BookingContractStatus)}>
              <option value="">Contratto: tutti</option>
              <option value="DRAFT">Bozza</option>
              <option value="READY">Pronto</option>
              <option value="SENT">Inviato</option>
              <option value="SIGNED">Firmato</option>
              <option value="ERROR">Errore</option>
            </Select>
            <Select value={bookingStatus} onChange={(event) => setBookingStatus(event.target.value as "" | RentalBookingStatus)}>
              <option value="">Prenotazione: tutti</option>
              {Object.entries(BOOKING_STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
            <Select value={siteId} onChange={(event) => setSiteId(event.target.value)}>
              <option value="">Tutte le sedi</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>{site.name}{site.city ? ` · ${site.city}` : ""}</option>
              ))}
            </Select>
            <Button variant="outline" onClick={() => void loadContracts(page)}>Aggiorna</Button>
          </div>

          {period === "custom" ? (
            <div className="grid gap-2 sm:grid-cols-2 xl:w-[420px]">
              <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <Card className="saas-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Elenco contratti</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Table className="text-[11px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="py-1.5 text-[10px]">Contratto</TableHead>
                  <TableHead className="py-1.5 text-[10px]">Cliente</TableHead>
                  <TableHead className="py-1.5 text-[10px]">Veicolo</TableHead>
                  <TableHead className="py-1.5 text-[10px]">Uscita</TableHead>
                  <TableHead className="py-1.5 text-[10px]">Rientro</TableHead>
                  <TableHead className="py-1.5 text-[10px]">Stati</TableHead>
                  <TableHead className="py-1.5 text-[10px]">Ultimo invio</TableHead>
                  <TableHead className="py-1.5 text-[10px]">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground">Caricamento contratti...</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground">Nessun contratto trovato.</TableCell></TableRow>
                ) : rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="py-1.5 align-top">
                      <p className="font-medium leading-tight">{contractCodeBySite(row)}</p>
                      <p className="text-[10px] leading-tight text-muted-foreground">{row.booking.code}</p>
                    </TableCell>
                    <TableCell className="py-1.5 align-top">
                      <button
                        type="button"
                        className="text-left text-[11px] leading-tight transition-colors hover:text-primary hover:underline"
                        onClick={() => row.booking.customer?.id && navigate(`/anagrafiche/clienti?customerId=${row.booking.customer.id}`)}
                      >
                        {row.booking.customerName}
                      </button>
                    </TableCell>
                    <TableCell className="py-1.5 align-top">
                      <p className="font-medium leading-tight">{row.booking.vehicle?.plate || "-"}</p>
                      <p className="text-[10px] leading-tight text-muted-foreground">{row.booking.vehicle?.brand || "-"} {row.booking.vehicle?.model || ""}</p>
                    </TableCell>
                    <TableCell className="py-1.5 align-top text-[10px] leading-tight">{formatWhen(row.booking.pickupAt)}</TableCell>
                    <TableCell className="py-1.5 align-top text-[10px] leading-tight">{formatWhen(row.booking.returnAt)}</TableCell>
                    <TableCell className="py-1.5 align-top">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={toBadgeVariant(row.status)}>{CONTRACT_STATUS_LABELS[row.status]}</Badge>
                        <Badge variant={toBadgeVariant(row.booking.status)}>{BOOKING_STATUS_LABELS[row.booking.status]}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="py-1.5 align-top">
                      {row.latestDelivery ? (
                        <div className="space-y-0 text-[10px] leading-tight">
                          <p>{row.latestDelivery.channel} · {row.latestDelivery.status}</p>
                          <p className="text-muted-foreground">{formatWhen(row.latestDelivery.sentAt || row.latestDelivery.createdAt)}</p>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="py-1.5 align-top">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" className="h-6 px-1.5 text-[10px]" variant="outline" onClick={() => openActionPanel(row)} disabled={actionBusyId === row.id}>
                          Azioni
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Pagina {page} / {totalPages} · Totale {total}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>Precedente</Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)}>Successiva</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="saas-surface mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Timeline operativa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {timeline.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nessun evento recente.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {timeline.map((item, idx) => (
                <article key={`${item.type}-${item.bookingId}-${idx}`} className="rounded-lg border bg-card/70 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={item.type === "DELIVERY" ? "secondary" : "outline"}>
                      {item.type === "PICKUP" ? "Uscita" : item.type === "RETURN" ? "Rientro" : `Invio ${item.channel ?? ""}`}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{formatWhen(item.occurredAt)}</span>
                  </div>
                  <p className="mt-1 text-xs font-medium">{item.bookingCode} · {item.customerName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {(item.vehicle?.plate ?? "-")} {item.vehicle?.brand ?? ""} {item.vehicle?.model ?? ""}
                  </p>
                  {item.type === "DELIVERY" ? (
                    <p className="text-[11px] text-muted-foreground">
                      {item.recipient || "-"} · {item.deliveryStatus || "-"}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Stato prenotazione: {item.bookingStatus ? BOOKING_STATUS_LABELS[item.bookingStatus] : "-"}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {actionPanelRow ? (
        <>
          <div className="fixed inset-0 z-[95] bg-black/55 backdrop-blur-sm" onClick={closeActionPanel} />
          <div className="fixed inset-x-4 top-6 z-[96] mx-auto w-full max-w-[1180px] overflow-hidden rounded-2xl border bg-background shadow-2xl md:top-10">
            <div className="flex items-start justify-between border-b px-4 py-3">
              <div>
                <p className="text-sm font-semibold">Centro Azioni Contratto</p>
                <p className="text-xs text-muted-foreground">
                  {contractCodeBySite(actionPanelRow)} · {actionPanelRow.booking.customerName}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={closeActionPanel}>
                Chiudi
              </Button>
            </div>

            <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_230px]">
              <div className="rounded-xl border bg-muted/20 p-2">
                {actionPanelPreviewLoading ? (
                  <div className="flex h-[68vh] items-center justify-center text-sm text-muted-foreground">Caricamento anteprima PDF...</div>
                ) : actionPanelPreviewError ? (
                  <div className="flex h-[68vh] flex-col items-center justify-center gap-3">
                    <p className="text-sm text-destructive">{actionPanelPreviewError}</p>
                    <Button size="sm" variant="outline" onClick={() => void loadActionPanelPreview(actionPanelRow)}>
                      Riprova
                    </Button>
                  </div>
                ) : actionPanelPreviewUrl ? (
                  <iframe
                    title={`Contratto ${actionPanelRow.booking.code}`}
                    src={actionPanelPreviewUrl}
                    className="h-[68vh] w-full rounded-lg border bg-background"
                  />
                ) : (
                  <div className="flex h-[68vh] items-center justify-center text-sm text-muted-foreground">Anteprima non disponibile.</div>
                )}
              </div>

              <aside className="space-y-2">
                <div className="rounded-lg border bg-card/70 p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Stato contratto</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant={toBadgeVariant(actionPanelRow.status)}>{CONTRACT_STATUS_LABELS[actionPanelRow.status]}</Badge>
                    <Badge variant={toBadgeVariant(actionPanelRow.booking.status)}>{BOOKING_STATUS_LABELS[actionPanelRow.booking.status]}</Badge>
                  </div>
                </div>

                <Button className="h-8 w-full justify-start" variant="outline" onClick={() => navigate(`/booking?bookingId=${actionPanelRow.bookingId}`)} disabled={actionBusyId === actionPanelRow.id}>
                  Apri Booking
                </Button>
                <Button className="h-8 w-full justify-start" variant="outline" onClick={() => void runSendEmail(actionPanelRow)} disabled={actionBusyId === actionPanelRow.id}>
                  Invia Email
                </Button>
                <Button className="h-8 w-full justify-start" variant="outline" onClick={() => void runSendWhatsapp(actionPanelRow)} disabled={actionBusyId === actionPanelRow.id}>
                  Invia WhatsApp
                </Button>
                <Button className="h-8 w-full justify-start" onClick={() => openSignatureModal(actionPanelRow)} disabled={actionBusyId === actionPanelRow.id}>
                  {actionPanelRow.status === "SIGNED" ? "Rifirma con touchpad/dito" : "Firma con touchpad/dito"}
                </Button>
                <Button className="h-8 w-full justify-start" variant="outline" onClick={() => void runDownload(actionPanelRow)} disabled={actionBusyId === actionPanelRow.id}>
                  Scarica PDF
                </Button>
              </aside>
            </div>
          </div>
        </>
      ) : null}

      {signatureModalRow ? (
        <>
          <div className="fixed inset-0 z-[109] bg-black/60 backdrop-blur-sm" onClick={closeSignatureModal} />
          <div className="fixed inset-x-4 top-14 z-[110] mx-auto w-full max-w-3xl rounded-2xl border bg-background shadow-2xl">
            <div className="flex items-start justify-between border-b px-4 py-3">
              <div>
                <p className="text-sm font-semibold">
                  {signatureModalRow.status === "SIGNED" ? "Rifirma Contratto Digitale" : "Firma Contratto Digitale"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Disegna la firma con dito, mouse o trackpad. Verrà applicata direttamente sul PDF.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={closeSignatureModal} disabled={signatureSubmitting}>
                Chiudi
              </Button>
            </div>

            <div className="space-y-3 p-4">
              <div className="rounded-xl border bg-muted/20 p-2">
                <canvas
                  ref={signatureCanvasRef}
                  className="h-[220px] w-full touch-none rounded-lg border bg-white"
                  onPointerDown={onSignaturePointerDown}
                  onPointerMove={onSignaturePointerMove}
                  onPointerUp={endSignatureDraw}
                  onPointerLeave={endSignatureDraw}
                  aria-label="Canvas firma contratto"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Contratto: {contractCodeBySite(signatureModalRow)} · Cliente: {signatureModalRow.booking.customerName}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={setupSignatureCanvas} disabled={signatureSubmitting}>
                    Cancella firma
                  </Button>
                  <Button onClick={() => void submitSignature()} disabled={signatureSubmitting || !signatureHasStroke}>
                    {signatureSubmitting
                      ? "Salvataggio..."
                      : signatureModalRow.status === "SIGNED"
                        ? "Conferma rifirma e aggiorna PDF"
                        : "Conferma firma e aggiorna PDF"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
};
