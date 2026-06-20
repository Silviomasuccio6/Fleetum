import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, Crown, Lock, SlidersHorizontal } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { statsUseCases } from "../../../application/usecases/stats-usecases";
import { stoppageStatusLabel } from "../../../domain/constants/stoppage-status";
import { cn } from "../../../lib/utils";
import { CardStat } from "../../components/common/table";
import { PremiumLockGate } from "../../components/common/premium-lock-gate";
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

const toPercent = (current: number, previous: number) => {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
};

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
  const navigate = useNavigate();
  const location = useLocation();
  const { can, requiredPlan } = useEntitlements();
  const canViewVehicleEconomics = useAuthStore((state) => state.user?.permissions.includes("vehicle:economics:read") ?? false);
  const canExportReports = useAuthStore((state) => state.user?.permissions.includes("reports:export") ?? false);
  const canReportsAdvanced = can("reports_advanced");
  const canAdvancedFilters = can("advanced_filters");
  const canExportCsv = can("export_csv");
  const lockWholePage = !canReportsAdvanced;

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

  const masterData = useAsync(
    () => Promise.all([
      masterDataUseCases.listSites({ page: 1, pageSize: 200 }),
      masterDataUseCases.listWorkshops({ page: 1, pageSize: 200 }),
      masterDataUseCases.listVehicles({ page: 1, pageSize: 200 })
    ]),
    []
  );

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

  const stats = useAsync(
    () => (canReportsAdvanced ? statsUseCases.analytics(analyticsParams) : Promise.resolve(emptyAnalytics)),
    [analyticsParams, canReportsAdvanced, refreshKey, emptyAnalytics]
  );

  const previousStats = useAsync(
    () => (canReportsAdvanced ? statsUseCases.analytics(previousParams) : Promise.resolve(emptyAnalytics)),
    [previousParams, canReportsAdvanced, refreshKey, emptyAnalytics]
  );

  const sites = masterData.data?.[0]?.data ?? [];
  const workshops = masterData.data?.[1]?.data ?? [];
  const vehicles = masterData.data?.[2]?.data ?? [];
  const data = stats.data ?? emptyAnalytics;
  const prev = previousStats.data ?? emptyAnalytics;
  const [profitVehicleId, setProfitVehicleId] = useState(() => new URLSearchParams(location.search).get("vehicleId") ?? "");

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

  const profitability = useAsync(
    () => (canReportsAdvanced && canViewVehicleEconomics ? statsUseCases.vehicleProfitability(profitabilityParams) : Promise.resolve(null)),
    [profitabilityParams, canReportsAdvanced, canViewVehicleEconomics, refreshKey]
  );

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

  const applyFilters = () => setFilters(draftFilters);

  const downloadXlsx = async () => {
    const blob = await statsUseCases.downloadAnalyticsXlsx(analyticsParams);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gestione-fermi-report-enterprise-${buildExportFilenameDate()}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadCsv = async () => {
    const blob = await statsUseCases.downloadAnalyticsCsv(analyticsParams);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gestione-fermi-report-analytics-${buildExportFilenameDate()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadVehicleProfitability = async (format: "pdf" | "xlsx" | "csv") => {
    const blob = await statsUseCases.downloadVehicleProfitability(format, profitabilityParams);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fleetum-report-redditivita-veicolo-${buildExportFilenameDate()}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const kpis = [
    {
      label: "Fermi aperti",
      value: formatNumber(data.kpis.openStoppages),
      delta: toPercent(data.kpis.openStoppages, prev.kpis.openStoppages),
      inverse: true
    },
    {
      label: "Tempo medio fermo",
      value: `${data.kpis.averageClosureDays} gg`,
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
      value: `${data.kpis.closureRateWithin7Days}%`,
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
      value: `${data.kpis.reminderSuccessRate}%`,
      delta: toPercent(data.kpis.reminderSuccessRate, prev.kpis.reminderSuccessRate),
      inverse: false
    }
  ];

  return (
    <section className="relative space-y-4">
      <div className={cn("space-y-4", lockWholePage && "pointer-events-none select-none blur-[3px] saturate-[0.84] opacity-60")}>
        <div className="sticky top-16 z-20 flex justify-end">
          <div className="relative">
            <Button variant="outline" className="h-8" onClick={() => setFiltersOpen((old) => !old)}>
              <SlidersHorizontal className="h-4 w-4" />
              Filtri
              {filtersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            {filtersOpen ? (
            <div className="absolute right-0 top-10 z-30 w-[min(1120px,calc(100vw-2rem))] rounded-2xl border border-border/80 bg-card/98 p-4 shadow-lg backdrop-blur">
              <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
              <div className="grid gap-1.5">
                <Label>Periodo</Label>
                <Select value={periodPreset} onChange={(event) => applyPeriodPreset(event.target.value as PeriodPreset)}>
                  <option value="7d">Ultimi 7 giorni</option>
                  <option value="15d">Ultimi 15 giorni</option>
                  <option value="30d">Ultimi 30 giorni</option>
                  <option value="90d">Ultimi 90 giorni</option>
                  <option value="month">Mese corrente</option>
                  <option value="quarter">Trimestre corrente</option>
                  <option value="custom">Personalizzato</option>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Dal</Label>
                <Input
                  type="date"
                  value={draftFilters.dateFrom}
                  onChange={(event) => {
                    setPeriodPreset("custom");
                    setDraftFilters((old) => ({ ...old, dateFrom: event.target.value }));
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Al</Label>
                <Input
                  type="date"
                  value={draftFilters.dateTo}
                  onChange={(event) => {
                    setPeriodPreset("custom");
                    setDraftFilters((old) => ({ ...old, dateTo: event.target.value }));
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Sede</Label>
                <Select value={draftFilters.siteId} onChange={(event) => setDraftFilters((old) => ({ ...old, siteId: event.target.value }))}>
                  <option value="">Tutte</option>
                  {sites.map((site: any) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Officina</Label>
                <Select
                  value={draftFilters.workshopId}
                  onChange={(event) => setDraftFilters((old) => ({ ...old, workshopId: event.target.value }))}
                >
                  <option value="">Tutte</option>
                  {workshops.map((workshop: any) => (
                    <option key={workshop.id} value={workshop.id}>
                      {workshop.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Stato</Label>
                <Select value={draftFilters.status} onChange={(event) => setDraftFilters((old) => ({ ...old, status: event.target.value }))}>
                  <option value="">Tutti</option>
                  {Object.entries(stoppageStatusLabel).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {canAdvancedFilters ? (
              <div className="grid gap-2 md:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label>Targa</Label>
                  <Input
                    value={draftFilters.plate}
                    onChange={(event) => setDraftFilters((old) => ({ ...old, plate: event.target.value }))}
                    placeholder="AB123CD"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Marca</Label>
                  <Input
                    value={draftFilters.brand}
                    onChange={(event) => setDraftFilters((old) => ({ ...old, brand: event.target.value }))}
                    placeholder="Iveco"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Modello</Label>
                  <Input
                    value={draftFilters.model}
                    onChange={(event) => setDraftFilters((old) => ({ ...old, model: event.target.value }))}
                    placeholder="Daily"
                  />
                </div>
              </div>
            ) : canReportsAdvanced ? (
              <PremiumLockGate
                feature="advanced_filters"
                locked={!canAdvancedFilters}
                requiredPlanOverride={requiredPlan("advanced_filters")}
                compact
                title="Filtri avanzati bloccati"
                description="Ricerca per targa, marca e modello disponibile dal piano PRO."
              >
                <div className="grid gap-2 md:grid-cols-3">
                  <Input value="" placeholder="Targa" disabled />
                  <Input value="" placeholder="Marca" disabled />
                  <Input value="" placeholder="Modello" disabled />
                </div>
              </PremiumLockGate>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {canExportCsv && canExportReports ? (
                <Button variant="default" onClick={downloadXlsx}>
                  Export Enterprise XLSX
                </Button>
              ) : null}
              {canExportCsv && canExportReports ? (
                <Button variant="outline" onClick={downloadCsv}>
                  Export CSV
                </Button>
              ) : null}
              <Button variant="outline" onClick={resetFilters}>
                Reset
              </Button>
              <Button variant="default" onClick={applyFilters}>
                Applica filtri
              </Button>
              <Button variant="secondary" onClick={() => setRefreshKey((old) => old + 1)}>
                Aggiorna dati
              </Button>
            </div>
              </div>
            </div>
            ) : null}
          </div>
        </div>

        <Card className="saas-surface border-blue-500/20 bg-gradient-to-br from-white to-blue-50/45 shadow-sm dark:from-slate-950 dark:to-blue-950/25">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Report redditivita veicolo</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Analizza fatturato generato, giorni noleggiati e recupero investimento per ogni auto della flotta.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void downloadVehicleProfitability("pdf")} disabled={!canReportsAdvanced || !canViewVehicleEconomics || !canExportReports}>
                  PDF
                </Button>
                <Button variant="outline" onClick={() => void downloadVehicleProfitability("xlsx")} disabled={!canReportsAdvanced || !canViewVehicleEconomics || !canExportReports}>
                  Excel
                </Button>
                <Button variant="outline" onClick={() => void downloadVehicleProfitability("csv")} disabled={!canReportsAdvanced || !canViewVehicleEconomics || !canExportReports}>
                  CSV
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="grid gap-1.5">
                <Label>Veicolo</Label>
                <Select value={profitVehicleId} onChange={(event) => setProfitVehicleId(event.target.value)}>
                  <option value="">Tutti i veicoli</option>
                  {vehicles.map((vehicle: any) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.plate} · {vehicle.brand} {vehicle.model}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rounded-2xl border bg-card px-4 py-3 text-xs text-muted-foreground">
                Base dato: booking, contratti e pricing snapshot. ROI indicativo se il prezzo acquisto e i costi sono configurati.
              </div>
            </div>

            {profitability.error ? (
              <p className="text-sm text-destructive">{profitability.error}</p>
            ) : null}

            {!canViewVehicleEconomics ? (
              <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                I dati economici dei veicoli sono riservati agli amministratori e ai responsabili autorizzati.
              </div>
            ) : profitability.data ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                  <CardStat title="Fatturato generato" value={formatCurrency(profitability.data.summary.totalRevenue)} />
                  <CardStat title="Giorni noleggiati" value={formatNumber(profitability.data.summary.rentedDays)} />
                  <CardStat title="Occupazione" value={`${profitability.data.summary.utilizationRate ?? 0}%`} />
                  <CardStat title="Margine stimato" value={formatCurrency(profitability.data.summary.grossMargin)} />
                  <CardStat
                    title="Investimento recuperato"
                    value={profitability.data.investment.recoveredPercentage == null ? "n/d" : `${profitability.data.investment.recoveredPercentage}%`}
                  />
                  <CardStat
                    title="Residuo break-even"
                    value={profitability.data.investment.remainingToBreakEven == null ? "n/d" : formatCurrency(profitability.data.investment.remainingToBreakEven)}
                  />
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="h-[280px] rounded-2xl border bg-card p-3">
                    {profitability.data.trend?.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={profitability.data.trend}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="month" />
                          <YAxis />
                          <Tooltip cursor={false} isAnimationActive={false} wrapperStyle={{ pointerEvents: "none" }} />
                          <Bar dataKey="revenue" fill="#2563ff" radius={[6, 6, 0, 0]} name="Ricavi" />
                          <Bar dataKey="costs" fill="#00b8a9" radius={[6, 6, 0, 0]} name="Costi" />
                          <Line dataKey="margin" stroke="#07111f" strokeWidth={2.4} dot={false} name="Margine" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="grid h-full place-items-center text-sm text-muted-foreground">Nessun trend economico nel periodo selezionato.</div>
                    )}
                  </div>

                  <Card className="border-dashed">
                    <CardContent className="space-y-3 pt-4 text-sm">
                      <p className="font-semibold">Insight operativi</p>
                      <p>
                        {profitability.data.investment.purchasePrice
                          ? `Investimento configurato: ${formatCurrency(profitability.data.investment.purchasePrice)}.`
                          : "Prezzo acquisto non configurato: inseriscilo nella scheda veicolo per calcolare ROI e break-even."}
                      </p>
                      <p>
                        {profitability.data.investment.breakEvenReached === true
                          ? "Break-even raggiunto sul periodo/dati disponibili."
                          : profitability.data.investment.remainingToBreakEven != null
                            ? `Mancano ${formatCurrency(profitability.data.investment.remainingToBreakEven)} al break-even.`
                            : "Break-even non stimabile con i dati attuali."}
                      </p>
                      <p className="text-xs text-muted-foreground">{profitability.data.dataQuality?.notes?.[0]}</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="overflow-hidden rounded-2xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Veicolo</TableHead>
                        <TableHead>Sede</TableHead>
                        <TableHead>Ricavi</TableHead>
                        <TableHead>Costi</TableHead>
                        <TableHead>Margine</TableHead>
                        <TableHead>Giorni</TableHead>
                        <TableHead>ROI</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profitability.data.vehicles?.slice(0, 8).map((vehicle: any) => (
                        <TableRow key={vehicle.vehicleId}>
                          <TableCell className="font-medium">{vehicle.plate} · {vehicle.brand} {vehicle.model}</TableCell>
                          <TableCell>{vehicle.siteName ?? "-"}</TableCell>
                          <TableCell>{formatCurrency(vehicle.revenue)}</TableCell>
                          <TableCell>{formatCurrency(vehicle.costs)}</TableCell>
                          <TableCell>{formatCurrency(vehicle.margin)}</TableCell>
                          <TableCell>{formatNumber(vehicle.rentedDays)}</TableCell>
                          <TableCell>{vehicle.recoveredPercentage == null ? "n/d" : `${vehicle.recoveredPercentage}%`}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                Caricamento report redditivita veicolo...
              </div>
            )}
          </CardContent>
        </Card>

        {stats.error ? (
          <Card className="border-destructive/35">
            <CardContent className="py-4">
              <p className="text-sm text-destructive">{stats.error}</p>
            </CardContent>
          </Card>
        ) : null}

        <div className="g-stats-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {kpis.map((kpi) => {
            const positive = (kpi.delta ?? 0) >= 0;
            const isGood = kpi.inverse ? !positive : positive;
            const tone = isGood ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300";
            const DeltaIcon = positive ? ArrowUpRight : ArrowDownRight;
            return (
              <CardStat
                key={kpi.label}
                title={kpi.label}
                value={kpi.value}
                className="h-full min-h-[128px]"
                extra={
                  <p className={cn("inline-flex items-center gap-1 text-xs font-semibold", tone)}>
                    <DeltaIcon className="h-3.5 w-3.5" />
                    {formatDelta(kpi.delta)} vs periodo precedente
                  </p>
                }
              />
            );
          })}
        </div>

        <Card className="saas-surface">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Trend giornaliero: aperti, chiusi e reminder</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[310px]">
                {trendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis />
                      <Tooltip cursor={false} isAnimationActive={false} wrapperStyle={{ pointerEvents: "none" }} />
                      <Bar dataKey="opened" fill="#2563eb" radius={[6, 6, 0, 0]} name="Aperti" />
                      <Bar dataKey="closed" fill="#059669" radius={[6, 6, 0, 0]} name="Chiusi" />
                      <Line dataKey="reminders" stroke="#f59e0b" strokeWidth={2.2} dot={false} name="Reminder" />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="grid h-full place-items-center text-sm text-muted-foreground">Nessun dato trend nel periodo selezionato.</div>
                )}
              </div>
              <div className="mt-3 rounded-lg border border-border/80 bg-card/80 px-3 py-2 text-xs text-muted-foreground">
                {hasTrendData
                  ? "Trend aggiornato correttamente sul periodo selezionato."
                  : "Nel periodo selezionato i valori sono tutti a zero: prova ad allargare il periodo o rimuovere i filtri."}
              </div>
            </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="saas-surface">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Top officine per numero fermi</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                {workshopData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={workshopData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" hide />
                      <YAxis />
                      <Tooltip cursor={false} isAnimationActive={false} wrapperStyle={{ pointerEvents: "none" }} />
                      <Bar dataKey="count" fill="#0ea5e9" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="grid h-full place-items-center text-sm text-muted-foreground">Nessun dato officine.</div>
                )}
              </div>
              {workshopData.length > 0 ? (
                <div className="mt-3 space-y-1.5">
                  {workshopData.slice(0, 4).map((row: any) => (
                    <div key={`ws-${row.name}`} className="flex items-center justify-between rounded-md border border-border/80 bg-card/80 px-2 py-1.5 text-xs">
                      <span className="text-muted-foreground">{row.name}</span>
                      <span className="font-semibold text-foreground">{row.count}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="saas-surface">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Distribuzione priorità</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                {priorityData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={priorityData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="priorityLabel" />
                      <YAxis />
                      <Tooltip cursor={false} isAnimationActive={false} wrapperStyle={{ pointerEvents: "none" }} />
                      <Bar dataKey="count" fill="#7c3aed" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="grid h-full place-items-center text-sm text-muted-foreground">Nessun dato priorità.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <Card className="saas-surface">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Dettaglio fermi aperti</CardTitle>
                <div className="flex items-center gap-2">
                  <Input
                    value={detailQuery}
                    onChange={(event) => setDetailQuery(event.target.value)}
                    placeholder="Cerca per targa, sede, officina..."
                    className="h-8 w-[260px]"
                  />
                  <Select value={detailSort} onChange={(event) => setDetailSort(event.target.value as DetailSort)} className="h-8">
                    <option value="openDays_desc">Giorni aperto: alto → basso</option>
                    <option value="openDays_asc">Giorni aperto: basso → alto</option>
                    <option value="plate_asc">Targa: A → Z</option>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table className="[&_th]:py-1.5 [&_td]:py-1.5 [&_td]:text-[12px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Veicolo</TableHead>
                    <TableHead>Sede</TableHead>
                    <TableHead>Officina</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>Priorità</TableHead>
                    <TableHead className="text-right">Giorni aperto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLongestOpen.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                        Nessun fermo aperto trovato con i criteri selezionati.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLongestOpen.map((row: any) => (
                      <TableRow key={row.id}>
                        <TableCell className="leading-tight">
                          <p className="font-semibold text-foreground">{row.plate}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {row.brand} {row.model}
                          </p>
                        </TableCell>
                        <TableCell>{row.site}</TableCell>
                        <TableCell>{row.workshop}</TableCell>
                        <TableCell>
                          <Badge variant={(statusAccent[row.status] as any) || "secondary"}>
                            {stoppageStatusLabel[row.status] ?? row.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{priorityLabel[row.priority] ?? row.priority}</TableCell>
                        <TableCell className="text-right font-semibold">{row.openDays}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="saas-surface">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Top veicoli per fermo cumulato</CardTitle>
            </CardHeader>
              <CardContent className="space-y-1.5">
                {topVehicles.length > 0 ? (
                  topVehicles.map((row: any) => (
                    <div
                      key={`${row.plate}-${row.model}`}
                      className="flex items-center justify-between rounded-md border border-border/80 bg-card/80 px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-foreground">{row.plate}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {row.brand} {row.model}
                        </p>
                      </div>
                      <div className="text-right text-[11px] text-muted-foreground">
                        <p>{row.count} fermi</p>
                        <p className="font-semibold text-foreground">{row.openDays} gg</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Nessun dato disponibile.</p>
                )}
              </CardContent>
            </Card>

            <Card className="saas-surface">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Reminder falliti</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="h-8 w-full justify-between" onClick={() => setReminderDetailsOpen((old) => !old)}>
                  <span>Apri dettagli reminder falliti</span>
                  {reminderDetailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
                {reminderDetailsOpen ? (
                  reminderFailures.length > 0 ? (
                    reminderFailures.map((row: any) => (
                      <div key={row.id} className="rounded-lg border border-rose-300/50 bg-rose-50/60 p-2 dark:border-rose-500/40 dark:bg-rose-500/10">
                        <p className="text-sm font-semibold text-foreground">{row.recipient}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.type} · {new Date(row.sentAt).toLocaleString("it-IT")}
                        </p>
                        <p className="text-xs text-rose-700 dark:text-rose-300">{row.errorMessage || "Errore non specificato"}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">Nessun reminder fallito nel periodo filtrato.</p>
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">Clicca sul pulsante per mostrare il dettaglio.</p>
                )}
              </CardContent>
            </Card>

            <Card className="saas-surface">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Distribuzione sedi</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {siteData.length > 0 ? (
                  siteData.map((row: any) => (
                    <div key={row.name} className="flex items-center justify-between rounded-md border border-border/80 bg-card/80 px-2 py-1.5 text-xs">
                      <span className="text-muted-foreground">{row.name}</span>
                      <span className="font-semibold text-foreground">{row.count}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Nessun dato sedi.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {lockWholePage ? (
        <div className="pointer-events-none fixed bottom-0 left-0 right-0 top-16 z-30 lg:left-72">
          <div className="absolute inset-0 bg-background/28 backdrop-blur-[2px]" />
          <div className="absolute inset-x-0 top-[26vh] flex justify-center px-4">
            <div className="pointer-events-auto w-full max-w-[520px] rounded-2xl border border-violet-300/55 bg-card/93 p-5 text-center shadow-xl backdrop-blur-md">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-300">
                <Lock className="h-5 w-5" />
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">Report avanzati bloccati</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Questa sezione richiede il piano PRO. Passa a PRO per sbloccare trend, KPI avanzati ed export.
              </p>
              <Button
                type="button"
                className="mt-4 h-11 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-500 to-fuchsia-500 px-6 font-semibold text-white shadow-[0_10px_28px_rgba(124,58,237,0.38)] hover:brightness-110"
                onClick={() => navigate("/upgrade")}
              >
                <Crown className="h-4 w-4" />
                PASSA A PRO
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
