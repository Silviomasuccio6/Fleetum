import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarDays, Car, ChevronLeft, ChevronRight, Gauge, ShieldCheck, Wrench } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { stoppagesUseCases } from "../../../application/usecases/stoppages-usecases";
import { statsUseCases } from "../../../application/usecases/stats-usecases";
import { stoppageStatusLabel } from "../../../domain/constants/stoppage-status";
import { FleetumBlockLoader } from "../../components/brand/fleetum-logo-loader";
import { PremiumLockGate } from "../../components/common/premium-lock-gate";
import { CardStat } from "../../components/common/table";
import { PageHeader } from "../../components/layout/page-header";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { useAsync } from "../../hooks/use-async";
import { useEntitlements } from "../../hooks/use-entitlements";

type TrendRange = "7d" | "15d" | "30d";

const rangeOptions: Array<{ value: TrendRange; label: string; days: number }> = [
  { value: "7d", label: "7gg", days: 7 },
  { value: "15d", label: "15gg", days: 15 },
  { value: "30d", label: "30gg", days: 30 }
];

const trendViews = [
  {
    title: "Aperture vs Chiusure",
    subtitle: "Confronto giornaliero tra nuovi fermi aperti e chiusi."
  },
  {
    title: "Reminder Inviati",
    subtitle: "Volume reminder inviati nel range selezionato."
  },
  {
    title: "Saldo Aperture-Chiusure",
    subtitle: "Differenza operativa giornaliera tra aperture e chiusure."
  }
] as const;

const chartAxisTick = {
  fill: "rgba(13,15,46,0.55)",
  fontSize: 11,
  fontFamily: "JetBrains Mono, monospace"
};

const chartTooltipStyle = {
  background: "rgba(255,255,255,0.96)",
  border: "1px solid rgba(99,102,241,0.2)",
  borderRadius: 12,
  boxShadow: "0 10px 30px rgba(99,102,241,0.16)",
  color: "#0D0F2E"
};

const formatCurrency = (value?: number | string | null) => {
  const parsed = typeof value === "number" ? value : Number(value ?? NaN);
  if (!Number.isFinite(parsed)) return "-";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(parsed);
};

const getRangeBounds = (range: TrendRange) => {
  const today = new Date();
  const end = new Date(today);
  end.setHours(23, 59, 59, 999);

  const start = new Date(today);
  const days = rangeOptions.find((entry) => entry.value === range)?.days ?? 30;
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  return { start, end };
};

const compactNumber = (value?: number | string | null, suffix = "") => {
  const parsed = typeof value === "number" ? value : Number(value ?? NaN);
  if (!Number.isFinite(parsed)) return "-";
  return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(parsed)}${suffix}`;
};

const formatDateTime = (value?: string | Date | null) => {
  if (!value) return "-";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const statusBadgeVariant = (status?: string) => {
  if (["SIGNED", "CLOSED", "SENT", "READY"].includes(status ?? "")) return "success" as const;
  if (["ERROR", "FAILED", "CANCELED"].includes(status ?? "")) return "destructive" as const;
  if (["DRAFT", "NOT_READY", "HOLD"].includes(status ?? "")) return "warning" as const;
  return "secondary" as const;
};

const DashboardActionButton = ({
  label,
  onClick,
  variant = "outline"
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "outline" | "secondary";
}) => (
  <Button type="button" variant={variant} size="sm" className="h-9 justify-start rounded-xl px-3" onClick={onClick}>
    {label}
  </Button>
);

const CompactBookingRow = ({
  title,
  subtitle,
  meta,
  badge,
  onOpen
}: {
  title: string;
  subtitle: string;
  meta: string;
  badge?: string;
  onOpen: () => void;
}) => (
  <button
    type="button"
    className="dashboard-enterprise-item w-full rounded-xl border border-border/80 bg-background/75 p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_18px_34px_-26px_rgba(37,99,235,0.65)]"
    onClick={onOpen}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {badge ? <Badge variant={statusBadgeVariant(badge)}>{badge}</Badge> : null}
    </div>
    <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-300">{meta}</p>
  </button>
);

const BookingControlRoom = ({ booking, onNavigate }: { booking: any; onNavigate: (to: string) => void }) => {
  const kpis = booking?.kpis ?? {};
  const contracts = booking?.contractKpis ?? {};
  const economics = booking?.economicKpis ?? {};
  const charts = booking?.charts ?? {};
  const lists = booking?.lists ?? {};
  const trend = (charts.trend ?? []).map((item: any) => ({
    ...item,
    day: typeof item.day === "string" ? item.day.slice(5) : "-"
  }));
  const utilization = (charts.utilization ?? []).map((item: any) => ({
    ...item,
    day: typeof item.day === "string" ? item.day.slice(5) : "-"
  }));
  const topVehicles = charts.topVehicles ?? [];
  const contractDistribution = charts.contractStatusDistribution ?? [];
  const criticalBookings = lists.criticalBookings ?? [];
  const nextPickups = lists.nextPickups ?? [];
  const nextReturns = lists.nextReturns ?? [];

  return (
    <div className="space-y-4">
      <Card className="saas-surface dashboard-enterprise-card overflow-hidden">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Control Room Noleggi</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">Booking Noleggi</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Disponibilita, uscite, rientri, contratti e criticita operative in un unico pannello.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <DashboardActionButton label="Nuova prenotazione" variant="default" onClick={() => onNavigate("/booking")} />
              <DashboardActionButton label="Apri Booking" onClick={() => onNavigate("/booking")} />
              <DashboardActionButton label="Contratti" onClick={() => onNavigate("/booking/contratti")} />
              <DashboardActionButton label="Listini" onClick={() => onNavigate("/booking/listini")} />
              <DashboardActionButton label="Nuovo cliente" onClick={() => onNavigate("/anagrafiche/clienti")} />
              <DashboardActionButton label="Scadenziario" onClick={() => onNavigate("/anagrafiche/scadenziario")} />
              <DashboardActionButton label="Manutenzioni" onClick={() => onNavigate("/anagrafiche/manutenzioni")} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CardStat className="dashboard-enterprise-kpi" title="Disponibili oggi" value={kpis.availableToday ?? 0} extra={<p className="mt-1 text-xs text-muted-foreground">Su {kpis.totalRentalVehicles ?? 0} veicoli noleggio</p>} />
        <CardStat className="dashboard-enterprise-kpi" title="Occupati oggi" value={kpis.occupiedToday ?? 0} extra={<p className="mt-1 text-xs text-muted-foreground">Occupazione {compactNumber(kpis.utilizationRateToday, "%")}</p>} />
        <CardStat className="dashboard-enterprise-kpi" title="Uscite oggi" value={kpis.pickupsToday ?? 0} extra={<p className="mt-1 text-xs text-muted-foreground">Da preparare e consegnare</p>} />
        <CardStat className="dashboard-enterprise-kpi" title="Rientri oggi" value={kpis.returnsToday ?? 0} extra={<p className="mt-1 text-xs text-muted-foreground">{kpis.overdueReturns ?? 0} rientri scaduti</p>} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <CardStat className="dashboard-enterprise-kpi" title="Contratti da generare" value={contracts.toGenerate ?? 0} />
        <CardStat className="dashboard-enterprise-kpi" title="Contratti da inviare" value={contracts.toSend ?? 0} />
        <CardStat className="dashboard-enterprise-kpi" title="Contratti inviati oggi" value={contracts.sentToday ?? 0} />
        <CardStat className="dashboard-enterprise-kpi" title="Contratti firmati" value={contracts.signed ?? 0} />
        <CardStat className="dashboard-enterprise-kpi" title="Contratti in errore" value={contracts.errors ?? 0} />
        <CardStat className="dashboard-enterprise-kpi" title="Senza firma" value={contracts.unsigned ?? 0} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="saas-surface dashboard-enterprise-card xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Trend booking operativo</CardTitle>
            <p className="text-xs text-muted-foreground">Prenotazioni create, uscite e rientri negli ultimi 30 giorni.</p>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {trend.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend}>
                    <defs>
                      <linearGradient id="bookingCreated" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.24} />
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={chartAxisTick} />
                    <YAxis axisLine={false} tickLine={false} tick={chartAxisTick} />
                    <Tooltip cursor={false} isAnimationActive={false} wrapperStyle={{ pointerEvents: "none" }} contentStyle={chartTooltipStyle} />
                    <Area type="monotone" dataKey="created" name="Create" stroke="#4f46e5" fill="url(#bookingCreated)" strokeWidth={2} />
                    <Line type="monotone" dataKey="pickups" name="Uscite" stroke="#059669" strokeWidth={2.4} dot={false} />
                    <Line type="monotone" dataKey="returns" name="Rientri" stroke="#f59e0b" strokeWidth={2.4} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="grid h-full place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">Nessun dato booking disponibile.</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="saas-surface dashboard-enterprise-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Economia noleggio</CardTitle>
            <p className="text-xs text-muted-foreground">Mese corrente, previsto vs consuntivo.</p>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="rounded-xl border border-border/80 bg-background/75 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ricavi previsti</p>
              <p className="mt-1 text-2xl font-semibold">{formatCurrency(economics.expectedRevenueMonth)}</p>
            </div>
            <div className="rounded-xl border border-border/80 bg-background/75 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ricavi consuntivi</p>
              <p className="mt-1 text-2xl font-semibold">{formatCurrency(economics.finalRevenueMonth)}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <span className="rounded-lg bg-muted/50 p-2">Ticket medio<br /><b>{formatCurrency(economics.averageTicket)}</b></span>
              <span className="rounded-lg bg-muted/50 p-2">€/veicolo<br /><b>{formatCurrency(economics.revenuePerVehicle)}</b></span>
              <span className="rounded-lg bg-muted/50 p-2">€/giorno<br /><b>{formatCurrency(economics.revenuePerRentalDay)}</b></span>
              <span className="rounded-lg bg-muted/50 p-2">Extra km<br /><b>{compactNumber(economics.extraKmActual)} reali</b></span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="saas-surface dashboard-enterprise-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4" /> Prossime uscite</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {nextPickups.length ? nextPickups.map((item: any) => (
              <CompactBookingRow key={item.id} title={item.customer} subtitle={item.vehicle} meta={`${formatDateTime(item.pickupAt)} · ${item.code}`} badge={item.contractStatus} onOpen={() => onNavigate("/booking")} />
            )) : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nessuna uscita programmata.</p>}
          </CardContent>
        </Card>

        <Card className="saas-surface dashboard-enterprise-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Car className="h-4 w-4" /> Prossimi rientri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {nextReturns.length ? nextReturns.map((item: any) => (
              <CompactBookingRow key={item.id} title={item.customer} subtitle={item.vehicle} meta={`${formatDateTime(item.returnAt)} · Km: ${item.returnKm ?? "mancanti"}`} badge={item.contractStatus} onOpen={() => onNavigate("/booking")} />
            )) : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nessun rientro programmato.</p>}
          </CardContent>
        </Card>

        <Card className="saas-surface dashboard-enterprise-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" /> Prenotazioni critiche</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {criticalBookings.length ? criticalBookings.slice(0, 6).map((item: any) => (
              <CompactBookingRow key={`${item.bookingId}-${item.type}`} title={item.reason} subtitle={`${item.customer} · ${item.vehicle}`} meta={`${item.code} · ${formatDateTime(item.pickupAt)}`} badge={item.severity} onOpen={() => onNavigate("/booking")} />
            )) : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nessuna criticita booking.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="saas-surface dashboard-enterprise-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Gauge className="h-4 w-4" /> Occupazione flotta</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={utilization}>
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={chartAxisTick} />
                  <YAxis axisLine={false} tickLine={false} tick={chartAxisTick} />
                  <Tooltip cursor={false} isAnimationActive={false} wrapperStyle={{ pointerEvents: "none" }} contentStyle={chartTooltipStyle} />
                  <Area type="monotone" dataKey="utilization" name="Occupazione %" stroke="#2563eb" fill="#dbeafe" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="saas-surface dashboard-enterprise-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> Stato contratti</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {contractDistribution.map((item: any) => (
              <div key={item.status} className="flex items-center justify-between rounded-xl border border-border/80 bg-background/75 px-3 py-2">
                <span className="text-sm font-medium">{item.status}</span>
                <Badge variant={statusBadgeVariant(item.status)}>{item.count}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="saas-surface dashboard-enterprise-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Wrench className="h-4 w-4" /> Top veicoli noleggiati</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {topVehicles.length ? topVehicles.map((item: any) => (
              <div key={item.plate} className="rounded-xl border border-border/80 bg-background/75 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{item.plate}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.model}</p>
                  </div>
                  <p className="text-right text-sm font-semibold">{compactNumber(item.occupiedDays)} gg</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Ricavo: {formatCurrency(item.revenue)}</p>
              </div>
            )) : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nessun ranking veicoli.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export const DashboardPage = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<"overview" | "operations" | "activity">("overview");
  const [trendRange, setTrendRange] = useState<TrendRange>("30d");
  const [trendIndex, setTrendIndex] = useState(0);
  const { can, requiredPlan } = useEntitlements();
  const canReportsAdvanced = can("reports_advanced");

  const { data, loading, error } = useAsync(() => statsUseCases.dashboard(), []);
  const assignments = useAsync(() => stoppagesUseCases.assignmentSuggestions(), []);
  const costs = useAsync(() => stoppagesUseCases.costsSummary(), []);
  const escalations = useAsync(() => stoppagesUseCases.slaEscalations(), []);
  const preventive = useAsync(() => stoppagesUseCases.preventiveDue({ intervalDays: 180 }), []);
  const variance = useAsync(() => stoppagesUseCases.costsVariance(), []);

  const trendStats = useAsync(() => {
    if (!canReportsAdvanced) {
      return Promise.resolve({
        charts: {
          trendStoppages: []
        }
      });
    }
    const { start, end } = getRangeBounds(trendRange);
    return statsUseCases.analytics({
      dateFrom: start.toISOString(),
      dateTo: end.toISOString()
    });
  }, [canReportsAdvanced, trendRange]);

  const trendData = useMemo(
    () =>
      (trendStats.data?.charts?.trendStoppages ?? []).map((x: any) => ({
        day: typeof x.day === "string" ? x.day.slice(5) : "-",
        opened: Number(x.opened ?? 0),
        closed: Number(x.closed ?? 0),
        reminders: Number(x.reminders ?? 0),
        balance: Number(x.opened ?? 0) - Number(x.closed ?? 0)
      })),
    [trendStats.data]
  );

  const trendHasData = useMemo(
    () => trendData.length > 0,
    [trendData]
  );

  const activeTrendView = trendViews[trendIndex];
  const activeRangeLabel = rangeOptions.find((entry) => entry.value === trendRange)?.label ?? "30gg";

  const goPrevTrend = () => setTrendIndex((prev) => (prev - 1 + trendViews.length) % trendViews.length);
  const goNextTrend = () => setTrendIndex((prev) => (prev + 1) % trendViews.length);

  if (loading) return <FleetumBlockLoader label="Caricamento dashboard" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <section className="dashboard-enterprise space-y-4">
      <PageHeader
        title="Dashboard"
        subtitle="Panoramica manageriale: stato generale, priorita operative e attivita recenti."
        actions={
          <>
            <Button variant={view === "overview" ? "default" : "outline"} size="sm" onClick={() => setView("overview")}>
              Overview
            </Button>
            <Button variant={view === "operations" ? "default" : "outline"} size="sm" onClick={() => setView("operations")}>
              Operativita
            </Button>
            <Button variant={view === "activity" ? "default" : "outline"} size="sm" onClick={() => setView("activity")}>
              Attivita Recenti
            </Button>
          </>
        }
      />

      {view === "overview" ? (
        <>
          <div className="g-stats-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-12">
            <CardStat
              className="dashboard-enterprise-kpi xl:col-span-3"
              title="Fermi aperti"
              value={data.kpis.openStoppages}
              extra={<p className="mt-1 text-xs text-muted-foreground">Situazioni operative attive</p>}
            />
            <CardStat
              className="dashboard-enterprise-kpi xl:col-span-3"
              title="Critici aperti"
              value={data.kpis.criticalOpen}
              extra={<p className="mt-1 text-xs text-muted-foreground">Priorita alta da presidiare</p>}
            />
            <CardStat
              className="dashboard-enterprise-kpi xl:col-span-3"
              title="Overdue > 30gg"
              value={data.kpis.overdueOpen}
              extra={<p className="mt-1 text-xs text-muted-foreground">Da riallineare con officine</p>}
            />
            <CardStat
              className="dashboard-enterprise-kpi xl:col-span-3"
              title="Costo stimato cumulato"
              value={formatCurrency(costs.data?.kpis?.estimatedTotalCost)}
              valueClassName="font-semibold"
              extra={<p className="mt-1 text-xs text-muted-foreground">Impatto economico corrente</p>}
            />
          </div>

          <div className="g-charts-row grid gap-4 xl:grid-cols-3">
            <Card className="saas-surface dashboard-enterprise-card xl:col-span-2">
              <CardHeader className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-base">{activeTrendView.title}</CardTitle>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{activeTrendView.subtitle}</p>
                  </div>
                  <div
                    className={`flex items-center gap-1 rounded-xl border p-1 shadow-[0_12px_26px_-24px_rgba(15,23,42,0.4)] ${
                      canReportsAdvanced
                        ? "border-border/80 bg-background/70"
                        : "border-border/70 bg-muted/40 opacity-75"
                    }`}
                  >
                    {rangeOptions.map((option) => (
                      <Button
                        key={option.value}
                        size="sm"
                        variant={trendRange === option.value ? "default" : "ghost"}
                        className="h-7 px-3"
                        disabled={!canReportsAdvanced}
                        onClick={() => setTrendRange(option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <PremiumLockGate
                  feature="reports_advanced"
                  locked={!canReportsAdvanced}
                  requiredPlanOverride={requiredPlan("reports_advanced")}
                  title="Trend avanzati bloccati"
                  description="Analisi aperture/chiusure e reminder disponibile dal piano PRO."
                >
                  <div className="saas-chart-shell relative h-[320px] rounded-xl p-2">
                    {canReportsAdvanced ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="absolute left-2 top-1/2 z-10 h-8 w-8 -translate-y-1/2"
                          aria-label="Trend precedente"
                          onClick={goPrevTrend}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="absolute right-2 top-1/2 z-10 h-8 w-8 -translate-y-1/2"
                          aria-label="Trend successivo"
                          onClick={goNextTrend}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </>
                    ) : null}

                    <div className="h-full px-9 py-1">
                      {!canReportsAdvanced ? (
                        <div className="relative grid h-full place-items-center rounded-lg border border-dashed border-border/75 bg-gradient-to-b from-muted/30 to-muted/10">
                          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_85%,rgba(99,102,241,0.1),transparent_40%)]" />
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-300">Trend disponibile dal piano PRO</p>
                        </div>
                      ) : trendStats.loading ? (
                        <FleetumBlockLoader label="Caricamento trend" className="h-full min-h-0" />
                      ) : trendStats.error ? (
                        <div className="grid h-full place-items-center text-sm text-destructive">{trendStats.error}</div>
                      ) : !trendHasData ? (
                        <div className="grid h-full place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
                          Nessun dato trend disponibile per {activeRangeLabel}.
                        </div>
                      ) : trendIndex === 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={trendData}>
                            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={chartAxisTick} />
                            <YAxis axisLine={false} tickLine={false} tick={chartAxisTick} />
                            <Tooltip
                              cursor={false}
                              isAnimationActive={false}
                              wrapperStyle={{ pointerEvents: "none" }}
                              contentStyle={chartTooltipStyle}
                              labelStyle={{ color: "rgba(13,15,46,0.56)" }}
                            />
                            <Line type="monotone" dataKey="opened" stroke="#2563eb" strokeWidth={2} name="Aperti" />
                            <Line type="monotone" dataKey="closed" stroke="#059669" strokeWidth={2} name="Chiusi" />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : trendIndex === 1 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={trendData}>
                            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={chartAxisTick} />
                            <YAxis axisLine={false} tickLine={false} tick={chartAxisTick} />
                            <Tooltip
                              cursor={false}
                              isAnimationActive={false}
                              wrapperStyle={{ pointerEvents: "none" }}
                              contentStyle={chartTooltipStyle}
                              labelStyle={{ color: "rgba(13,15,46,0.56)" }}
                            />
                            <Bar dataKey="reminders" name="Reminder" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={trendData}>
                            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={chartAxisTick} />
                            <YAxis axisLine={false} tickLine={false} tick={chartAxisTick} />
                            <Tooltip
                              cursor={false}
                              isAnimationActive={false}
                              wrapperStyle={{ pointerEvents: "none" }}
                              contentStyle={chartTooltipStyle}
                              labelStyle={{ color: "rgba(13,15,46,0.56)" }}
                            />
                            <Line type="monotone" dataKey="balance" stroke="#d97706" strokeWidth={2} name="Saldo" />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Trend {trendIndex + 1}/3 · Range {activeRangeLabel}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {trendViews.map((_, idx) => (
                        <button
                          key={`trend-dot-${idx}`}
                          type="button"
                          onClick={() => setTrendIndex(idx)}
                          aria-label={`Vai al trend ${idx + 1}`}
                          className={`h-2.5 w-2.5 rounded-full transition ${idx === trendIndex ? "bg-primary" : "bg-muted"}`}
                        />
                      ))}
                    </div>
                  </div>
                </PremiumLockGate>
              </CardContent>
            </Card>

            <Card className="saas-surface dashboard-enterprise-card">
              <CardHeader>
                <CardTitle className="text-base">Alert prioritari</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(data.feeds.alerts || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nessun alert prioritario.</p>
                ) : (
                  data.feeds.alerts.slice(0, 6).map((alert: any) => (
                    <div key={alert.id} className="dashboard-enterprise-item rounded-lg border border-border/80 bg-background/75 p-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{alert.message}</p>
                        <Badge variant={alert.severity === "HIGH" ? "destructive" : alert.severity === "MEDIUM" ? "warning" : "secondary"}>
                          {alert.severity}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{alert.site} · {alert.workshop}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <BookingControlRoom booking={data.booking} onNavigate={navigate} />
        </>
      ) : null}

      {view === "operations" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <CardStat className="dashboard-enterprise-kpi" title="Totale fermi" value={data.kpis.totalStoppages} />
            <CardStat className="dashboard-enterprise-kpi" title="Nuovi fermi (30gg)" value={data.kpis.newStoppagesLast30} />
            <CardStat className="dashboard-enterprise-kpi" title="Chiusi (30gg)" value={data.kpis.closedLast30} />
            <CardStat className="dashboard-enterprise-kpi" title="Durata media chiusura" value={`${data.kpis.averageClosureDays} gg`} />
            <CardStat className="dashboard-enterprise-kpi" title="Escalation L3" value={escalations.data?.kpis?.level3 ?? 0} />
            <CardStat className="dashboard-enterprise-kpi" title="Preventiva gg in scadenza" value={preventive.data?.kpis?.dueSoonDays ?? 0} />
            <CardStat className="dashboard-enterprise-kpi" title="Preventiva gg scaduta" value={preventive.data?.kpis?.dueNowDays ?? 0} />
            <CardStat className="dashboard-enterprise-kpi" title="Preventiva km in scadenza" value={preventive.data?.kpis?.dueSoonKm ?? 0} />
            <CardStat className="dashboard-enterprise-kpi" title="Preventiva km scaduta" value={preventive.data?.kpis?.dueNowKm ?? 0} />
            <CardStat className="dashboard-enterprise-kpi" title="Scostamento costi" value={`EUR ${variance.data?.kpis?.varianceTotal ?? 0}`} />
          </div>

          <div className="g-charts-row grid gap-4 xl:grid-cols-3">
            <Card className="saas-surface dashboard-enterprise-card xl:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Distribuzione stati fermi</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.charts.byStatus.map((x: any) => ({ ...x, status: stoppageStatusLabel[x.status] ?? x.status }))}>
                      <XAxis dataKey="status" axisLine={false} tickLine={false} tick={chartAxisTick} />
                      <YAxis axisLine={false} tickLine={false} tick={chartAxisTick} />
                      <Tooltip
                        cursor={false}
                        isAnimationActive={false}
                        wrapperStyle={{ pointerEvents: "none" }}
                        contentStyle={chartTooltipStyle}
                        labelStyle={{ color: "rgba(13,15,46,0.56)" }}
                      />
                      <Bar dataKey="count" fill="#2563eb" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="saas-surface dashboard-enterprise-card">
              <CardHeader>
                <CardTitle className="text-base">Suggerimenti assegnazione</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(assignments.data?.suggestions ?? []).map((item: any) => (
                  <div key={item.userId} className="dashboard-enterprise-item rounded-lg border border-border/80 bg-background/75 p-2">
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.email}</p>
                    <p className="text-xs text-muted-foreground">Carico: {item.assignedCount} fermi · peso {item.weightedLoad}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      {view === "activity" ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="saas-surface dashboard-enterprise-card">
            <CardHeader>
              <CardTitle className="text-base">Ultimi utenti iscritti</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.feeds.recentUsers.map((user: any) => (
                <div key={user.id} className="dashboard-enterprise-item rounded-lg border border-border/80 bg-background/75 p-2">
                  <p className="text-sm font-medium">{user.firstName} {user.lastName}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="saas-surface dashboard-enterprise-card">
            <CardHeader>
              <CardTitle className="text-base">Ultimi fermi creati</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.feeds.recentStoppages.map((row: any) => (
                <div key={row.id} className="dashboard-enterprise-item rounded-lg border border-border/80 bg-background/75 p-2">
                  <p className="text-sm font-medium">{row.plate} · {row.brand} {row.model}</p>
                  <p className="text-xs text-muted-foreground">{row.site} · {row.workshop}</p>
                  <p className="text-xs text-muted-foreground">{row.reason}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="saas-surface dashboard-enterprise-card">
            <CardHeader>
              <CardTitle className="text-base">Ultimi reminder inviati</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.feeds.recentReminders.map((reminder: any) => (
                <div key={reminder.id} className="dashboard-enterprise-item rounded-lg border border-border/80 bg-background/75 p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{reminder.plate}</p>
                    <Badge variant={reminder.success ? "success" : "destructive"}>{reminder.success ? "OK" : "KO"}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{reminder.type} · {reminder.channel}</p>
                  <p className="text-xs text-muted-foreground">{new Date(reminder.sentAt).toLocaleString("it-IT")}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </section>
  );
};
