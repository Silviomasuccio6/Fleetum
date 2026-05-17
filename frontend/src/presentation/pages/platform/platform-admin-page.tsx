import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock3,
  PanelLeftClose,
  RefreshCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
  XCircle,
  Zap
} from "lucide-react";
import {
  LicenseStatus,
  PlatformDashboardLiveMetrics,
  platformAdminUseCases,
  PlatformRevenueMetrics,
  QuickAction
} from "../../../application/usecases/platform/platform-admin-usecases";
import { snackbar } from "../../../application/stores/snackbar-store";
import { FleetumInlineLoader } from "../../components/brand/fleetum-logo-loader";
import { PlatformEventItem } from "../../components/platform/platform-event-item";
import { PlatformKpiCard } from "../../components/platform/platform-kpi-card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { useNavigate } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  buildPlanUpdatePayload,
  clearPlanDraft,
  hasPlanChange,
  isPlanDowngrade,
  isPlanTier,
  normalizePlanTier,
  PLAN_TIERS,
  PlanTier,
  rollbackPlanDraft
} from "./platform-plan-actions";

type TenantRow = {
  id: string;
  name: string;
  company?: {
    legalName?: string | null;
    tradeName?: string | null;
    vatNumber?: string | null;
    email?: string | null;
    phone?: string | null;
    hasLogo?: boolean;
    profileCompleted?: boolean;
    onboardingStatus?: "COMPLETE" | "INCOMPLETE" | "MISSING";
  } | null;
  owner: { firstName: string; lastName: string; email: string } | null;
  isActive: boolean;
  usersCount?: number;
  vehiclesCount?: number;
  license?: {
    plan?: string;
    seats?: number;
    status?: LicenseStatus;
    expiresAt?: string | null;
    priceMonthly?: number | null;
    billingCycle?: "monthly" | "yearly";
  };
};

type EventRow = {
  id: string;
  action: string;
  tenantName: string;
  createdAt: string;
  details?: unknown;
};

type PlatformUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  tenant?: { name?: string } | null;
};

type ConfirmState = {
  tenantId: string;
  tenantName: string;
  action: QuickAction;
  title: string;
  description: string;
} | null;

type PlanConfirmState = {
  tenant: TenantRow;
  nextPlan: PlanTier;
  forceActivate: boolean;
} | null;

type RowActionSelection = QuickAction | "";

type PlatformSectionId = "overview" | "clients" | "revenue" | "events" | "tools";
type RevenueRange = "2W" | "1M" | "6M" | "1Y";

const actionLabels: Record<QuickAction, string> = {
  ACTIVATE_LICENSE: "Attiva licenza",
  SUSPEND_LICENSE: "Sospendi licenza",
  TRIAL_14_DAYS: "Trial 14 giorni",
  RENEW_30_DAYS: "Rinnova +30 giorni",
  RENEW_365_DAYS: "Rinnova +365 giorni",
  DEACTIVATE_TENANT: "Disattiva cliente",
  REACTIVATE_TENANT: "Riattiva cliente"
};

const statusBadgeVariant = (status?: LicenseStatus) => {
  if (status === "ACTIVE") return "success" as const;
  if (status === "TRIAL") return "secondary" as const;
  if (status === "PAST_DUE") return "warning" as const;
  if (status === "EXPIRED") return "destructive" as const;
  if (status === "CANCELED") return "destructive" as const;
  return "warning" as const;
};

const licenseStatusLabel = (status?: LicenseStatus) => {
  if (status === "ACTIVE") return "Attiva";
  if (status === "SUSPENDED") return "Sospesa";
  if (status === "EXPIRED") return "Scaduta";
  if (status === "TRIAL") return "Trial";
  if (status === "PAST_DUE") return "Pagamento fallito";
  if (status === "CANCELED") return "Cancellata";
  return "Sconosciuta";
};

const parseEventDetails = (details: unknown) => {
  if (!details || typeof details !== "object") return { sourceIp: "n/a", actor: "platform-admin", quickAction: "" };
  const payload = details as Record<string, unknown>;
  return {
    sourceIp: typeof payload.sourceIp === "string" ? payload.sourceIp : "n/a",
    actor: typeof payload.actor === "string" ? payload.actor : "platform-admin",
    quickAction: typeof payload.quickAction === "string" ? payload.quickAction : ""
  };
};

const isExpiringSoon = (expiresAt?: string | null) => {
  if (!expiresAt) return false;
  const delta = new Date(expiresAt).getTime() - Date.now();
  return delta >= 0 && delta <= 7 * 24 * 60 * 60 * 1000;
};

const formatDate = (iso?: string | null) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("it-IT");
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value);
const formatCurrencyCompact = (value: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 }).format(value);

const toMonthKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
const isDayPeriodKey = (periodKey: string) => /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(periodKey);
const toIsoDayKeyFromLocalDate = (value: Date) => {
  const normalized = new Date(value);
  normalized.setHours(12, 0, 0, 0);
  return normalized.toISOString().slice(0, 10);
};
const formatPeriodLabel = (periodKey: string) => {
  if (isDayPeriodKey(periodKey)) {
    const [rawYear, rawMonth, rawDay] = periodKey.split("-");
    const year = Number(rawYear);
    const month = Number(rawMonth);
    const day = Number(rawDay);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return new Date(year, month - 1, day).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
    }
    return periodKey;
  }
  const [rawYear, rawMonth] = periodKey.split("-");
  const year = Number(rawYear);
  const month = Number(rawMonth);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return periodKey;
  return new Date(year, month - 1, 1).toLocaleDateString("it-IT", { month: "short" });
};

const revenueRangeOptions: Array<{ value: RevenueRange; label: string }> = [
  { value: "2W", label: "Bisettimanale" },
  { value: "1M", label: "Mensile" },
  { value: "6M", label: "6 mesi" },
  { value: "1Y", label: "1 anno" }
];

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "adesso";
  if (min < 60) return `${min}m fa`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h fa`;
  const d = Math.floor(h / 24);
  return `${d}g fa`;
};

const useCountUp = (target: number, duration = 560) => {
  const [value, setValue] = useState(target);

  useEffect(() => {
    const start = performance.now();
    const from = value;
    const delta = target - from;
    if (delta === 0) return;

    let raf = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(from + delta * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return value;
};

export const PlatformAdminPage = () => {
  const navigate = useNavigate();
  const sidebarStorageKey = "platform_sidebar_hidden";

  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [search, setSearch] = useState("");
  const [licenseFilter, setLicenseFilter] = useState<"ALL" | LicenseStatus>("ALL");
  const [tenantStatusFilter, setTenantStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editingTenant, setEditingTenant] = useState<TenantRow | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [planConfirmState, setPlanConfirmState] = useState<PlanConfirmState>(null);
  const [rowLoading, setRowLoading] = useState<Record<string, boolean>>({});
  const [rowFeedback, setRowFeedback] = useState<Record<string, { type: "success" | "error" | "loading"; message: string }>>({});
  const [rowActionDrafts, setRowActionDrafts] = useState<Record<string, RowActionSelection>>({});
  const [planDrafts, setPlanDrafts] = useState<Record<string, PlanTier>>({});
  const reportMonth = useMemo(() => toMonthKey(new Date()), []);
  const [revenueRange, setRevenueRange] = useState<RevenueRange>("1Y");
  const [revenueReport, setRevenueReport] = useState<PlatformRevenueMetrics | null>(null);
  const [dashboardLive, setDashboardLive] = useState<PlatformDashboardLiveMetrics | null>(null);
  const [activeSection, setActiveSection] = useState<PlatformSectionId>("clients");
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(sidebarStorageKey) !== "0";
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isMonthlyRevenueRange = revenueRange === "6M" || revenueRange === "1Y";
  const revenueMonths = revenueRange === "6M" ? 6 : 12;
  const revenueQuery = isMonthlyRevenueRange
    ? { range: revenueRange, month: reportMonth, months: revenueMonths }
    : { range: revenueRange };

  const loadDashboardLive = async (options?: { silent?: boolean }) => {
    try {
      const metrics = await platformAdminUseCases.dashboardLiveMetrics({ windowMinutes: 15 });
      setDashboardLive(metrics);
    } catch (err) {
      if (handlePlatformAuthError(err)) return;
      if (!options?.silent) {
        snackbar.error((err as Error).message);
      }
    }
  };

  const load = async (options?: { silent?: boolean }) => {
    setError(null);
    if (!options?.silent) setLoading(true);
    if (options?.silent) setRefreshing(true);

    try {
      const [tenantData, userData, eventData, revenueData] = await Promise.all([
        platformAdminUseCases.listTenants(),
        platformAdminUseCases.listUsers(),
        platformAdminUseCases.listRecentEvents(20),
        platformAdminUseCases.revenueMetrics(revenueQuery)
      ]);
      setTenants(tenantData.data);
      setUsers(userData.data);
      setEvents(eventData.data);
      setRevenueReport(revenueData);
      void loadDashboardLive({ silent: true });
    } catch (err) {
      if (handlePlatformAuthError(err)) return;
      const message = (err as Error).message;
      setError(message);
      snackbar.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    void loadDashboardLive();
  }, []);

  useEffect(() => {
    void load({ silent: true });
  }, [revenueRange]);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadDashboardLive({ silent: true });
    }, 15_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!confirmState && !planConfirmState) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirmState(null);
        setPlanConfirmState(null);
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [confirmState, planConfirmState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(sidebarStorageKey, sidebarHidden ? "1" : "0");
  }, [sidebarHidden]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileSidebarOpen(false);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [mobileSidebarOpen]);

  useEffect(() => {
    const isSectionId = (value: unknown): value is PlatformSectionId =>
      value === "overview" || value === "clients" || value === "revenue" || value === "events" || value === "tools";

    const onSetSection = (event: Event) => {
      const payload = (event as CustomEvent<{ section?: unknown }>).detail;
      if (isSectionId(payload?.section)) {
        setActiveSection(payload.section);
      }
    };

    const onToggleSidebar = () => {
      setSidebarHidden((old) => !old);
    };

    const onOpenMobileSidebar = () => {
      setMobileSidebarOpen(true);
    };

    window.addEventListener("platform-console:set-section", onSetSection as EventListener);
    window.addEventListener("platform-console:toggle-sidebar", onToggleSidebar);
    window.addEventListener("platform-console:open-mobile-sidebar", onOpenMobileSidebar);
    return () => {
      window.removeEventListener("platform-console:set-section", onSetSection as EventListener);
      window.removeEventListener("platform-console:toggle-sidebar", onToggleSidebar);
      window.removeEventListener("platform-console:open-mobile-sidebar", onOpenMobileSidebar);
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("platform-console:active-section", { detail: { section: activeSection } }));
  }, [activeSection]);

  const filteredTenants = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tenants.filter((tenant) => {
      const owner = tenant.owner ? `${tenant.owner.firstName} ${tenant.owner.lastName} ${tenant.owner.email}` : "";
      const company = tenant.company
        ? `${tenant.company.legalName ?? ""} ${tenant.company.tradeName ?? ""} ${tenant.company.vatNumber ?? ""} ${tenant.company.email ?? ""}`
        : "";
      const matchesSearch = q.length === 0 || `${tenant.name} ${owner} ${company}`.toLowerCase().includes(q);
      const licenseStatus = tenant.license?.status ?? "ACTIVE";
      const matchesLicense = licenseFilter === "ALL" || licenseStatus === licenseFilter;
      const tenantState = tenant.isActive ? "ACTIVE" : "INACTIVE";
      const matchesTenantStatus = tenantStatusFilter === "ALL" || tenantStatusFilter === tenantState;
      return matchesSearch && matchesLicense && matchesTenantStatus;
    });
  }, [licenseFilter, search, tenantStatusFilter, tenants]);

  const kpis = useMemo(() => {
    const activeTenants = tenants.filter((tenant) => tenant.isActive).length;
    const activeLicenses = tenants.filter((tenant) => (tenant.license?.status ?? "ACTIVE") === "ACTIVE").length;
    const expiringSoon = tenants.filter((tenant) => isExpiringSoon(tenant.license?.expiresAt)).length;
    const suspended = tenants.filter((tenant) => (tenant.license?.status ?? "ACTIVE") === "SUSPENDED").length;
    return { activeTenants, activeLicenses, expiringSoon, suspended };
  }, [tenants]);

  const activeTenantsCounter = useCountUp(kpis.activeTenants);
  const activeLicensesCounter = useCountUp(kpis.activeLicenses);
  const expiringCounter = useCountUp(kpis.expiringSoon);
  const suspendedCounter = useCountUp(kpis.suspended);
  const liveUsersCounter = useCountUp(dashboardLive?.activeUsersLive ?? 0);

  const revenueBreakdown = revenueReport?.breakdown ?? [];
  const revenueTrend = useMemo(
    () => [...(revenueReport?.trend ?? [])].sort((left, right) => left.month.localeCompare(right.month)),
    [revenueReport]
  );
  const revenueActiveTenants = revenueBreakdown.reduce((acc, row) => acc + row.activeTenants, 0);
  const mrrTotal = revenueReport?.kpis.mrrTotal ?? 0;
  const mrrLost = revenueReport?.kpis.mrrLost ?? 0;
  const previousMonthMrr = revenueReport ? Math.max(revenueReport.kpis.mrrTotal - revenueReport.kpis.deltaFromPrevious, 0) : 0;
  const growthRatePct = previousMonthMrr > 0 ? (revenueReport!.kpis.deltaFromPrevious / previousMonthMrr) * 100 : 0;
  const lossRatePct = mrrTotal > 0 ? (mrrLost / mrrTotal) * 100 : 0;
  const arrRunRate = mrrTotal * 12;
  const arpa = revenueActiveTenants > 0 ? mrrTotal / revenueActiveTenants : 0;
  const bestMonth = revenueTrend.reduce<{ month: string; mrrTotal: number } | null>((best, row) => {
    if (!best || row.mrrTotal > best.mrrTotal) return row;
    return best;
  }, null);
  const revenueChartData = useMemo(
    () => {
      const isDailyRange = revenueRange === "2W" || revenueRange === "1M";
      if (!isDailyRange) {
        return revenueTrend.map((row) => ({
          month: row.month,
          label: formatPeriodLabel(row.month),
          mrrTotal: row.mrrTotal,
          mrrLost: row.mrrLost
        }));
      }

      const expectedDays = revenueRange === "2W" ? 14 : 30;
      const dailyRows = revenueTrend.filter((row) => isDayPeriodKey(row.month));
      const dailyMap = new Map(dailyRows.map((row) => [row.month, row]));
      let carry = dailyRows[dailyRows.length - 1] ?? revenueTrend[revenueTrend.length - 1] ?? null;
      const today = new Date();
      today.setHours(12, 0, 0, 0);

      const periods = Array.from({ length: expectedDays }, (_, idx) => {
        const day = new Date(today);
        day.setDate(today.getDate() - (expectedDays - 1 - idx));
        return {
          key: toIsoDayKeyFromLocalDate(day),
          label: day.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })
        };
      });

      return periods.map((period) => {
        const found = dailyMap.get(period.key);
        if (found) carry = found;
        return {
          month: period.key,
          label: period.label,
          mrrTotal: found?.mrrTotal ?? carry?.mrrTotal ?? 0,
          mrrLost: found?.mrrLost ?? carry?.mrrLost ?? 0
        };
      });
    },
    [revenueRange, revenueTrend]
  );
  const criticalTenantsCount = useMemo(
    () =>
      tenants.filter((tenant) => {
        const licenseStatus = tenant.license?.status ?? "ACTIVE";
        return !tenant.isActive || licenseStatus === "SUSPENDED" || licenseStatus === "EXPIRED" || licenseStatus === "PAST_DUE" || licenseStatus === "CANCELED" || isExpiringSoon(tenant.license?.expiresAt);
      }).length,
    [tenants]
  );

  const openConfirm = (tenant: TenantRow, action: QuickAction) => {
    const impact = action === "SUSPEND_LICENSE" || action === "DEACTIVATE_TENANT";
    if (!impact) {
      void runAction(tenant.id, action);
      return;
    }

    setConfirmState({
      tenantId: tenant.id,
      tenantName: tenant.name,
      action,
      title: actionLabels[action],
      description:
        action === "SUSPEND_LICENSE"
          ? "Questa azione blocca l'accesso API del tenant finché non riattivi la licenza."
          : "Questa azione disattiva il tenant a livello platform e ferma l'operatività dell'ambiente."
    });
  };

  const runAction = async (tenantId: string, action: QuickAction) => {
    setRowLoading((old) => ({ ...old, [tenantId]: true }));
    setRowFeedback((old) => ({ ...old, [tenantId]: { type: "loading", message: "Operazione in corso..." } }));

    try {
      await platformAdminUseCases.quickAction(tenantId, action);
      setRowFeedback((old) => ({ ...old, [tenantId]: { type: "success", message: `${actionLabels[action]} completata` } }));
      snackbar.success(`${actionLabels[action]} eseguita`);
      await load({ silent: true });
    } catch (err) {
      if (handlePlatformAuthError(err)) return;
      const message = (err as Error).message;
      setRowFeedback((old) => ({ ...old, [tenantId]: { type: "error", message } }));
      snackbar.error(message);
    } finally {
      setRowLoading((old) => ({ ...old, [tenantId]: false }));
    }
  };

  const updateTenantPlan = async (tenant: TenantRow, nextPlan: PlanTier, forceActivate: boolean) => {
    const currentPlan = normalizePlanTier(tenant.license?.plan);
    const licenseStatus = tenant.license?.status ?? "ACTIVE";
    const planChanged = hasPlanChange(currentPlan, nextPlan);
    const hasStatusChange = forceActivate && licenseStatus !== "ACTIVE";
    if (!planChanged && !hasStatusChange) return;

    setRowLoading((old) => ({ ...old, [tenant.id]: true }));
    setRowFeedback((old) => ({ ...old, [tenant.id]: { type: "loading", message: "Aggiornamento piano in corso..." } }));

    try {
      const payload = buildPlanUpdatePayload({
        nextPlan,
        license: tenant.license,
        forceActive: forceActivate
      });
      const result = await platformAdminUseCases.updateLicense(tenant.id, payload);
      const savedPlan = normalizePlanTier(typeof result?.after?.plan === "string" ? result.after.plan : nextPlan);
      setPlanDrafts((old) => clearPlanDraft(old, tenant.id));
      setRowFeedback((old) => ({
        ...old,
        [tenant.id]: {
          type: "success",
          message: forceActivate ? `Piano ${savedPlan} salvato e licenza attivata` : `Piano ${savedPlan} applicato`
        }
      }));
      snackbar.success(forceActivate ? `Piano ${savedPlan} salvato e licenza attivata` : `Piano ${savedPlan} applicato`);
      await load({ silent: true });
    } catch (err) {
      if (handlePlatformAuthError(err)) return;
      const message = (err as Error).message;
      setPlanDrafts((old) => rollbackPlanDraft(old, tenant.id, currentPlan));
      setRowFeedback((old) => ({ ...old, [tenant.id]: { type: "error", message } }));
      snackbar.error(message);
    } finally {
      setRowLoading((old) => ({ ...old, [tenant.id]: false }));
    }
  };

  const requestPlanUpdate = (tenant: TenantRow, forceActivate: boolean) => {
    const nextPlan = planDrafts[tenant.id] ?? normalizePlanTier(tenant.license?.plan);
    if (!isPlanTier(nextPlan)) {
      setRowFeedback((old) => ({ ...old, [tenant.id]: { type: "error", message: "Piano non valido" } }));
      snackbar.error("Piano non valido");
      return;
    }

    const currentPlan = normalizePlanTier(tenant.license?.plan);
    const isDowngrade = isPlanDowngrade(currentPlan, nextPlan);
    if (isDowngrade) {
      setPlanConfirmState({ tenant, nextPlan, forceActivate });
      return;
    }

    void updateTenantPlan(tenant, nextPlan, forceActivate);
  };

  const executeRowAction = (tenant: TenantRow) => {
    const selected = rowActionDrafts[tenant.id] ?? "";
    if (!selected) {
      setRowFeedback((old) => ({ ...old, [tenant.id]: { type: "error", message: "Seleziona un'azione da eseguire" } }));
      return;
    }

    openConfirm(tenant, selected);
    setRowActionDrafts((old) => ({ ...old, [tenant.id]: "" }));
  };

  const onLicenseSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingTenant) return;

    const form = new FormData(event.currentTarget);
    try {
      const priceMonthlyRaw = String(form.get("priceMonthly") || "").trim();
      await platformAdminUseCases.updateLicense(editingTenant.id, {
        plan: String(form.get("plan") || "STARTER"),
        seats: Number(form.get("seats") || 1),
        status: String(form.get("status") || "ACTIVE") as LicenseStatus,
        expiresAt: String(form.get("expiresAt") || "") ? new Date(String(form.get("expiresAt"))).toISOString() : null,
        priceMonthly: priceMonthlyRaw ? Number(priceMonthlyRaw) : null,
        billingCycle: String(form.get("billingCycle") || "monthly") as "monthly" | "yearly"
      });
      snackbar.success("Licenza aggiornata");
      setEditingTenant(null);
      await load({ silent: true });
    } catch (err) {
      if (handlePlatformAuthError(err)) return;
      const message = (err as Error).message;
      setError(message);
      snackbar.error(message);
    }
  };

  const resetFilters = () => {
    setSearch("");
    setLicenseFilter("ALL");
    setTenantStatusFilter("ALL");
  };

  const sectionDescription: Record<PlatformSectionId, string> = {
    overview: "Dashboard premium con live users, MRR e stato operativo",
    clients: "Gestione clienti, piani, licenze e quick action",
    revenue: "MRR, breakdown piani, trend e export finanziario",
    events: "Audit operativo, eventi recenti e watchlist",
    tools: "Azioni globali e scorciatoie di controllo"
  };
  const sidebarItems: Array<{
    id: PlatformSectionId;
    label: string;
    description: string;
    icon: any;
    badge?: string;
  }> = [
    {
      id: "clients",
      label: "Clienti",
      description: "Clienti, piani, licenze",
      icon: Building2,
      badge: String(tenants.length)
    },
    {
      id: "overview",
      label: "Dashboard",
      description: "KPI e stato globale",
      icon: Users,
      badge: String(dashboardLive?.activeUsersLive ?? 0)
    },
    {
      id: "revenue",
      label: "Ricavi",
      description: "MRR e trend economico",
      icon: BarChart3,
      badge: String(revenueActiveTenants)
    },
    {
      id: "events",
      label: "Eventi",
      description: "Audit e watchlist operativa",
      icon: Activity,
      badge: String(events.length)
    },
    {
      id: "tools",
      label: "Strumenti",
      description: "Azioni globali e reset",
      icon: SlidersHorizontal
    }
  ];
  const tenantPriorityList = useMemo(() => {
    const riskScore = (tenant: TenantRow) => {
      let score = 0;
      if (!tenant.isActive) score += 2;
      const licenseStatus = tenant.license?.status ?? "ACTIVE";
      if (licenseStatus === "SUSPENDED") score += 5;
      if (licenseStatus === "PAST_DUE") score += 5;
      if (licenseStatus === "CANCELED") score += 5;
      if (licenseStatus === "EXPIRED") score += 4;
      if (isExpiringSoon(tenant.license?.expiresAt)) score += 3;
      return score;
    };
    const sorted = [...tenants].sort((left, right) => riskScore(right) - riskScore(left));
    const criticalOnly = sorted.filter((tenant) => riskScore(tenant) > 0);
    return (criticalOnly.length > 0 ? criticalOnly : sorted).slice(0, 6);
  }, [tenants]);
  const isPlatformAuthError = (err: unknown) => {
    const payload = err as { status?: number; code?: string; message?: string };
    if (payload?.status === 401 || payload?.code === "UNAUTHORIZED") return true;
    return /token platform non valido|token platform mancante|accesso platform negato/i.test(payload?.message ?? "");
  };

  const handlePlatformAuthError = (err: unknown) => {
    if (!isPlatformAuthError(err)) return false;
    platformAdminUseCases.logout();
    snackbar.error("Sessione platform scaduta o non valida. Effettua di nuovo il login.");
    navigate("/login", { replace: true });
    return true;
  };

  return (
    <section className="platform-console space-y-4">
      <button
        type="button"
        className={`fixed inset-0 z-[105] hidden bg-slate-950/20 transition-opacity lg:block ${
          sidebarHidden ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        aria-label="Chiudi sidebar"
        onClick={() => setSidebarHidden(true)}
      />

      <aside
        className={`fixed bottom-4 left-4 top-4 z-[108] hidden w-[272px] transition-transform duration-300 lg:block ${
          sidebarHidden ? "-translate-x-[120%]" : "translate-x-0"
        }`}
      >
        <div className="platform-admin-aside g-sidebar h-full space-y-4 rounded-2xl border border-border/70 bg-card/92 p-3 shadow-sm backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Navigation</p>
              <p className="text-sm font-semibold text-foreground">Platform Workspace</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setSidebarHidden(true)} aria-label="Chiudi sidebar">
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>

          <nav className="space-y-1.5">
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={`platform-admin-nav-item ${isActive ? "platform-admin-nav-item--active" : ""}`}
                  title={item.label}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-sm font-semibold text-foreground">{item.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{item.description}</span>
                  </span>
                  {item.badge ? (
                    <span className="rounded-full border border-border/80 bg-background px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="space-y-3 rounded-xl border border-border/70 bg-background/65 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Priorita Clienti</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-border/70 bg-card/70 px-1.5 py-2">
                <p className="text-[10px] uppercase text-muted-foreground">Attivi</p>
                <p className="text-sm font-semibold text-foreground">{kpis.activeTenants}</p>
              </div>
              <div className="rounded-lg border border-amber-300/50 bg-amber-50/80 px-1.5 py-2 dark:border-amber-500/40 dark:bg-amber-500/10">
                <p className="text-[10px] uppercase text-amber-700 dark:text-amber-300">Scadenza</p>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">{kpis.expiringSoon}</p>
              </div>
              <div className="rounded-lg border border-rose-300/50 bg-rose-50/80 px-1.5 py-2 dark:border-rose-500/40 dark:bg-rose-500/10">
                <p className="text-[10px] uppercase text-rose-700 dark:text-rose-300">Sospese</p>
                <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">{kpis.suspended}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              {tenantPriorityList.slice(0, 5).map((tenant) => {
                const licenseStatus = tenant.license?.status ?? "ACTIVE";
                return (
                  <button
                    key={`priority-${tenant.id}`}
                    type="button"
                    onClick={() => {
                      setSearch(tenant.name);
                      setActiveSection("clients");
                    }}
                    className="flex w-full items-center gap-2 rounded-lg border border-border/70 bg-card/75 px-2 py-1.5 text-left transition hover:border-border hover:bg-card"
                  >
                    <span className="truncate text-xs font-medium text-foreground">{tenant.name}</span>
                    <span className="ml-auto">
                      <Badge variant={statusBadgeVariant(licenseStatus)}>{licenseStatus}</Badge>
                    </span>
                  </button>
                );
              })}
            </div>
                <Button variant="secondary" size="sm" className="w-full" onClick={() => setActiveSection("clients")}>
                  Apri Matrice Clienti
                </Button>
          </div>
        </div>
      </aside>

      <div className="space-y-4">
      {activeSection === "overview" ? (
        <div className="space-y-4">
          <Card className="platform-command-hero">
            <CardContent className="platform-command-hero__content grid gap-5 py-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.9fr)]">
              <div className="platform-command-copy mx-auto w-full max-w-2xl space-y-2 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">Control Surface</p>
                <p className="text-xl font-semibold text-foreground">Centro operativo licenze clienti</p>
                <p className="text-sm text-muted-foreground">
                  {sectionDescription[activeSection]}. Le aree operative sono divise per ridurre il rumore e velocizzare le decisioni.
                </p>
              </div>
              <div className="platform-command-badges mx-auto grid w-full max-w-md gap-2.5 sm:grid-cols-2">
                <div className="rounded-xl border border-cyan-300/45 bg-cyan-50 px-3 py-2.5 text-center text-sm text-cyan-900 dark:border-cyan-400/30 dark:bg-cyan-500/15 dark:text-cyan-100">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-700/80 dark:text-cyan-100/80">Scope</p>
                  <p className="font-semibold">Platform-only</p>
                </div>
                <div className="rounded-xl border border-emerald-300/45 bg-emerald-50 px-3 py-2.5 text-center text-sm text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-100">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-emerald-700/80 dark:text-emerald-100/80">Security</p>
                  <p className="font-semibold">IP Restricted</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <PlatformKpiCard
              title="Clienti attivi"
              value={activeTenantsCounter}
              subtitle={`Operativi su ${tenants.length} clienti`}
              icon={<Users className="h-5 w-5" />}
            />
            <PlatformKpiCard
              title="Licenze ACTIVE"
              value={activeLicensesCounter}
              subtitle="Clienti con licenza valida"
              icon={<CheckCircle2 className="h-5 w-5" />}
              valueClassName="text-emerald-700 dark:text-emerald-400"
            />
            <PlatformKpiCard
              title="In scadenza < 7gg"
              value={expiringCounter}
              subtitle="Richiede rinnovo rapido"
              icon={<Clock3 className="h-5 w-5" />}
              valueClassName="text-amber-600 dark:text-amber-400"
            />
            <PlatformKpiCard
              title="Licenze sospese"
              value={suspendedCounter}
              subtitle="Da riattivare se necessario"
              icon={<XCircle className="h-5 w-5" />}
              valueClassName="text-rose-600 dark:text-rose-400"
            />
            <Card className="platform-stat-card xl:col-span-1">
              <CardContent className="flex h-full flex-col justify-center gap-2 p-5 sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Utenti attivi LIVE</p>
                <p className="platform-kpi-metric text-foreground">
                  <span className="platform-kpi-icon" aria-hidden="true">
                    <Activity className="h-5 w-5" />
                  </span>
                  <span>{liveUsersCounter}</span>
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Finestra {dashboardLive?.liveWindowMinutes ?? 15} min ·{" "}
                  <span
                    className={
                      (dashboardLive?.deltaFromPreviousWindow ?? 0) >= 0
                        ? "font-semibold text-emerald-600 dark:text-emerald-300"
                        : "font-semibold text-rose-600 dark:text-rose-300"
                    }
                  >
                    {(dashboardLive?.deltaFromPreviousWindow ?? 0) >= 0 ? "+" : ""}
                    {dashboardLive?.deltaFromPreviousWindow ?? 0}
                  </span>{" "}
                  vs finestra precedente
                </p>
              </CardContent>
            </Card>
            <Card className="platform-stat-card xl:col-span-1">
              <CardContent className="flex h-full flex-col justify-center gap-2 p-5 sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">MRR abbonamenti mensili</p>
                <p className="platform-kpi-metric text-foreground">
                  <span className="platform-kpi-icon" aria-hidden="true">
                    <BarChart3 className="h-5 w-5" />
                  </span>
                  <span className="text-lg">{dashboardLive ? formatCurrency(dashboardLive.mrrMonthly) : "-"}</span>
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Mese {dashboardLive?.month ?? "-"} ·{" "}
                  <span
                    className={
                      (dashboardLive?.mrrDeltaFromPrevious ?? 0) >= 0
                        ? "font-semibold text-emerald-600 dark:text-emerald-300"
                        : "font-semibold text-rose-600 dark:text-rose-300"
                    }
                  >
                    {(dashboardLive?.mrrDeltaFromPrevious ?? 0) >= 0 ? "+" : ""}
                    {dashboardLive ? formatCurrency(dashboardLive.mrrDeltaFromPrevious) : "n/a"}
                  </span>
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Card className="platform-main-card">
              <CardHeader>
                <CardTitle className="text-base text-foreground">Riepilogo operativo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="platform-watch-item platform-watch-item--warning">
                  <p className="platform-watch-item__text">
                    <AlertTriangle className="h-4 w-4" />
                    Licenze in scadenza: {kpis.expiringSoon}
                  </p>
                </div>
                <div className="platform-watch-item platform-watch-item--danger">
                  <p className="platform-watch-item__text">
                    <ShieldAlert className="h-4 w-4" />
                    Licenze sospese: {kpis.suspended}
                  </p>
                </div>
                <div className="platform-watch-item platform-watch-item--info">
                  <p className="platform-watch-item__text">
                    <Zap className="h-4 w-4" />
                    Controllo one-click attivo
                  </p>
                </div>
                {revenueReport ? (
                  <div className="mt-2 rounded-xl border border-border/70 bg-card/70 px-3 py-2 text-sm">
                    <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">MRR snapshot</p>
                    <p className="mt-1 font-semibold text-foreground">{formatCurrency(revenueReport.kpis.mrrTotal)}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="platform-main-card">
              <CardHeader className="space-y-2">
                <CardTitle className="text-base text-foreground">Utenti Live</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Finestra live: ultimi {dashboardLive?.liveWindowMinutes ?? 15} minuti
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-[0.09em] text-muted-foreground">Utenti attivi</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{liveUsersCounter}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-[0.09em] text-muted-foreground">Clienti online</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{dashboardLive?.activeTenantsLive ?? 0}</p>
                  </div>
                </div>

                <div className="space-y-1.5 rounded-xl border border-border/70 bg-background/70 p-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Top clienti live</p>
                  {(dashboardLive?.topTenants.length ?? 0) === 0 ? (
                    <p className="text-xs text-muted-foreground">Nessun cliente attivo in questa finestra</p>
                  ) : null}
                  {dashboardLive?.topTenants.slice(0, 5).map((row) => (
                    <div key={`overview-live-tenant-${row.tenantId}`} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/80 px-2 py-1.5">
                      <p className="truncate text-xs font-medium text-foreground">{row.tenantName}</p>
                      <Badge variant="secondary">{row.activeUsers}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {activeSection === "clients" ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-border/70 bg-card/75 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.09em] text-muted-foreground">Clienti visibili</p>
              <p className="mt-1 text-base font-semibold text-foreground">{filteredTenants.length}</p>
            </div>
            <div className="rounded-xl border border-amber-300/45 bg-amber-50/75 px-3 py-2 dark:border-amber-500/40 dark:bg-amber-500/10">
              <p className="text-[11px] uppercase tracking-[0.09em] text-amber-700 dark:text-amber-300">Clienti critici</p>
              <p className="mt-1 text-base font-semibold text-amber-800 dark:text-amber-200">{criticalTenantsCount}</p>
            </div>
            <div className="rounded-xl border border-emerald-300/45 bg-emerald-50/75 px-3 py-2 dark:border-emerald-500/40 dark:bg-emerald-500/10">
              <p className="text-[11px] uppercase tracking-[0.09em] text-emerald-700 dark:text-emerald-300">MRR attuale</p>
              <p className="mt-1 text-base font-semibold text-emerald-800 dark:text-emerald-200">
                {dashboardLive ? formatCurrency(dashboardLive.mrrMonthly) : "-"}
              </p>
            </div>
          </div>

          <Card className="platform-main-card platform-main-surface">
            <CardHeader className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base text-foreground">
                  Matrice Clienti
                  <Badge variant="secondary" className="hidden sm:inline-flex">
                    {filteredTenants.length} visibili
                  </Badge>
                </CardTitle>
                <div className="flex items-center gap-2">
                  {refreshing ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                      sync...
                    </span>
                  ) : null}
                  <Button variant="outline" size="sm" onClick={() => load({ silent: true })}>
                    <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                    Aggiorna dati
                  </Button>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-[1.6fr_1fr_1fr_auto]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="Cerca cliente o owner..." />
                </div>
                <Select value={licenseFilter} onChange={(e) => setLicenseFilter(e.target.value as LicenseStatus | "ALL")}>
                  <option value="ALL">Licenza: tutte</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                  <option value="EXPIRED">EXPIRED</option>
                  <option value="TRIAL">TRIAL</option>
                  <option value="PAST_DUE">PAST_DUE</option>
                  <option value="CANCELED">CANCELED</option>
                </Select>
                <Select value={tenantStatusFilter} onChange={(e) => setTenantStatusFilter(e.target.value as "ALL" | "ACTIVE" | "INACTIVE")}>
                  <option value="ALL">Clienti: tutti</option>
                  <option value="ACTIVE">Clienti attivi</option>
                  <option value="INACTIVE">Clienti inattivi</option>
                </Select>
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  Reset
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {error ? (
                <div className="rounded-2xl border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                  <p className="font-semibold">Errore caricamento pannello</p>
                  <p>{error}</p>
                  <Button className="mt-3" size="sm" onClick={() => load()}>
                    Riprova
                  </Button>
                </div>
              ) : null}

              <div className="platform-table-wrap overflow-x-hidden rounded-2xl border border-border/70">
                <Table className="platform-tenant-table table-fixed [&_th]:py-1.5 [&_td]:py-1.5">
                  <TableHeader className="platform-table-header sticky top-0 z-20 backdrop-blur">
                    <TableRow className="border-b border-border/70">
                      <TableHead className="w-[16%]">Cliente / profilo</TableHead>
                      <TableHead className="w-[19%]">Owner</TableHead>
                      <TableHead className="w-[16%]">Piano</TableHead>
                      <TableHead className="w-[11%] text-center">Stato licenza</TableHead>
                      <TableHead className="w-[11%]">Scadenza</TableHead>
                      <TableHead className="w-[7%] text-center">Seats</TableHead>
                      <TableHead className="w-[20%]">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading
                      ? [...Array(4)].map((_, idx) => (
                          <TableRow key={`s-${idx}`}>
                            <TableCell colSpan={7}>
                              <div className="platform-skeleton h-9 w-full rounded-lg" />
                            </TableCell>
                          </TableRow>
                        ))
                      : null}

                    {!loading && filteredTenants.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <div className="grid place-items-center gap-2 py-12 text-center text-muted-foreground">
                            <Users className="h-5 w-5" />
                            <p className="font-medium text-foreground">Nessun cliente trovato con i filtri attuali</p>
                            <p className="text-xs">Modifica ricerca o usa reset filtri</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}

                    {!loading &&
                      filteredTenants.map((tenant) => {
                        const feedback = rowFeedback[tenant.id];
                        const busy = !!rowLoading[tenant.id];
                        const currentPlan = normalizePlanTier(tenant.license?.plan);
                        const selectedPlan = planDrafts[tenant.id] ?? currentPlan;
                        const licenseStatus = tenant.license?.status ?? "ACTIVE";
                        const hasPlanChanges = hasPlanChange(currentPlan, selectedPlan);
                        const profileComplete = tenant.company?.profileCompleted;
                        const companyName = tenant.company?.legalName || tenant.company?.tradeName || tenant.name;

                        return (
                          <TableRow key={tenant.id} className="platform-tenant-row">
                            <TableCell className="platform-tenant-cell break-words">
                              <div className="space-y-1">
                                <p className="font-semibold text-foreground">{companyName}</p>
                                {companyName !== tenant.name ? <p className="text-xs text-muted-foreground">{tenant.name}</p> : null}
                                <Badge variant={profileComplete ? "success" : "warning"} className="text-[10px]">
                                  {profileComplete ? "Profilo completo" : "Profilo incompleto"}
                                </Badge>
                                <p className="text-xs text-muted-foreground">ID: {tenant.id}</p>
                              </div>
                            </TableCell>
                            <TableCell className="platform-tenant-cell break-words">
                              {tenant.owner ? (
                                <div className="space-y-1">
                                  <p className="font-medium text-foreground">
                                    {tenant.owner.firstName} {tenant.owner.lastName}
                                  </p>
                                  <p className="text-xs text-muted-foreground">{tenant.owner.email}</p>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="platform-tenant-cell">
                              <div className="platform-plan-cell">
                                <Select
                                  value={selectedPlan}
                                  onChange={(event) => {
                                    const next = event.target.value;
                                    if (!isPlanTier(next)) return;
                                    setPlanDrafts((old) => ({ ...old, [tenant.id]: next }));
                                  }}
                                  className="h-8 text-[11px]"
                                  aria-label={`Seleziona piano per ${tenant.name}`}
                                >
                                  {PLAN_TIERS.map((plan) => (
                                    <option key={`${tenant.id}-${plan}`} value={plan}>
                                      {plan}
                                    </option>
                                  ))}
                                </Select>
                                {hasPlanChanges ? <p className="text-[11px] text-amber-600 dark:text-amber-300">Modifica non salvata</p> : null}
                              </div>
                            </TableCell>
                            <TableCell className="platform-tenant-cell text-center">
                              <Badge variant={statusBadgeVariant(licenseStatus)}>{licenseStatusLabel(licenseStatus)}</Badge>
                            </TableCell>
                            <TableCell className="platform-tenant-cell">
                              <div className="space-y-1">
                                <p className="text-foreground">{formatDate(tenant.license?.expiresAt)}</p>
                                {isExpiringSoon(tenant.license?.expiresAt) ? <Badge variant="warning">in scadenza &lt; 7 giorni</Badge> : null}
                              </div>
                            </TableCell>
                            <TableCell className="platform-tenant-cell text-center text-foreground">{tenant.license?.seats ?? 3}</TableCell>
                            <TableCell className="platform-tenant-cell">
                              <div className="platform-action-stack">
                                <div className="grid gap-1.5">
                                  <Select
                                    value={rowActionDrafts[tenant.id] ?? ""}
                                    onChange={(event) =>
                                      setRowActionDrafts((old) => ({
                                        ...old,
                                        [tenant.id]: event.target.value as RowActionSelection
                                      }))
                                    }
                                    className="h-8 text-xs font-medium"
                                    placeholderLabel="nessuna azione..."
                                    aria-label={`Azione operativa per ${tenant.name}`}
                                  >
                                    <option value="">nessuna azione...</option>
                                    <option value="ACTIVATE_LICENSE">Attiva licenza</option>
                                    <option value="SUSPEND_LICENSE">Sospendi licenza</option>
                                    <option value="TRIAL_14_DAYS">Trial 14 giorni</option>
                                    <option value="RENEW_30_DAYS">Rinnova +30 giorni</option>
                                    <option value="RENEW_365_DAYS">Rinnova +365 giorni</option>
                                  </Select>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy || !(rowActionDrafts[tenant.id] ?? "")}
                                    className="h-7 w-full min-w-0 text-[11px]"
                                    onClick={() => executeRowAction(tenant)}
                                  >
                                    Esegui
                                  </Button>
                                </div>
                                {feedback ? (
                                  <p
                                    className={
                                      feedback.type === "error"
                                        ? "text-xs text-red-600 dark:text-red-300"
                                        : feedback.type === "loading"
                                          ? "text-xs text-muted-foreground"
                                          : "text-xs text-emerald-600 dark:text-emerald-300"
                                    }
                                  >
                                    {feedback.message}
                                  </p>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {editingTenant ? (
            <Card className="platform-main-card">
              <CardHeader>
                <CardTitle className="text-base text-foreground">Modifica manuale licenza · {editingTenant.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="grid gap-3 md:grid-cols-2" onSubmit={onLicenseSubmit}>
                  <div className="grid gap-1.5">
                    <Label>Piano</Label>
                    <Select name="plan" defaultValue={editingTenant.license?.plan ?? "STARTER"}>
                      <option value="STARTER">STARTER</option>
                      <option value="PRO">PRO</option>
                      <option value="ENTERPRISE">ENTERPRISE</option>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Posti licenza</Label>
                    <Input name="seats" type="number" min={1} defaultValue={editingTenant.license?.seats ?? 3} required />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Stato licenza</Label>
                    <Select name="status" defaultValue={editingTenant.license?.status ?? "ACTIVE"}>
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="TRIAL">TRIAL</option>
                      <option value="SUSPENDED">SUSPENDED</option>
                      <option value="EXPIRED">EXPIRED</option>
                      <option value="PAST_DUE">PAST_DUE</option>
                      <option value="CANCELED">CANCELED</option>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Scadenza</Label>
                    <Input
                      name="expiresAt"
                      type="datetime-local"
                      defaultValue={editingTenant.license?.expiresAt ? new Date(editingTenant.license.expiresAt).toISOString().slice(0, 16) : ""}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Prezzo mensile override (EUR)</Label>
                    <Input
                      name="priceMonthly"
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={editingTenant.license?.priceMonthly ?? ""}
                      placeholder="es. 149"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Ciclo fatturazione</Label>
                    <Select name="billingCycle" defaultValue={editingTenant.license?.billingCycle ?? "monthly"}>
                      <option value="monthly">Mensile</option>
                      <option value="yearly">Annuale</option>
                    </Select>
                  </div>
                  <div className="flex gap-2 md:col-span-2">
                    <Button type="submit">Salva licenza</Button>
                    <Button type="button" variant="outline" onClick={() => setEditingTenant(null)}>
                      Annulla
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {activeSection === "revenue" ? (
        <Card className="platform-main-card">
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base text-foreground">Piani & Ricavi Mensili</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-card/70 p-1">
                  {revenueRangeOptions.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      size="sm"
                      variant={revenueRange === option.value ? "default" : "ghost"}
                      className="h-8 px-2.5 text-xs"
                      onClick={() => setRevenueRange(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const blob = await platformAdminUseCases.revenueCsv(revenueQuery);
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `platform-revenue-${revenueRange}.csv`;
                      link.click();
                      URL.revokeObjectURL(url);
                      snackbar.success("Export ricavi completato");
                    } catch (err) {
                      if (handlePlatformAuthError(err)) return;
                      snackbar.error((err as Error).message);
                    }
                  }}
                >
                  Export CSV
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {revenueReport ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-border/70 bg-card/70 p-3">
                    <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">MRR totale</p>
                    <p className="mt-1 text-xl font-semibold text-foreground">{formatCurrency(mrrTotal)}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-card/70 p-3">
                    <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Delta mese su mese</p>
                    <p
                      className={`mt-1 text-xl font-semibold ${
                        revenueReport.kpis.deltaFromPrevious >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"
                      }`}
                    >
                      {formatCurrency(revenueReport.kpis.deltaFromPrevious)}
                    </p>
                    <p className={`mt-1 text-xs ${growthRatePct >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}>
                      {growthRatePct >= 0 ? "+" : ""}
                      {growthRatePct.toFixed(1)}%
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-card/70 p-3">
                    <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">MRR perso</p>
                    <p className="mt-1 text-xl font-semibold text-rose-600 dark:text-rose-300">{formatCurrency(mrrLost)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Loss rate: {lossRatePct.toFixed(1)}%</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-card/70 p-3">
                    <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Clienti attivi a ricavo</p>
                    <p className="mt-1 text-xl font-semibold text-foreground">{revenueActiveTenants}</p>
                    <p className="mt-1 text-xs text-muted-foreground">ARPA: {formatCurrency(arpa)}</p>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="rounded-2xl border border-border/70 bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground">Trend mensile guadagni</p>
                      <Badge variant="secondary">{formatPeriodLabel(revenueReport.selectedMonth)}</Badge>
                    </div>
                    <div className="mt-4 h-64 rounded-xl border border-border/70 bg-background/70 p-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={revenueChartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.45} />
                          <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                          />
                          <YAxis
                            width={72}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                            tickFormatter={(value) => formatCurrencyCompact(Number(value))}
                          />
                          <Tooltip
                            cursor={false}
                            isAnimationActive={false}
                            wrapperStyle={{ pointerEvents: "none" }}
                            labelFormatter={(_, payload) => {
                              const month = payload?.[0]?.payload?.month;
                              return typeof month === "string" ? month : "";
                            }}
                            formatter={(value: number, name: string) => [
                              formatCurrency(Number(value)),
                              name === "mrrTotal" ? "MRR" : "MRR perso"
                            ]}
                            contentStyle={{
                              background: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: 10
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="mrrTotal"
                            stroke="#0891b2"
                            strokeWidth={2.5}
                            dot={false}
                            activeDot={{ r: 4 }}
                          />
                          <Line
                            type="monotone"
                            dataKey="mrrLost"
                            stroke="#f43f5e"
                            strokeWidth={2}
                            strokeDasharray="6 4"
                            dot={false}
                            activeDot={{ r: 3 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2.5 w-2.5 rounded-sm bg-cyan-500 dark:bg-cyan-400" /> MRR
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2.5 w-2.5 rounded-sm bg-rose-400 dark:bg-rose-400" /> Perso
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-3">
                    <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Snapshot finanziario</p>
                    <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                      <p className="text-xs text-muted-foreground">Run rate annuale</p>
                      <p className="font-semibold text-foreground">{formatCurrency(arrRunRate)}</p>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                      <p className="text-xs text-muted-foreground">Mese precedente</p>
                      <p className="font-semibold text-foreground">{formatCurrency(previousMonthMrr)}</p>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                      <p className="text-xs text-muted-foreground">Mese migliore</p>
                      <p className="font-semibold text-foreground">
                        {bestMonth ? `${formatPeriodLabel(bestMonth.month)} · ${formatCurrency(bestMonth.mrrTotal)}` : "-"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="overflow-auto rounded-2xl border border-border/70">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Piano</TableHead>
                        <TableHead>Clienti attivi</TableHead>
                        <TableHead>MRR stimato</TableHead>
                        <TableHead>Share MRR</TableHead>
                        <TableHead>Seats</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {revenueBreakdown.map((row) => {
                        const share = mrrTotal > 0 ? (row.estimatedRevenue / mrrTotal) * 100 : 0;
                        return (
                          <TableRow key={row.plan}>
                            <TableCell>
                              <Badge variant="secondary">{row.plan}</Badge>
                            </TableCell>
                            <TableCell>{row.activeTenants}</TableCell>
                            <TableCell className="font-semibold">{formatCurrency(row.estimatedRevenue)}</TableCell>
                            <TableCell>{share.toFixed(1)}%</TableCell>
                            <TableCell>{row.seatsTotal}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <p className="text-xs text-muted-foreground">
                  Formula ricavi: {revenueReport.assumptions.formula}. Regola seats: {revenueReport.assumptions.seatsFactorRule}.
                </p>
              </>
            ) : (
              <FleetumInlineLoader label="Caricamento report ricavi" />
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeSection === "events" ? (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="platform-main-card">
            <CardHeader>
              <CardTitle className="text-base text-foreground">Eventi recenti platform</CardTitle>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <div className="grid place-items-center gap-2 py-8 text-sm text-muted-foreground">
                  <ShieldAlert className="h-5 w-5" />
                  Nessun evento disponibile.
                </div>
              ) : (
                <div className="space-y-3">
                  {events.map((event) => {
                    const details = parseEventDetails(event.details);
                    return (
                      <PlatformEventItem
                        key={event.id}
                        action={event.action}
                        tenantName={event.tenantName}
                        createdAt={event.createdAt}
                        actor={details.actor}
                        sourceIp={details.sourceIp}
                        quickAction={details.quickAction}
                        timeAgo={timeAgo(event.createdAt)}
                      />
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="platform-main-card">
            <CardHeader>
              <CardTitle className="text-base text-foreground">Watchlist operativa</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="platform-watch-item platform-watch-item--warning">
                <p className="platform-watch-item__text">
                  <AlertTriangle className="h-4 w-4" />
                  Licenze in scadenza: {kpis.expiringSoon}
                </p>
              </div>
              <div className="platform-watch-item platform-watch-item--danger">
                <p className="platform-watch-item__text">
                  <ShieldAlert className="h-4 w-4" />
                  Licenze sospese: {kpis.suspended}
                </p>
              </div>
              <div className="platform-watch-item platform-watch-item--info">
                <p className="platform-watch-item__text">
                  <Zap className="h-4 w-4" />
                  One-click control attivo
                </p>
              </div>
              <div className="space-y-2 pt-1">
                {users.slice(0, 8).map((user) => (
                  <div key={user.id} className="rounded-xl border border-border/70 bg-card/75 px-3 py-2 text-sm">
                    <p className="font-medium text-foreground">
                      {user.firstName} {user.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {user.email} · {user.tenant?.name ?? "N/A"} · {user.status}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeSection === "tools" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="platform-main-card">
            <CardHeader>
              <CardTitle className="text-base text-foreground">Strumenti operativi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 rounded-xl border border-border/70 bg-card/70 p-3">
                <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Azioni globali</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => load({ silent: true })}>
                    <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                    Aggiorna tutto
                  </Button>
                  <Button variant="ghost" size="sm" onClick={resetFilters}>
                    Reset filtri clienti
                  </Button>
                </div>
              </div>
              <div className="space-y-2 rounded-xl border border-border/70 bg-card/70 p-3">
                <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Navigazione rapida</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setActiveSection("clients")}>
                    Vai a Clienti
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setActiveSection("revenue")}>
                    Vai a Ricavi
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setActiveSection("events")}>
                    Vai a Eventi
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="platform-main-card">
            <CardHeader>
              <CardTitle className="text-base text-foreground">Stato workspace</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-border/70 bg-card/70 px-3 py-2 text-sm">
                <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Clienti monitorati</p>
                <p className="mt-1 font-semibold text-foreground">{tenants.length}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-card/70 px-3 py-2 text-sm">
                <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Eventi recenti caricati</p>
                <p className="mt-1 font-semibold text-foreground">{events.length}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
      </div>

      <div
        className={`fixed inset-0 z-[110] bg-slate-950/50 backdrop-blur-sm transition-opacity lg:hidden ${
          mobileSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setMobileSidebarOpen(false)}
      >
        <div
          className={`platform-admin-mobile-aside g-sidebar h-full w-[86%] max-w-xs border-r border-border/70 bg-card p-4 transition-transform ${
            mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Platform</p>
              <p className="text-sm font-semibold text-foreground">Sezioni Console</p>
            </div>
            <Button variant="outline" size="icon" onClick={() => setMobileSidebarOpen(false)} aria-label="Chiudi sidebar">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <nav className="space-y-1.5">
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={`mobile-${item.id}`}
                  type="button"
                  onClick={() => {
                    setActiveSection(item.id);
                    setMobileSidebarOpen(false);
                  }}
                  className={`platform-admin-nav-item ${isActive ? "platform-admin-nav-item--active" : ""}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-sm font-semibold text-foreground">{item.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{item.description}</span>
                  </span>
                  {item.badge ? (
                    <span className="rounded-full border border-border/80 bg-background px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {planConfirmState ? (
        <div className="fixed inset-0 z-[120] overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="mx-auto flex min-h-full w-full max-w-lg items-center py-4">
          <div className="modal-pop w-full rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl" role="dialog" aria-modal="true">
            <h3 className="text-lg font-semibold">Conferma downgrade piano</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Cliente: <span className="font-medium text-foreground">{planConfirmState.tenant.name}</span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Il piano passerà da{" "}
              <span className="font-semibold text-foreground">{normalizePlanTier(planConfirmState.tenant.license?.plan)}</span> a{" "}
              <span className="font-semibold text-foreground">{planConfirmState.nextPlan}</span>. Confermi il downgrade?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPlanConfirmState(null)}>
                Annulla
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const value = planConfirmState;
                  setPlanConfirmState(null);
                  void updateTenantPlan(value.tenant, value.nextPlan, value.forceActivate);
                }}
              >
                Conferma downgrade
              </Button>
            </div>
          </div>
          </div>
        </div>
      ) : null}

      {confirmState ? (
        <div className="fixed inset-0 z-[120] overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="mx-auto flex min-h-full w-full max-w-lg items-center py-4">
          <div className="modal-pop w-full rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl" role="dialog" aria-modal="true">
            <h3 className="text-lg font-semibold">{confirmState.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Cliente: <span className="font-medium text-foreground">{confirmState.tenantName}</span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{confirmState.description}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmState(null)}>
                Annulla
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const value = confirmState;
                  setConfirmState(null);
                  void runAction(value.tenantId, value.action);
                }}
              >
                Conferma azione
              </Button>
            </div>
          </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
