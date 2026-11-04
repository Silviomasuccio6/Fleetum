import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarDays, Car, ChevronLeft, ChevronRight, Gauge, ShieldCheck, Wrench } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { stoppagesUseCases } from "../../../application/usecases/stoppages-usecases";
import { statsUseCases } from "../../../application/usecases/stats-usecases";
import { stoppageStatusLabel } from "../../../domain/constants/stoppage-status";
import { FleetumBlockLoader } from "../../components/brand/fleetum-logo-loader";
import { CardStat } from "../../components/common/table";
import { WorkspacePageHeader } from "../../components/ui/workspace-ui";
import { DashboardOverview } from "../../components/dashboard/dashboard-overview";
import { useAuthStore } from "../../../application/stores/auth-store";
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
  fill: "currentColor",
  fontSize: 11,
  fontFamily: "Inter, sans-serif"
};

const chartTooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid var(--ws-line)",
  borderRadius: 10,
  boxShadow: "var(--ws-soft-shadow)",
  color: "hsl(var(--foreground))"
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

export const DashboardPage = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<"overview" | "operations" | "activity">("overview");
  const [trendRange, setTrendRange] = useState<TrendRange>("30d");
  const [trendIndex, setTrendIndex] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const permissions = useAuthStore(state => state.user?.permissions) ?? [];
  const has = (permission: string) => permissions.includes("*") || permissions.includes(permission);
  const { can, loaded: entitlementsLoaded } = useEntitlements();
  const canReadDashboard = has("stats:read") && can("reports_basic");
  const canReadStoppages = canReadDashboard && has("stoppages:read");
  const canOpenBookings = has("vehicles:read");
  const refresh = () => setReloadKey(key => key + 1);
  const secondaryMetric = (query: { loading: boolean; error: string | null }, value: unknown, suffix = "") =>
    query.loading || query.error || value === undefined || value === null ? "—" : `${value}${suffix}`;
  const canReportsAdvanced = canReadDashboard && can("reports_advanced");

  const { data, loading, error } = useAsync(() => canReadDashboard ? statsUseCases.dashboard() : Promise.resolve(null), [canReadDashboard, reloadKey]);
  const assignments = useAsync(() => canReadStoppages ? stoppagesUseCases.assignmentSuggestions() : Promise.resolve(null), [canReadStoppages, reloadKey]);
  const costs = useAsync(() => canReadStoppages ? stoppagesUseCases.costsSummary() : Promise.resolve(null), [canReadStoppages, reloadKey]);
  const escalations = useAsync(() => canReadStoppages ? stoppagesUseCases.slaEscalations() : Promise.resolve(null), [canReadStoppages, reloadKey]);
  const preventive = useAsync(() => canReadStoppages ? stoppagesUseCases.preventiveDue({ intervalDays: 180 }) : Promise.resolve(null), [canReadStoppages, reloadKey]);
  const variance = useAsync(() => canReadStoppages ? stoppagesUseCases.costsVariance() : Promise.resolve(null), [canReadStoppages, reloadKey]);

  const trendStats = useAsync(() => {
    if (!canReportsAdvanced) {
      return Promise.resolve({
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
      });
    }
    const { start, end } = getRangeBounds(trendRange);
    return statsUseCases.analytics({
      dateFrom: start.toISOString(),
      dateTo: end.toISOString()
    });
  }, [canReportsAdvanced, trendRange, reloadKey]);

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

  if (!entitlementsLoaded) return <FleetumBlockLoader label="Caricamento autorizzazioni dashboard" />;
  if (!canReadDashboard) return <section className="dashboard-workspace dashboard-access-state"><h1>Dashboard</h1><p>Il tuo ruolo o piano non consente di visualizzare questa sezione.</p></section>;
  if (loading) return <FleetumBlockLoader label="Caricamento dashboard" />;
  if (error) return <section className="dashboard-workspace dashboard-access-state" aria-label="Errore dashboard"><h1>Dashboard non disponibile</h1><p role="alert">{error}</p><Button onClick={refresh}>Riprova dashboard</Button></section>;
  if (!data) return <FleetumBlockLoader label="Preparazione dashboard" />;

  return (
    <section className="dashboard-workspace dashboard-enterprise space-y-5" aria-label="Dashboard operativa">
      <WorkspacePageHeader eyebrow="LA TUA ATTIVITÀ" title="Dashboard" description="Le priorità di oggi, la flotta e l’andamento del noleggio." actions={<><Button variant="outline" onClick={refresh}>Aggiorna dashboard</Button>{canOpenBookings ? <Button onClick={() => navigate("/booking")}>Apri prenotazioni</Button> : null}</>} />
      <div className="dashboard-view-switch" role="group" aria-label="Vista dashboard">
        {([['overview', 'Panoramica'], ['operations', 'Fermi e manutenzioni'], ['activity', 'Attività recenti']] as const).map(([key, label]) => <Button key={key} variant={view === key ? "default" : "ghost"} aria-pressed={view === key} onClick={() => setView(key)}>{label}</Button>)}
      </div>
      {canReadStoppages && [assignments, costs, escalations, preventive, variance].some(query => query.error) ? <div className="dashboard-notice" role="status">Alcuni dati di fermi o manutenzioni non sono disponibili. I riepiloghi senza dati mostrano un trattino.<Button variant="outline" onClick={refresh}>Riprova sezioni</Button></div> : null}

      {view === "overview" ? (
        <>
          <DashboardOverview booking={data.booking} onNavigate={navigate} canOpenBookings={canOpenBookings} canOpenCustomers={canOpenBookings} />
          <details className="dashboard-technical-summary"><summary>Fermi tecnici: riepilogo e trend</summary><div className="dashboard-technical-content">
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
              value={costs.loading || costs.error || !canReadStoppages ? "—" : formatCurrency(costs.data?.kpis?.estimatedTotalCost)}
              valueClassName="font-semibold"
              extra={<p className="mt-1 text-xs text-muted-foreground">Impatto economico corrente</p>}
            />
          </div>

          <div className={`g-charts-row grid gap-4 ${canReportsAdvanced ? "xl:grid-cols-3" : "xl:grid-cols-1"}`}>
            {canReportsAdvanced ? (
              <Card className="saas-surface dashboard-enterprise-card xl:col-span-2">
              <CardHeader className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-base">{activeTrendView.title}</CardTitle>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{activeTrendView.subtitle}</p>
                  </div>
                  <div className="flex items-center gap-1 rounded-xl border border-border/80 bg-background/70 p-1 shadow-[0_12px_26px_-24px_rgba(15,23,42,0.4)]">
                    {rangeOptions.map((option) => (
                      <Button
                        key={option.value}
                        size="sm"
                        variant={trendRange === option.value ? "default" : "ghost"}
                        className="h-7 px-3"
                        aria-pressed={trendRange === option.value}
                        onClick={() => setTrendRange(option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                  <div className="saas-chart-shell relative h-[320px] rounded-xl p-2">
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

                    <div className="h-full px-9 py-1">
                      {trendStats.loading ? (
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
                              labelStyle={{ color: "hsl(var(--foreground))" }}
                            />
                            <Line type="linear" dataKey="opened" stroke="var(--dashboard-blue)" strokeWidth={2} name="Aperti" isAnimationActive={false} />
                            <Line type="linear" dataKey="closed" stroke="var(--dashboard-teal)" strokeWidth={2} name="Chiusi" isAnimationActive={false} />
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
                              labelStyle={{ color: "hsl(var(--foreground))" }}
                            />
                            <Bar dataKey="reminders" name="Reminder" fill="var(--dashboard-amber)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
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
                              labelStyle={{ color: "hsl(var(--foreground))" }}
                            />
                            <Line type="linear" dataKey="balance" stroke="var(--dashboard-amber)" strokeWidth={2} name="Saldo" isAnimationActive={false} />
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
                          aria-pressed={idx === trendIndex}
                          className={`h-11 w-11 rounded-full border transition ${idx === trendIndex ? "bg-primary" : "bg-muted"}`}
                        />
                      ))}
                    </div>
                  </div>
              </CardContent>
              </Card>
            ) : null}

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

          </div></details>
        </>
      ) : null}

      {view === "operations" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <CardStat className="dashboard-enterprise-kpi" title="Totale fermi" value={data.kpis.totalStoppages} />
            <CardStat className="dashboard-enterprise-kpi" title="Nuovi fermi (30gg)" value={data.kpis.newStoppagesLast30} />
            <CardStat className="dashboard-enterprise-kpi" title="Chiusi (30gg)" value={data.kpis.closedLast30} />
            <CardStat className="dashboard-enterprise-kpi" title="Durata media chiusura" value={`${data.kpis.averageClosureDays} gg`} />
            <CardStat className="dashboard-enterprise-kpi" title="Escalation L3" value={secondaryMetric(escalations, escalations.data?.kpis?.level3)} />
            <CardStat className="dashboard-enterprise-kpi" title="Preventiva gg in scadenza" value={secondaryMetric(preventive, preventive.data?.kpis?.dueSoonDays)} />
            <CardStat className="dashboard-enterprise-kpi" title="Preventiva gg scaduta" value={secondaryMetric(preventive, preventive.data?.kpis?.dueNowDays)} />
            <CardStat className="dashboard-enterprise-kpi" title="Preventiva km in scadenza" value={secondaryMetric(preventive, preventive.data?.kpis?.dueSoonKm)} />
            <CardStat className="dashboard-enterprise-kpi" title="Preventiva km scaduta" value={secondaryMetric(preventive, preventive.data?.kpis?.dueNowKm)} />
            <CardStat className="dashboard-enterprise-kpi" title="Scostamento costi" value={variance.loading || variance.error || !canReadStoppages ? "—" : formatCurrency(variance.data?.kpis?.varianceTotal)} />
          </div>

          <div className="g-charts-row grid gap-4 xl:grid-cols-3">
            <Card className="saas-surface dashboard-enterprise-card xl:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Distribuzione stati fermi</CardTitle>
              </CardHeader>
              <CardContent>
                {!data.charts.byStatus.length ? <p className="dashboard-empty">Nessun fermo nel periodo.</p> : <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.charts.byStatus.map((x: any) => ({ ...x, status: stoppageStatusLabel[x.status] ?? x.status }))}>
                      <XAxis dataKey="status" axisLine={false} tickLine={false} tick={chartAxisTick} />
                      <YAxis axisLine={false} tickLine={false} tick={chartAxisTick} />
                      <Tooltip
                        cursor={false}
                        isAnimationActive={false}
                        wrapperStyle={{ pointerEvents: "none" }}
                        contentStyle={chartTooltipStyle}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                      />
                      <Bar dataKey="count" fill="var(--dashboard-blue)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>}
              </CardContent>
            </Card>

            <Card className="saas-surface dashboard-enterprise-card">
              <CardHeader>
                <CardTitle className="text-base">Suggerimenti assegnazione</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {!canReadStoppages ? <p className="dashboard-empty">Sezione riservata ai ruoli con accesso ai fermi.</p> : assignments.loading ? <p role="status">Caricamento assegnazioni...</p> : assignments.error ? <p role="alert">{assignments.error}</p> : !(assignments.data?.suggestions ?? []).length ? <p className="dashboard-empty">Nessun suggerimento di assegnazione.</p> : null}
                {(assignments.error || assignments.loading || !canReadStoppages ? [] : assignments.data?.suggestions ?? []).map((item: any) => (
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
              {!data.feeds.recentUsers.length ? <p className="dashboard-empty">Nessun utente recente.</p> : null}
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
              {!data.feeds.recentStoppages.length ? <p className="dashboard-empty">Nessun fermo recente.</p> : null}
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
              {!data.feeds.recentReminders.length ? <p className="dashboard-empty">Nessun reminder recente.</p> : null}
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
