import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  FileText,
  Globe2,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  Mail,
  PanelLeftClose,
  RefreshCcw,
  Search,
  Send,
  Server,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRoundCheck,
  Users,
  X,
  XCircle,
  Zap
} from "lucide-react";
import {
  LicenseStatus,
  PlatformDashboardLiveMetrics,
  PlatformDemoLead,
  PlatformInvoice,
  PlatformOverview,
  platformAdminUseCases,
  PlatformRevenueMetrics,
  PlatformSecurityOverview,
  PlatformSystemHealth,
  PlatformTrustedDevice,
  PlatformWebsiteAnalytics,
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
import { PLAN_MONTHLY_PRICING_EUR } from "../../../domain/constants/entitlements";
import { cn } from "../../../lib/utils";
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

type PlatformSectionId = "overview" | "tenants" | "plans" | "billing" | "analytics" | "leads" | "users" | "audit" | "health" | "security" | "settings";
type RevenueRange = "2W" | "1M" | "6M" | "1Y";
type AnalyticsWindowDays = 7 | 30 | 90;

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
  if (status === "PENDING") return "warning" as const;
  if (status === "TRIAL") return "secondary" as const;
  if (status === "PAST_DUE") return "warning" as const;
  if (status === "EXPIRED") return "destructive" as const;
  if (status === "CANCELED") return "destructive" as const;
  return "warning" as const;
};

const licenseStatusLabel = (status?: LicenseStatus) => {
  if (status === "ACTIVE") return "Attiva";
  if (status === "PENDING") return "In attesa checkout";
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
const formatBytes = (value?: number | null) => {
  const bytes = value ?? 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: size >= 10 ? 1 : 2 }).format(size)} ${units[unitIndex]}`;
};
const formatInvoicePeriod = (start?: string, end?: string) => {
  if (!start || !end) return "-";
  return `${formatDate(start)} - ${formatDate(end)}`;
};

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

const analyticsWindowOptions: Array<{ value: AnalyticsWindowDays; label: string }> = [
  { value: 7, label: "7 giorni" },
  { value: 30, label: "30 giorni" },
  { value: 90, label: "90 giorni" }
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

const formatDuration = (seconds?: number | null) => {
  if (seconds === null || seconds === undefined || seconds < 0) return "n/d";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}g ${remainingHours}h` : `${days}g`;
};

const invoiceStatusLabel = (status: PlatformInvoice["status"]) => {
  if (status === "GENERATED") return "Generata";
  if (status === "SENT") return "Inviata";
  if (status === "PAID") return "Pagata";
  if (status === "OVERDUE") return "Scaduta";
  if (status === "VOID") return "Annullata";
  if (status === "ERROR") return "Errore";
  return "Bozza";
};

const invoiceStatusVariant = (status: PlatformInvoice["status"]) => {
  if (status === "PAID") return "success" as const;
  if (status === "SENT" || status === "GENERATED") return "secondary" as const;
  if (status === "OVERDUE") return "warning" as const;
  if (status === "ERROR" || status === "VOID") return "destructive" as const;
  return "secondary" as const;
};

const leadStatusLabel = (status: PlatformDemoLead["status"]) => {
  if (status === "NEW") return "Nuovo";
  if (status === "CONTACTED") return "Contattato";
  if (status === "QUALIFIED") return "Qualificato";
  if (status === "WON") return "Convertito";
  if (status === "LOST") return "Perso";
  return "Spam";
};

const leadStatusVariant = (status: PlatformDemoLead["status"]) => {
  if (status === "NEW") return "warning" as const;
  if (status === "CONTACTED" || status === "QUALIFIED") return "secondary" as const;
  if (status === "WON") return "success" as const;
  return "destructive" as const;
};

const operationalStatusVariant = (status?: string) => {
  if (!status) return "secondary" as const;
  if (["UP", "CONFIGURED", "SMTP", "LOCAL", "S3", "PASS"].includes(status)) return "success" as const;
  if (["NOT_CONFIGURED", "MISSING_KEY", "MISSING", "STALE"].includes(status)) return "warning" as const;
  return "destructive" as const;
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
  const [invoices, setInvoices] = useState<PlatformInvoice[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [websiteAnalytics, setWebsiteAnalytics] = useState<PlatformWebsiteAnalytics | null>(null);
  const [demoLeads, setDemoLeads] = useState<PlatformDemoLead[]>([]);
  const [systemHealth, setSystemHealth] = useState<PlatformSystemHealth | null>(null);
  const [securityOverview, setSecurityOverview] = useState<PlatformSecurityOverview | null>(null);
  const [trustedDevices, setTrustedDevices] = useState<PlatformTrustedDevice[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<TenantRow | null>(null);
  const [search, setSearch] = useState("");
  const [licenseFilter, setLicenseFilter] = useState<"ALL" | LicenseStatus>("ALL");
  const [planFilter, setPlanFilter] = useState<"ALL" | PlanTier>("ALL");
  const [tenantStatusFilter, setTenantStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editingTenant, setEditingTenant] = useState<TenantRow | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [planConfirmState, setPlanConfirmState] = useState<PlanConfirmState>(null);
  const [rowLoading, setRowLoading] = useState<Record<string, boolean>>({});
  const [invoiceLoading, setInvoiceLoading] = useState<Record<string, boolean>>({});
  const [rowFeedback, setRowFeedback] = useState<Record<string, { type: "success" | "error" | "loading"; message: string }>>({});
  const [rowActionDrafts, setRowActionDrafts] = useState<Record<string, RowActionSelection>>({});
  const [planDrafts, setPlanDrafts] = useState<Record<string, PlanTier>>({});
  const reportMonth = useMemo(() => toMonthKey(new Date()), []);
  const [revenueRange, setRevenueRange] = useState<RevenueRange>("1Y");
  const [analyticsWindowDays, setAnalyticsWindowDays] = useState<AnalyticsWindowDays>(30);
  const [revenueReport, setRevenueReport] = useState<PlatformRevenueMetrics | null>(null);
  const [dashboardLive, setDashboardLive] = useState<PlatformDashboardLiveMetrics | null>(null);
  const [activeSection, setActiveSection] = useState<PlatformSectionId>("overview");
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
      const [tenantData, invoiceData, userData, eventData, revenueData, overviewData, analyticsData, demoLeadData, healthData, securityData, trustedDeviceData] = await Promise.all([
        platformAdminUseCases.listTenants(),
        platformAdminUseCases.listInvoices(),
        platformAdminUseCases.listUsers(),
        platformAdminUseCases.listRecentEvents(20),
        platformAdminUseCases.revenueMetrics(revenueQuery),
        platformAdminUseCases.overview(30),
        platformAdminUseCases.websiteAnalytics(analyticsWindowDays),
        platformAdminUseCases.listDemoLeads(),
        platformAdminUseCases.systemHealth(),
        platformAdminUseCases.securityOverview(),
        platformAdminUseCases.listTrustedDevices()
      ]);
      setTenants(tenantData.data);
      setInvoices(invoiceData.data);
      setUsers(userData.data);
      setEvents(eventData.data);
      setRevenueReport(revenueData);
      setOverview(overviewData.data);
      setWebsiteAnalytics(analyticsData.data);
      setDemoLeads(demoLeadData.data);
      setSystemHealth(healthData.data);
      setSecurityOverview(securityData.data);
      setTrustedDevices(trustedDeviceData.data);
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
  }, [revenueRange, analyticsWindowDays]);

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
      value === "overview" ||
      value === "tenants" ||
      value === "plans" ||
      value === "billing" ||
      value === "analytics" ||
      value === "leads" ||
      value === "users" ||
      value === "audit" ||
      value === "health" ||
      value === "security" ||
      value === "settings";

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
      const licenseStatus = tenant.license?.status ?? "PENDING";
      const matchesLicense = licenseFilter === "ALL" || licenseStatus === licenseFilter;
      const matchesPlan = planFilter === "ALL" || normalizePlanTier(tenant.license?.plan) === planFilter;
      const tenantState = tenant.isActive ? "ACTIVE" : "INACTIVE";
      const matchesTenantStatus = tenantStatusFilter === "ALL" || tenantStatusFilter === tenantState;
      return matchesSearch && matchesLicense && matchesPlan && matchesTenantStatus;
    });
  }, [licenseFilter, planFilter, search, tenantStatusFilter, tenants]);

  const kpis = useMemo(() => {
    const activeTenants = tenants.filter((tenant) => tenant.isActive).length;
    const activeLicenses = tenants.filter((tenant) => (tenant.license?.status ?? "PENDING") === "ACTIVE").length;
    const expiringSoon = tenants.filter((tenant) => isExpiringSoon(tenant.license?.expiresAt)).length;
    const suspended = tenants.filter((tenant) => {
      const status = tenant.license?.status ?? "PENDING";
      return status === "PENDING" || status === "SUSPENDED" || status === "EXPIRED" || status === "PAST_DUE" || status === "CANCELED";
    }).length;
    const tenantsByPlan = PLAN_TIERS.reduce(
      (acc, plan) => ({ ...acc, [plan]: tenants.filter((tenant) => normalizePlanTier(tenant.license?.plan) === plan).length }),
      {} as Record<PlanTier, number>
    );
    return { activeTenants, activeLicenses, expiringSoon, suspended, tenantsByPlan };
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
        const licenseStatus = tenant.license?.status ?? "PENDING";
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

  const revokeTrustedDevice = async (device: PlatformTrustedDevice) => {
    try {
      await platformAdminUseCases.revokeTrustedDevice(device.id);
      snackbar.success("Dispositivo fidato revocato");
      await load({ silent: true });
    } catch (err) {
      if (handlePlatformAuthError(err)) return;
      snackbar.error((err as Error).message);
    }
  };

  const updateTenantPlan = async (tenant: TenantRow, nextPlan: PlanTier, forceActivate: boolean) => {
    const currentPlan = normalizePlanTier(tenant.license?.plan);
    const licenseStatus = tenant.license?.status ?? "PENDING";
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
      setSelectedTenant((current) =>
        current?.id === tenant.id
          ? {
              ...current,
              license: {
                ...current.license,
                ...(typeof result?.after === "object" && result.after ? result.after : {})
              }
            }
          : current
      );
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
    requestDirectPlanUpdate(tenant, nextPlan, forceActivate);
  };

  const requestDirectPlanUpdate = (tenant: TenantRow, nextPlan: PlanTier, forceActivate: boolean) => {
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

  const generateInvoice = async (tenant: TenantRow) => {
    setInvoiceLoading((old) => ({ ...old, [tenant.id]: true }));
    try {
      const result = await platformAdminUseCases.generateInvoice(tenant.id);
      snackbar.success(`Fattura ${result.data.invoiceNumber} generata`);
      setInvoices((old) => [result.data, ...old]);
      setActiveSection("billing");
    } catch (err) {
      if (handlePlatformAuthError(err)) return;
      snackbar.error((err as Error).message);
    } finally {
      setInvoiceLoading((old) => ({ ...old, [tenant.id]: false }));
    }
  };

  const sendInvoice = async (invoice: PlatformInvoice) => {
    setInvoiceLoading((old) => ({ ...old, [invoice.id]: true }));
    try {
      const result = await platformAdminUseCases.sendInvoiceEmail(invoice.id);
      snackbar.success(`Fattura ${result.data.invoiceNumber} inviata`);
      setInvoices((old) => old.map((item) => (item.id === invoice.id ? result.data : item)));
    } catch (err) {
      if (handlePlatformAuthError(err)) return;
      snackbar.error((err as Error).message);
      void load({ silent: true });
    } finally {
      setInvoiceLoading((old) => ({ ...old, [invoice.id]: false }));
    }
  };

  const markInvoicePaid = async (invoice: PlatformInvoice) => {
    setInvoiceLoading((old) => ({ ...old, [invoice.id]: true }));
    try {
      const result = await platformAdminUseCases.updateInvoiceStatus(invoice.id, "PAID");
      snackbar.success(`Fattura ${result.data.invoiceNumber} marcata pagata`);
      setInvoices((old) => old.map((item) => (item.id === invoice.id ? result.data : item)));
    } catch (err) {
      if (handlePlatformAuthError(err)) return;
      snackbar.error((err as Error).message);
    } finally {
      setInvoiceLoading((old) => ({ ...old, [invoice.id]: false }));
    }
  };

  const downloadInvoice = async (invoice: PlatformInvoice) => {
    try {
      const blob = await platformAdminUseCases.downloadInvoicePdf(invoice.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${invoice.invoiceNumber}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (handlePlatformAuthError(err)) return;
      snackbar.error((err as Error).message);
    }
  };

  const updateDemoLeadStatus = async (lead: PlatformDemoLead, status: PlatformDemoLead["status"]) => {
    try {
      const result = await platformAdminUseCases.updateDemoLead(lead.id, status);
      setDemoLeads((old) => old.map((item) => (item.id === lead.id ? result.data : item)));
      snackbar.success(`Lead ${lead.companyName} aggiornato`);
      void load({ silent: true });
    } catch (err) {
      if (handlePlatformAuthError(err)) return;
      snackbar.error((err as Error).message);
    }
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
    setPlanFilter("ALL");
    setLicenseFilter("ALL");
    setTenantStatusFilter("ALL");
  };

  const sectionDescription: Record<PlatformSectionId, string> = {
    overview: "Control room platform con KPI, alert e priorita operative",
    tenants: "Gestione tenant, piani, licenze e quick action",
    plans: "MRR, breakdown piani, trend e export finanziario",
    billing: "Fatture SaaS, PDF, invio email e stato delivery",
    analytics: "Visite sito, CTA, funnel onboarding, checkout e trial",
    leads: "Richieste demo, qualificazione e follow-up commerciale",
    users: "Utenti SaaS aggregati e stato account",
    audit: "Audit operativo, eventi recenti e watchlist",
    health: "Stato API, database, email, Stripe, storage e code",
    security: "Controlli platform, OTP, IP allowlist e sessioni",
    settings: "Configurazioni globali platform e provider"
  };
  const sidebarItems: Array<{
    id: PlatformSectionId;
    label: string;
    description: string;
    icon: any;
    badge?: string;
  }> = [
    {
      id: "overview",
      label: "Overview",
      description: "Control room globale",
      icon: LayoutDashboard,
      badge: String(overview?.kpis.emailErrors ?? 0)
    },
    {
      id: "tenants",
      label: "Tenants",
      description: "Clienti, piani, licenze",
      icon: Building2,
      badge: String(tenants.length)
    },
    {
      id: "plans",
      label: "Licenze & Piani",
      description: "MRR e pricing",
      icon: BarChart3,
      badge: String(revenueActiveTenants)
    },
    {
      id: "billing",
      label: "Billing",
      description: "Fatture e invii email",
      icon: FileText,
      badge: String(invoices.length)
    },
    {
      id: "analytics",
      label: "Website Analytics",
      description: "Funnel e sorgenti",
      icon: Globe2,
      badge: String(websiteAnalytics?.totals.pageViews ?? 0)
    },
    {
      id: "leads",
      label: "Demo Leads",
      description: "CRM leggero",
      icon: UserRoundCheck,
      badge: String(demoLeads.filter((lead) => lead.status === "NEW").length)
    },
    {
      id: "users",
      label: "Utenti",
      description: "Utenti globali",
      icon: Users,
      badge: String(users.length)
    },
    {
      id: "audit",
      label: "Eventi & Audit",
      description: "Audit e watchlist operativa",
      icon: Activity,
      badge: String(events.length)
    },
    {
      id: "health",
      label: "System Health",
      description: "API, DB, email",
      icon: Server,
      badge: systemHealth?.db.status ?? "DB"
    },
    {
      id: "security",
      label: "Security",
      description: "OTP e controlli",
      icon: ShieldCheck,
      badge: String(securityOverview?.auth.blockedLoginStates ?? 0)
    },
    {
      id: "settings",
      label: "Impostazioni",
      description: "Provider e config",
      icon: SlidersHorizontal
    }
  ];
  const tenantPriorityList = useMemo(() => {
    const riskScore = (tenant: TenantRow) => {
      let score = 0;
      if (!tenant.isActive) score += 2;
      const licenseStatus = tenant.license?.status ?? "PENDING";
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
                const licenseStatus = tenant.license?.status ?? "PENDING";
                return (
                  <button
                    key={`priority-${tenant.id}`}
                    type="button"
                    onClick={() => {
                      setSearch(tenant.name);
                      setActiveSection("tenants");
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
                <Button variant="secondary" size="sm" className="w-full" onClick={() => setActiveSection("tenants")}>
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

      {activeSection === "tenants" ? (
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

              <div className="grid gap-2 md:grid-cols-[1.5fr_0.8fr_1fr_1fr_auto]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="Cerca cliente o owner..." />
                </div>
                <Select value={planFilter} onChange={(e) => setPlanFilter(e.target.value as PlanTier | "ALL")}>
                  <option value="ALL">Piano: tutti</option>
                  {PLAN_TIERS.map((plan) => (
                    <option key={`filter-${plan}`} value={plan}>
                      {plan}
                    </option>
                  ))}
                </Select>
                <Select value={licenseFilter} onChange={(e) => setLicenseFilter(e.target.value as LicenseStatus | "ALL")}>
                  <option value="ALL">Licenza: tutte</option>
                  <option value="PENDING">PENDING</option>
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

              <div className="grid gap-2 sm:grid-cols-3">
                {PLAN_TIERS.map((plan) => (
                  <button
                    key={`quick-filter-${plan}`}
                    type="button"
                    onClick={() => setPlanFilter(planFilter === plan ? "ALL" : plan)}
                    className={`rounded-2xl border px-3 py-2 text-left transition ${
                      planFilter === plan
                        ? "border-indigo-400 bg-indigo-50 text-indigo-900 shadow-sm dark:border-indigo-400/60 dark:bg-indigo-500/15 dark:text-indigo-100"
                        : "border-border/70 bg-background/70 text-foreground hover:border-indigo-300 hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10"
                    }`}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{plan}</span>
                    <span className="mt-1 flex items-end justify-between gap-2">
                      <strong className="text-lg">{kpis.tenantsByPlan[plan]}</strong>
                      <span className="text-xs text-muted-foreground">{formatCurrency(PLAN_MONTHLY_PRICING_EUR[plan])}/mese</span>
                    </span>
                  </button>
                ))}
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
                        const licenseStatus = tenant.license?.status ?? "PENDING";
                        const hasPlanChanges = hasPlanChange(currentPlan, selectedPlan);
                        const canActivateWithPlan = licenseStatus !== "ACTIVE";
                        const profileComplete = tenant.company?.profileCompleted;
                        const companyName = tenant.company?.legalName || tenant.company?.tradeName || tenant.name;
                        const displayedPrice = tenant.license?.priceMonthly ?? PLAN_MONTHLY_PRICING_EUR[currentPlan];

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
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Badge
                                    variant={currentPlan === "ENTERPRISE" ? "success" : currentPlan === "PRO" ? "secondary" : "outline"}
                                    className="text-[10px] font-bold tracking-[0.08em]"
                                  >
                                    {currentPlan}
                                  </Badge>
                                  <span className="text-[11px] text-muted-foreground">
                                    {formatCurrency(displayedPrice)}/mese
                                  </span>
                                </div>
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
                                <div className="grid grid-cols-2 gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy || !hasPlanChanges}
                                    className="h-7 min-w-0 text-[11px]"
                                    onClick={() => requestPlanUpdate(tenant, false)}
                                  >
                                    Salva
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={canActivateWithPlan ? "secondary" : "ghost"}
                                    disabled={busy || (!hasPlanChanges && !canActivateWithPlan)}
                                    className="h-7 min-w-0 text-[11px]"
                                    onClick={() => requestPlanUpdate(tenant, true)}
                                  >
                                    {canActivateWithPlan ? "Salva + attiva" : "Già attiva"}
                                  </Button>
                                </div>
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
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={!!invoiceLoading[tenant.id]}
                                    className="h-7 w-full min-w-0 text-[11px]"
                                    onClick={() => generateInvoice(tenant)}
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                    {invoiceLoading[tenant.id] ? "Genero..." : "Invia fattura"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-full min-w-0 text-[11px]"
                                    onClick={() => setSelectedTenant(tenant)}
                                  >
                                    Apri drawer
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
                    <Select name="status" defaultValue={editingTenant.license?.status ?? "PENDING"}>
                      <option value="PENDING">PENDING</option>
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
                      placeholder={`Standard ${formatCurrency(
                        PLAN_MONTHLY_PRICING_EUR[normalizePlanTier(editingTenant.license?.plan)]
                      )}`}
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

      {activeSection === "billing" ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Card className="platform-stat-card">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Fatture</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{invoices.length}</p>
              </CardContent>
            </Card>
            <Card className="platform-stat-card">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Inviate</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-600 dark:text-emerald-300">
                  {invoices.filter((invoice) => invoice.status === "SENT" || invoice.status === "PAID").length}
                </p>
              </CardContent>
            </Card>
            <Card className="platform-stat-card">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Da inviare</p>
                <p className="mt-2 text-2xl font-semibold text-amber-600 dark:text-amber-300">
                  {invoices.filter((invoice) => invoice.status === "GENERATED").length}
                </p>
              </CardContent>
            </Card>
            <Card className="platform-stat-card">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Totale documenti</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {formatCurrency(invoices.reduce((sum, invoice) => sum + invoice.total, 0))}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="platform-main-card platform-main-surface">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base text-foreground">
                    <FileText className="h-4 w-4 text-primary" />
                    Fatture SaaS Fleetum
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Genera PDF premium, invia via email e traccia lo stato delivery. I PDF sono copie di cortesia se non emessi via SDI.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => load({ silent: true })}>
                  <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  Aggiorna
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {invoices.length === 0 ? (
                <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-border/80 bg-card/50 py-12 text-center">
                  <FileText className="h-7 w-7 text-muted-foreground" />
                  <div>
                    <p className="font-semibold text-foreground">Nessuna fattura generata</p>
                    <p className="mt-1 text-sm text-muted-foreground">Apri Clienti e usa “Genera fattura” sulla riga tenant.</p>
                  </div>
                </div>
              ) : (
                <div className="overflow-auto rounded-2xl border border-border/70">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Numero</TableHead>
                        <TableHead>Tenant</TableHead>
                        <TableHead>Periodo</TableHead>
                        <TableHead>Totale</TableHead>
                        <TableHead>Stato</TableHead>
                        <TableHead>Delivery</TableHead>
                        <TableHead>Azioni</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((invoice) => {
                        const latestDelivery = invoice.deliveries[0];
                        const busy = !!invoiceLoading[invoice.id];
                        return (
                          <TableRow key={invoice.id}>
                            <TableCell>
                              <div className="space-y-1">
                                <p className="font-semibold text-foreground">{invoice.invoiceNumber}</p>
                                <p className="text-xs text-muted-foreground">Emessa {formatDate(invoice.issueDate)}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <p className="font-medium text-foreground">{invoice.billingName}</p>
                                <p className="text-xs text-muted-foreground">{invoice.billingEmail ?? invoice.tenantName}</p>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatInvoicePeriod(invoice.periodStart, invoice.periodEnd)}
                            </TableCell>
                            <TableCell className="font-semibold text-foreground">{formatCurrency(invoice.total)}</TableCell>
                            <TableCell>
                              <Badge variant={invoiceStatusVariant(invoice.status)}>{invoiceStatusLabel(invoice.status)}</Badge>
                            </TableCell>
                            <TableCell>
                              {latestDelivery ? (
                                <div className="space-y-1">
                                  <Badge variant={latestDelivery.status === "SENT" ? "success" : latestDelivery.status === "FAILED" ? "destructive" : "secondary"}>
                                    {latestDelivery.status}
                                  </Badge>
                                  <p className="text-xs text-muted-foreground">{latestDelivery.providerMessageId ?? latestDelivery.errorMessage ?? latestDelivery.recipient}</p>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">Non inviata</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1.5">
                                <Button size="sm" variant="outline" disabled={busy} onClick={() => downloadInvoice(invoice)}>
                                  <Download className="h-3.5 w-3.5" />
                                  PDF
                                </Button>
                                <Button size="sm" disabled={busy || !invoice.billingEmail} onClick={() => sendInvoice(invoice)}>
                                  <Send className="h-3.5 w-3.5" />
                                  {invoice.status === "SENT" ? "Reinvia" : "Invia"}
                                </Button>
                                {invoice.status !== "PAID" ? (
                                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => markInvoicePaid(invoice)}>
                                    Pagata
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeSection === "plans" ? (
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

      {activeSection === "analytics" ? (
        <div className="space-y-4">
          <Card className="platform-main-card">
            <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Acquisizione Fleetum</p>
                <h2 className="mt-1 text-xl font-semibold text-foreground">Funnel sito, onboarding e trial</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Eventi first-party raccolti solo dopo consenso Analytics. Il checkout completato e il trial attivato vengono confermati dal webhook Stripe.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {analyticsWindowOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAnalyticsWindowDays(option.value)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-xs font-semibold transition",
                      analyticsWindowDays === option.value
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 md:grid-cols-4">
            <Card className="platform-stat-card">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Page view {analyticsWindowDays}gg</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{websiteAnalytics?.totals.pageViews ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="platform-stat-card">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Visitatori stimati</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{websiteAnalytics?.totals.uniqueVisitors ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="platform-stat-card">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">CTA click</p>
                <p className="mt-2 text-2xl font-semibold text-cyan-600 dark:text-cyan-300">{websiteAnalytics?.totals.ctaClicks ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="platform-stat-card">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Account creati</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-600 dark:text-emerald-300">{websiteAnalytics?.totals.signupCompleted ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="platform-stat-card">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Checkout completati</p>
                <p className="mt-2 text-2xl font-semibold text-amber-600 dark:text-amber-300">{websiteAnalytics?.totals.checkoutCompleted ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="platform-stat-card">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Trial attivati</p>
                <p className="mt-2 text-2xl font-semibold text-violet-600 dark:text-violet-300">{websiteAnalytics?.totals.trialActivated ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="platform-stat-card">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Visita → trial</p>
                <p className="mt-2 text-2xl font-semibold text-fuchsia-600 dark:text-fuchsia-300">{websiteAnalytics?.totals.visitToTrialRate ?? 0}%</p>
              </CardContent>
            </Card>
            <Card className="platform-stat-card">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Checkout success rate</p>
                <p className="mt-2 text-2xl font-semibold text-blue-600 dark:text-blue-300">{websiteAnalytics?.totals.checkoutCompletionRate ?? 0}%</p>
              </CardContent>
            </Card>
            <Card className="platform-stat-card">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Checkout falliti</p>
                <p className="mt-2 text-2xl font-semibold text-rose-600 dark:text-rose-300">{websiteAnalytics?.totals.checkoutFailed ?? 0}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
            <Card className="platform-main-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-foreground">
                  <Globe2 className="h-4 w-4 text-primary" />
                  Website Analytics
                </CardTitle>
                <p className="text-xs text-muted-foreground">Tracking first-party solo dopo consenso Analytics: IP hashato, referrer ridotto al dominio e nessun cookie invasivo.</p>
              </CardHeader>
              <CardContent>
                {(websiteAnalytics?.trend.length ?? 0) === 0 ? (
                  <div className="grid place-items-center gap-2 rounded-2xl border border-dashed border-border/80 bg-card/50 py-12 text-center">
                    <Globe2 className="h-7 w-7 text-muted-foreground" />
                    <p className="font-semibold text-foreground">Nessun evento sito ancora raccolto</p>
                    <p className="max-w-md text-sm text-muted-foreground">
                      Dopo il consenso Analytics, la platform riceve PAGE_VIEW, CTA_CLICK, signup, onboarding e checkout events.
                    </p>
                  </div>
                ) : (
                  <div className="h-72 rounded-2xl border border-border/70 bg-background/70 p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={websiteAnalytics?.trend ?? []} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.45} />
                        <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                        <YAxis width={42} tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                        <Tooltip
                          cursor={false}
                          isAnimationActive={false}
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: 10
                          }}
                        />
                        <Line type="monotone" dataKey="pageViews" stroke="#2563ff" strokeWidth={2.5} dot={false} />
                        <Line type="monotone" dataKey="demoSubmits" stroke="#00b8a9" strokeWidth={2.3} dot={false} />
                        <Line type="monotone" dataKey="signups" stroke="#f59e0b" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="checkoutStarted" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="trialActivated" stroke="#10b981" strokeWidth={2.3} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="platform-main-card">
              <CardHeader>
                <CardTitle className="text-base text-foreground">Funnel conversione</CardTitle>
                <p className="text-xs text-muted-foreground">Dove si blocca il percorso: visita, signup, dati aziendali, checkout e trial.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {(websiteAnalytics?.funnel.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">Nessun funnel disponibile.</p> : null}
                {websiteAnalytics?.funnel.map((step, index) => {
                  const maxValue = Math.max(...(websiteAnalytics?.funnel ?? []).map((item) => item.value), 1);
                  const width = Math.max(4, Math.round((step.value / maxValue) * 100));
                  return (
                    <div key={step.key} className="rounded-2xl border border-border/70 bg-card/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{index + 1}. {step.label}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {step.rateFromPrevious}% dallo step precedente · {step.rateFromVisits}% dalle visite
                          </p>
                        </div>
                        <Badge variant="secondary">{step.value}</Badge>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-gradient-to-r from-blue-600 via-violet-600 to-emerald-500" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                  Se "checkout avviati" cresce ma "trial attivati" resta basso, controlla prezzo, fiducia, carta richiesta e copy Stripe.
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]">
            <Card className="platform-main-card">
              <CardHeader>
                <CardTitle className="text-base text-foreground">Performance sorgenti</CardTitle>
                <p className="text-xs text-muted-foreground">Classifica per trial, checkout e visite. Utile per capire quali canali portano clienti paganti, non solo traffico.</p>
              </CardHeader>
              <CardContent>
                {(websiteAnalytics?.sourcePerformance.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">Nessuna sorgente attribuita ancora disponibile.</p>
                ) : (
                  <div className="overflow-auto rounded-2xl border border-border/70">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Sorgente</TableHead>
                          <TableHead>Visite</TableHead>
                          <TableHead>Signup</TableHead>
                          <TableHead>Checkout</TableHead>
                          <TableHead>Trial</TableHead>
                          <TableHead>Visit → trial</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {websiteAnalytics?.sourcePerformance.map((row) => (
                          <TableRow key={`source-performance-${row.label}`}>
                            <TableCell className="max-w-[220px] truncate font-medium">{row.label}</TableCell>
                            <TableCell>{row.pageViews}</TableCell>
                            <TableCell>{row.signupCompleted}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span>{row.checkoutCompleted}</span>
                                {row.checkoutFailed > 0 ? <Badge variant="warning">{row.checkoutFailed} falliti</Badge> : null}
                              </div>
                            </TableCell>
                            <TableCell>{row.trialActivated}</TableCell>
                            <TableCell>{row.visitToTrialRate}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="platform-main-card">
              <CardHeader>
                <CardTitle className="text-base text-foreground">Top insights</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Sorgenti UTM</p>
                  <div className="mt-2 space-y-1.5">
                    {(websiteAnalytics?.topSources.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">Nessuna sorgente UTM ancora disponibile.</p> : null}
                    {websiteAnalytics?.topSources.slice(0, 5).map((row) => (
                      <div key={`source-${row.label}`} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/70 px-3 py-2 text-sm">
                        <span className="truncate text-foreground">{row.label}</span>
                        <Badge variant="secondary">{row.value}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Campagne</p>
                  <div className="mt-2 space-y-1.5">
                    {(websiteAnalytics?.topCampaigns.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">Nessuna campagna UTM ancora disponibile.</p> : null}
                    {websiteAnalytics?.topCampaigns.slice(0, 5).map((row) => (
                      <div key={`campaign-${row.label}`} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/70 px-3 py-2 text-sm">
                        <span className="truncate text-foreground">{row.label}</span>
                        <Badge variant="secondary">{row.value}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Top pagine</p>
                  <div className="mt-2 space-y-1.5">
                    {(websiteAnalytics?.topPages.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">Nessun dato disponibile.</p> : null}
                    {websiteAnalytics?.topPages.slice(0, 6).map((row) => (
                      <div key={`page-${row.label}`} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/70 px-3 py-2 text-sm">
                        <span className="truncate text-foreground">{row.label}</span>
                        <Badge variant="secondary">{row.value}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Device</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
                    {websiteAnalytics?.deviceBreakdown.map((row) => (
                      <div key={`device-${row.label}`} className="rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                        <p className="text-xs text-muted-foreground">{row.label}</p>
                        <p className="font-semibold text-foreground">{row.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {activeSection === "leads" ? (
        <Card className="platform-main-card platform-main-surface">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-foreground">
              <UserRoundCheck className="h-4 w-4 text-primary" />
              Demo Leads
            </CardTitle>
            <p className="text-xs text-muted-foreground">CRM leggero per qualificare richieste demo, controllare delivery email e convertire i lead in tenant.</p>
          </CardHeader>
          <CardContent>
            {demoLeads.length === 0 ? (
              <div className="grid place-items-center gap-2 rounded-2xl border border-dashed border-border/80 bg-card/50 py-12 text-center">
                <UserRoundCheck className="h-7 w-7 text-muted-foreground" />
                <p className="font-semibold text-foreground">Nessuna richiesta demo salvata</p>
                <p className="text-sm text-muted-foreground">Il form /demo ora crea lead persistenti oltre all'invio email.</p>
              </div>
            ) : (
              <div className="overflow-auto rounded-2xl border border-border/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Azienda</TableHead>
                      <TableHead>Referente</TableHead>
                      <TableHead>Flotta</TableHead>
                      <TableHead>Origine</TableHead>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Stato</TableHead>
                      <TableHead>Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {demoLeads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell>
                          <p className="font-semibold text-foreground">{lead.companyName}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(lead.createdAt)} · {lead.source}</p>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-foreground">{lead.fullName}</p>
                          <p className="text-xs text-muted-foreground">{lead.emailMasked ?? lead.email}</p>
                        </TableCell>
                        <TableCell>{lead.fleetSize ?? "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{lead.utmSource ?? lead.referrer ?? "diretta"}</TableCell>
                        <TableCell>
                          <Badge variant={lead.emailDeliveryStatus === "SENT" ? "success" : lead.emailDeliveryStatus === "FAILED" ? "destructive" : "secondary"}>
                            {lead.emailDeliveryStatus ?? "n/a"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={leadStatusVariant(lead.status)}>{leadStatusLabel(lead.status)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={lead.status}
                            className="h-8 min-w-[132px] text-xs"
                            onChange={(event) => updateDemoLeadStatus(lead, event.target.value as PlatformDemoLead["status"])}
                            aria-label={`Aggiorna stato lead ${lead.companyName}`}
                          >
                            <option value="NEW">Nuovo</option>
                            <option value="CONTACTED">Contattato</option>
                            <option value="QUALIFIED">Qualificato</option>
                            <option value="WON">Convertito</option>
                            <option value="LOST">Perso</option>
                            <option value="SPAM">Spam</option>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeSection === "users" ? (
        <Card className="platform-main-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-foreground">
              <Users className="h-4 w-4 text-primary" />
              Utenti SaaS globali
            </CardTitle>
            <p className="text-xs text-muted-foreground">Vista founder-only: stato utenti aggregato per supporto e audit, senza esporre la Platform ai tenant.</p>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-2xl border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Utente</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>Supporto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium text-foreground">{user.firstName} {user.lastName}</TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>{user.tenant?.name ?? "N/A"}</TableCell>
                      <TableCell><Badge variant={user.status === "ACTIVE" ? "success" : "warning"}>{user.status}</Badge></TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => {
                          const tenant = tenants.find((item) => item.name === user.tenant?.name);
                          if (tenant) setSelectedTenant(tenant);
                        }}>
                          Apri tenant
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeSection === "health" ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {[
            { label: "API", status: systemHealth?.api.status, detail: `${systemHealth?.api.responseTimeMs ?? 0} ms`, icon: Server },
            { label: "Database", status: systemHealth?.db.status, detail: "Query SELECT 1", icon: Database },
            { label: "Email", status: systemHealth?.email.status, detail: `${systemHealth?.email.provider ?? "-"} · ${systemHealth?.email.failed ?? 0} failed`, icon: Mail },
            { label: "Stripe", status: systemHealth?.stripe.status, detail: "Billing provider", icon: BarChart3 },
            {
              label: "Storage",
              status: systemHealth?.storage.status,
              detail: `${systemHealth?.storage.provider ?? "-"} · ${formatBytes(systemHealth?.storage.activeBytes)}`,
              icon: HardDrive
            },
            {
              label: "Restore drill",
              status: systemHealth?.restoreDrill.status,
              detail: systemHealth?.restoreDrill.generatedAt
                ? `${timeAgo(systemHealth.restoreDrill.generatedAt)} · RTO ${formatDuration(systemHealth.restoreDrill.rtoSeconds)}`
                : "Nessun drill registrato",
              icon: RefreshCcw
            },
            { label: "Fatture", status: (systemHealth?.invoices.errors ?? 0) > 0 ? "ERROR" : "UP", detail: `${systemHealth?.invoices.errors ?? 0} errori`, icon: FileText }
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.label} className="platform-stat-card">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{item.label}</p>
                      <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
                    </div>
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <Badge className="mt-4" variant={operationalStatusVariant(item.status)}>{item.status ?? "n/a"}</Badge>
                </CardContent>
              </Card>
            );
          })}
          <Card className="lg:col-span-2 xl:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <HardDrive className="h-5 w-5 text-primary" />
                Storage, documenti e retention
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    label: "File attivi",
                    value: String(systemHealth?.storage.activeFiles ?? 0),
                    detail: formatBytes(systemHealth?.storage.activeBytes),
                    icon: FileText
                  },
                  {
                    label: "In attesa retention",
                    value: String(systemHealth?.storage.deletedFilesPendingRetention ?? 0),
                    detail: formatBytes(systemHealth?.storage.deletedBytesPendingRetention),
                    icon: Archive
                  },
                  {
                    label: "Provider",
                    value: systemHealth?.storage.provider ?? "-",
                    detail: systemHealth?.storage.bucket ? `Bucket ${systemHealth.storage.bucket}` : systemHealth?.storage.uploadDir ?? "-",
                    icon: HardDrive
                  },
                  {
                    label: "Ultimo cleanup",
                    value: systemHealth?.storage.lastRetentionRun ? timeAgo(systemHealth.storage.lastRetentionRun.at) : "Mai",
                    detail: `${systemHealth?.storage.lastRetentionRun?.deletedStoredFileObjects ?? 0} file purgati · grace ${systemHealth?.storage.retentionGraceDays ?? 0}g`,
                    icon: Clock3
                  }
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="rounded-2xl border border-border/70 bg-muted/30 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{item.label}</p>
                          <p className="mt-2 text-2xl font-semibold text-foreground">{item.value}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                        </div>
                        <Icon className="h-5 w-5 text-muted-foreground" />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-2xl border border-border/70 bg-card">
                <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Backup & restore drill</p>
                    <p className="text-xs text-muted-foreground">
                      Ultimo ripristino isolato di database e uploads. Nessun file viene pubblicato durante il test.
                    </p>
                  </div>
                  <Badge variant={operationalStatusVariant(systemHealth?.restoreDrill.status)}>
                    {systemHealth?.restoreDrill.status ?? "n/a"}
                  </Badge>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    {
                      label: "Ultimo drill",
                      value: systemHealth?.restoreDrill.generatedAt ? timeAgo(systemHealth.restoreDrill.generatedAt) : "Mai",
                      detail: `stale dopo ${systemHealth?.restoreDrill.staleAfterDays ?? 35}g`
                    },
                    {
                      label: "RPO osservato",
                      value: formatDuration(systemHealth?.restoreDrill.rpoSeconds),
                      detail: systemHealth?.restoreDrill.source ? `fonte ${systemHealth.restoreDrill.source}` : "fonte non disponibile"
                    },
                    {
                      label: "RTO tecnico",
                      value: formatDuration(systemHealth?.restoreDrill.rtoSeconds),
                      detail: `${systemHealth?.restoreDrill.publicTablesRestored ?? 0} tabelle restore`
                    },
                    {
                      label: "Upload verificato",
                      value: systemHealth?.restoreDrill.uploads.status ?? "n/a",
                      detail: systemHealth?.restoreDrill.uploads.recoveredFileSizeBytes
                        ? `${formatBytes(systemHealth.restoreDrill.uploads.recoveredFileSizeBytes)} · sha ${systemHealth.restoreDrill.uploads.recoveredFileSha256Prefix ?? "n/d"}`
                        : "nessun file esposto"
                    }
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-border/70 bg-muted/30 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{item.label}</p>
                      <p className="mt-2 text-lg font-semibold text-foreground">{item.value}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                    </div>
                  ))}
                </div>
                <div className="grid gap-4 border-t border-border/70 p-4 lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <p><span className="font-semibold text-foreground">DB:</span> {systemHealth?.restoreDrill.postgresBackupFile ?? "n/d"}</p>
                    <p><span className="font-semibold text-foreground">Uploads:</span> {systemHealth?.restoreDrill.uploadsBackupFile ?? "n/d"}</p>
                    <p><span className="font-semibold text-foreground">Migrazioni:</span> {systemHealth?.restoreDrill.migrationsRestored ?? 0}</p>
                    <p><span className="font-semibold text-foreground">Mismatch:</span> {systemHealth?.restoreDrill.tableMismatches ?? 0}</p>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border/70">
                    <div className="grid grid-cols-[1fr_0.8fr_0.8fr_0.8fr] gap-2 border-b border-border/70 bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      <span>Tabella</span>
                      <span>Sorgente</span>
                      <span>Restore</span>
                      <span>Esito</span>
                    </div>
                    <div className="divide-y divide-border/70">
                      {(systemHealth?.restoreDrill.tableCounts ?? []).length > 0 ? (
                        systemHealth!.restoreDrill.tableCounts.map((row) => (
                          <div key={row.table} className="grid grid-cols-[1fr_0.8fr_0.8fr_0.8fr] gap-2 px-3 py-2 text-xs">
                            <span className="font-medium text-foreground">{row.table}</span>
                            <span className="text-muted-foreground">{row.sourceCount >= 0 ? row.sourceCount : "n/d"}</span>
                            <span className="text-muted-foreground">{row.restoredCount}</span>
                            <Badge variant={operationalStatusVariant(row.status)}>{row.status}</Badge>
                          </div>
                        ))
                      ) : (
                        <div className="px-3 py-5 text-sm text-muted-foreground">Nessun conteggio restore disponibile.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-border/70">
                  <div className="border-b border-border/70 px-4 py-3">
                    <p className="text-sm font-semibold text-foreground">Top tipologie file</p>
                    <p className="text-xs text-muted-foreground">Aggregato da StoredFileObject, senza nomi file o URL.</p>
                  </div>
                  <div className="divide-y divide-border/70">
                    {(systemHealth?.storage.resourceTypes ?? []).length > 0 ? (
                      systemHealth!.storage.resourceTypes.map((item) => (
                        <div key={item.resourceType} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                          <div>
                            <p className="font-medium text-foreground">{item.resourceType}</p>
                            <p className="text-xs text-muted-foreground">{item.files} file</p>
                          </div>
                          <span className="font-semibold text-foreground">{formatBytes(item.bytes)}</span>
                        </div>
                      ))
                    ) : (
                      <div className="px-4 py-6 text-sm text-muted-foreground">Nessun file tracciato al momento.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70">
                  <div className="border-b border-border/70 px-4 py-3">
                    <p className="text-sm font-semibold text-foreground">Eventi storage recenti</p>
                    <p className="text-xs text-muted-foreground">Upload, download e retention senza dati sensibili.</p>
                  </div>
                  <div className="divide-y divide-border/70">
                    {(systemHealth?.storage.recentEvents ?? []).length > 0 ? (
                      systemHealth!.storage.recentEvents.map((event) => (
                        <div key={event.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                          <div>
                            <p className="font-medium text-foreground">{event.action}</p>
                            <p className="text-xs text-muted-foreground">{event.resource} · {timeAgo(event.createdAt)}</p>
                          </div>
                          <Badge variant="secondary">{event.tenantId.slice(0, 8)}</Badge>
                        </div>
                      ))
                    ) : (
                      <div className="px-4 py-6 text-sm text-muted-foreground">Nessun evento storage recente.</div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeSection === "security" ? (
        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="platform-main-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Security controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-border/70 bg-card/70 p-3">
                <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">OTP admin</p>
                <p className="mt-1 font-semibold text-foreground">{securityOverview?.auth.otpEmail ?? "n/a"}</p>
                <p className="text-xs text-muted-foreground">TTL token: {securityOverview?.auth.tokenTtl ?? "-"}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-card/70 p-3">
                <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">IP allowlist</p>
                <Badge className="mt-1" variant={securityOverview?.controls.ipAllowlist === "CONFIGURED" ? "success" : "warning"}>
                  {securityOverview?.controls.ipAllowlist ?? "n/a"}
                </Badge>
              </div>
              <div className="rounded-xl border border-border/70 bg-card/70 p-3">
                <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Login bloccati</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{securityOverview?.auth.blockedLoginStates ?? 0}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="platform-main-card">
            <CardHeader>
              <CardTitle className="text-base text-foreground">Dispositivi fidati</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {trustedDevices.length === 0 ? (
                <div className="grid place-items-center gap-2 rounded-2xl border border-dashed border-border/80 bg-card/50 py-10 text-center">
                  <KeyRound className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Nessun dispositivo fidato registrato.</p>
                </div>
              ) : null}
              {trustedDevices.map((device) => (
                <div key={device.id} className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{device.label ?? "Dispositivo autorizzato"}</p>
                      <Badge variant={device.status === "ACTIVE" ? "success" : device.status === "REVOKED" ? "destructive" : "warning"}>{device.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Ultimo uso: {device.lastUsedAt ? timeAgo(device.lastUsedAt) : "mai"} · Scade: {formatDate(device.expiresAt)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={device.status !== "ACTIVE"}
                    onClick={() => revokeTrustedDevice(device)}
                  >
                    Revoca
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="platform-main-card xl:col-span-2">
            <CardHeader>
              <CardTitle className="text-base text-foreground">Eventi sicurezza recenti</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(securityOverview?.recentEvents.length ?? 0) === 0 ? (
                <div className="grid place-items-center gap-2 rounded-2xl border border-dashed border-border/80 bg-card/50 py-10 text-center">
                  <KeyRound className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Nessun evento sicurezza recente.</p>
                </div>
              ) : null}
              {securityOverview?.recentEvents.map((event) => (
                <div key={`security-${event.id}`} className="rounded-xl border border-border/70 bg-card/70 px-3 py-2">
                  <p className="text-sm font-semibold text-foreground">{event.action}</p>
                  <p className="text-xs text-muted-foreground">{event.tenantName} · {timeAgo(event.createdAt)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeSection === "audit" ? (
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

      {activeSection === "settings" ? (
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
                  <Button variant="secondary" size="sm" onClick={() => setActiveSection("tenants")}>
                    Vai a Clienti
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setActiveSection("plans")}>
                    Vai a Ricavi
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setActiveSection("audit")}>
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

      <div
        className={`fixed inset-0 z-[112] bg-slate-950/45 backdrop-blur-sm transition-opacity ${
          selectedTenant ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setSelectedTenant(null)}
      >
        <aside
          className={`ml-auto flex h-full w-full max-w-xl flex-col border-l border-border bg-card shadow-2xl transition-transform duration-300 ${
            selectedTenant ? "translate-x-0" : "translate-x-full"
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Dettaglio tenant platform"
          onClick={(event) => event.stopPropagation()}
        >
          {selectedTenant ? (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-border p-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tenant drawer</p>
                  <h2 className="mt-1 text-xl font-semibold text-foreground">{selectedTenant.company?.legalName || selectedTenant.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{selectedTenant.owner?.email ?? "Owner non configurato"}</p>
                </div>
                <Button variant="outline" size="icon" onClick={() => setSelectedTenant(null)} aria-label="Chiudi drawer tenant">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                    <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Piano</p>
                    <p className="mt-1 font-semibold text-foreground">{normalizePlanTier(selectedTenant.license?.plan)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatCurrency(selectedTenant.license?.priceMonthly ?? PLAN_MONTHLY_PRICING_EUR[normalizePlanTier(selectedTenant.license?.plan)])}/mese
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                    <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Licenza</p>
                    <Badge className="mt-1" variant={statusBadgeVariant(selectedTenant.license?.status)}>{licenseStatusLabel(selectedTenant.license?.status)}</Badge>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                    <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Scadenza</p>
                    <p className="mt-1 font-semibold text-foreground">{formatDate(selectedTenant.license?.expiresAt)}</p>
                  </div>
                </div>

                <Card className="platform-main-card">
                  <CardHeader>
                    <CardTitle className="text-base">Piano SaaS</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Cambia piano manualmente dalla Platform Console. Se il cliente è `PENDING`, `PAST_DUE` o scaduto puoi usare
                      <span className="font-semibold text-foreground"> Salva + attiva</span> per abilitare subito la licenza.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {PLAN_TIERS.map((plan) => {
                        const isCurrent = normalizePlanTier(selectedTenant.license?.plan) === plan;
                        return (
                          <button
                            key={`drawer-plan-${selectedTenant.id}-${plan}`}
                            type="button"
                            disabled={!!rowLoading[selectedTenant.id]}
                            onClick={() => requestDirectPlanUpdate(selectedTenant, plan, selectedTenant.license?.status !== "ACTIVE")}
                            className={`rounded-2xl border p-3 text-left transition ${
                              isCurrent
                                ? "border-indigo-400 bg-indigo-50 text-indigo-950 dark:border-indigo-400/60 dark:bg-indigo-500/15 dark:text-indigo-100"
                                : "border-border/70 bg-background/70 hover:border-indigo-300 hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10"
                            }`}
                          >
                            <span className="flex items-center justify-between gap-2">
                              <strong className="text-sm">{plan}</strong>
                              {isCurrent ? <Badge variant="secondary">attuale</Badge> : null}
                            </span>
                            <span className="mt-2 block text-xs text-muted-foreground">{formatCurrency(PLAN_MONTHLY_PRICING_EUR[plan])}/mese standard</span>
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                <Card className="platform-main-card">
                  <CardHeader>
                    <CardTitle className="text-base">Profilo azienda</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Ragione sociale</span>
                      <span className="text-right font-medium text-foreground">{selectedTenant.company?.legalName ?? selectedTenant.name}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">P.IVA</span>
                      <span className="text-right font-medium text-foreground">{selectedTenant.company?.vatNumber ?? "-"}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Profilo</span>
                      <Badge variant={selectedTenant.company?.profileCompleted ? "success" : "warning"}>
                        {selectedTenant.company?.profileCompleted ? "Completo" : "Incompleto"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card className="platform-main-card">
                  <CardHeader>
                    <CardTitle className="text-base">Azioni rapide sicure</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 sm:grid-cols-2">
                    <Button variant="outline" onClick={() => openConfirm(selectedTenant, "TRIAL_14_DAYS")}>Trial 14 giorni</Button>
                    <Button variant="outline" onClick={() => openConfirm(selectedTenant, "RENEW_30_DAYS")}>Rinnova +30 giorni</Button>
                    <Button variant="secondary" onClick={() => generateInvoice(selectedTenant)}>Genera fattura</Button>
                    <Button variant="destructive" onClick={() => openConfirm(selectedTenant, "SUSPEND_LICENSE")}>Sospendi licenza</Button>
                  </CardContent>
                </Card>

                <Card className="platform-main-card">
                  <CardHeader>
                    <CardTitle className="text-base">Fatture recenti</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {invoices.filter((invoice) => invoice.tenantId === selectedTenant.id).slice(0, 5).length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nessuna fattura generata per questo tenant.</p>
                    ) : null}
                    {invoices.filter((invoice) => invoice.tenantId === selectedTenant.id).slice(0, 5).map((invoice) => (
                      <div key={`drawer-invoice-${invoice.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{invoice.invoiceNumber}</p>
                          <p className="text-xs text-muted-foreground">{formatCurrency(invoice.total)}</p>
                        </div>
                        <Badge variant={invoiceStatusVariant(invoice.status)}>{invoiceStatusLabel(invoice.status)}</Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </>
          ) : null}
        </aside>
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
