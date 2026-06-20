import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BellRing,
  Building2,
  CalendarDays,
  CarFront,
  ChevronDown,
  ChartColumnIncreasing,
  ClipboardList,
  Gauge,
  KanbanSquare,
  LogOut,
  Lock,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sun,
  TimerReset,
  Trash2,
  TriangleAlert,
  AlertTriangle,
  UserPlus,
  Users,
  Wrench,
  X
} from "lucide-react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEntitlementsStore } from "../../../application/stores/entitlements-store";
import { authUseCases } from "../../../application/usecases/auth-usecases";
import { notificationsUseCases } from "../../../application/usecases/notifications-usecases";
import { useAuthStore } from "../../../application/stores/auth-store";
import {
  FeatureKey,
  PLAN_MONTHLY_PRICING_EUR,
  ensureKnownPlan,
  getFeatureListForPlan
} from "../../../domain/constants/entitlements";
import { ThemeMode, getStoredTheme, setTheme } from "../../../infrastructure/theme/theme-manager";
import { getApiBaseUrl } from "../../../infrastructure/api/api-base-url";
import { cn } from "../../../lib/utils";
import { useEntitlements } from "../../hooks/use-entitlements";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { GBackground } from "./g-background";
import { FleetumLanguageSwitcher } from "../i18n/fleetum-language-switcher";

type NavItem = {
  key: string;
  label: string;
  to?: string;
  icon: any;
  feature?: FeatureKey;
  match?: (pathname: string) => boolean;
  children?: NavItem[];
};

const navSections: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Panoramica",
    items: [
      { key: "dashboard", to: "/dashboard", label: "Dashboard", icon: Gauge, match: (path) => path === "/dashboard" },
      {
        key: "booking",
        to: "/booking",
        label: "Booking Noleggi",
        icon: CalendarDays,
        match: (path) => path === "/booking"
      },
      {
        key: "booking-contratti",
        to: "/booking/contratti",
        label: "Contratti Noleggio",
        icon: ClipboardList,
        match: (path) => path.startsWith("/booking/contratti")
      },
      {
        key: "booking-listini",
        to: "/booking/listini",
        label: "Listini Noleggi",
        icon: ChartColumnIncreasing,
        match: (path) => path.startsWith("/booking/listini")
      },
      {
        key: "fermi-calendario",
        to: "/fermi/calendario",
        label: "Calendario Fermi",
        icon: CalendarDays,
        match: (path) => path.startsWith("/fermi/calendario")
      },
      {
        key: "fermi-tecnici",
        label: "Fermi Tecnici",
        icon: ClipboardList,
        children: [
          {
            key: "fermi-lista",
            to: "/fermi",
            label: "Fermi",
            icon: ClipboardList,
            match: (path) =>
              path.startsWith("/fermi") &&
              !path.startsWith("/fermi/kanban") &&
              !path.startsWith("/fermi/calendario")
          },
          {
            key: "scadenziario",
            to: "/anagrafiche/scadenziario",
            label: "Scadenziario",
            icon: BellRing,
            match: (path) => path.startsWith("/anagrafiche/scadenziario")
          },
          {
            key: "manutenzioni",
            to: "/anagrafiche/manutenzioni",
            label: "Manutenzioni",
            icon: TimerReset,
            match: (path) => path.startsWith("/anagrafiche/manutenzioni")
          },
          {
            key: "fermi-kanban",
            to: "/fermi/kanban",
            label: "Kanban Fermi",
            icon: KanbanSquare,
            match: (path) => path.startsWith("/fermi/kanban")
          }
        ]
      },
      {
        key: "statistiche",
        to: "/statistiche",
        label: "Statistiche",
        icon: ChartColumnIncreasing,
        feature: "reports_advanced",
        match: (path) => path.startsWith("/statistiche")
      }
    ]
  },
  {
    title: "Anagrafiche",
    items: [
      { key: "sedi", to: "/anagrafiche/sedi", label: "Sedi", icon: Building2, match: (path) => path.startsWith("/anagrafiche/sedi") },
      { key: "officine", to: "/anagrafiche/officine", label: "Officine", icon: Wrench, match: (path) => path.startsWith("/anagrafiche/officine") },
      { key: "veicoli", to: "/anagrafiche/veicoli", label: "Veicoli", icon: CarFront, match: (path) => path.startsWith("/anagrafiche/veicoli") },
      {
        key: "clienti",
        to: "/anagrafiche/clienti",
        label: "Clienti",
        icon: Users,
        match: (path) => path.startsWith("/anagrafiche/clienti")
      }
    ]
  }];

const mobileNavItems: Array<{ to: string; label: string; icon: any; feature?: FeatureKey }> = [
  { to: "/dashboard", label: "Dashboard", icon: Gauge },
  { to: "/booking", label: "Booking", icon: CalendarDays },
  { to: "/booking/contratti", label: "Contratti", icon: ClipboardList },
  { to: "/booking/listini", label: "Listini", icon: ChartColumnIncreasing },
  { to: "/fermi/calendario", label: "Calendario", icon: CalendarDays },
  { to: "/fermi", label: "Fermi", icon: ClipboardList },
  { to: "/anagrafiche/scadenziario", label: "Scadenze", icon: BellRing },
  { to: "/anagrafiche/clienti", label: "Clienti", icon: Users },
  { to: "/fermi/kanban", label: "Kanban", icon: KanbanSquare },
  { to: "/statistiche", label: "Statistiche", icon: ChartColumnIncreasing, feature: "reports_advanced" }
];

export const AppLayout = () => {
  const sidebarStorageKey = "fermi_sidebar_hidden";
  const privacyNoticeVersion = "2026-05-05";
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, user, setUser, logout } = useAuthStore();
  const canManageBilling = user?.permissions.includes("billing:manage") ?? false;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<string[]>([]);
  const [backendReachable, setBackendReachable] = useState(true);
  const [healthFailures, setHealthFailures] = useState(0);
  const [licenseInfo, setLicenseInfo] = useState<null | { plan: string; expiringSoon: boolean; daysRemaining: number | null; expiresAt: string | null }>(null);
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(sidebarStorageKey) === "1";
  });
  const [theme, setThemeState] = useState<ThemeMode>(() => getStoredTheme());
  const { can, plan, requiredPlan, loading: entitlementsLoading, error: entitlementsError } = useEntitlements();
  const setEntitlements = useEntitlementsStore((state) => state.setEntitlements);
  const notificationsMenuRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const dismissedStorageKey = useMemo(
    () => (user ? `fermi_dismissed_notifications:${user.tenantId}:${user.id}` : null),
    [user]
  );
  const privacyAcceptanceKey = useMemo(
    () => (user ? `fermi_privacy_notice:${privacyNoticeVersion}:${user.tenantId}:${user.id}` : null),
    [user]
  );
  const [privacyNoticeVisible, setPrivacyNoticeVisible] = useState(false);
  const [privacyNoticeTitle, setPrivacyNoticeTitle] = useState("Informativa privacy aggiornata");
  const [privacyNoticeSummary, setPrivacyNoticeSummary] = useState(
    "Abbiamo reso disponibile l'informativa privacy del gestionale."
  );
  const isNavItemActive = useCallback((item: NavItem, pathname: string): boolean => {
    if (item.children?.length) return item.children.some((child) => isNavItemActive(child, pathname));
    return item.match ? item.match(pathname) : false;
  }, []);
  const getAutoOpenGroups = useCallback(
    (pathname: string): Record<string, boolean> => {
      const groups: Record<string, boolean> = {};
      for (const section of navSections) {
        for (const item of section.items) {
          if (item.children?.length && item.children.some((child) => isNavItemActive(child, pathname))) {
            groups[item.key] = true;
          }
        }
      }
      return groups;
    },
    [isNavItemActive]
  );
  const [openNavGroups, setOpenNavGroups] = useState<Record<string, boolean>>(() => getAutoOpenGroups(location.pathname));

  const scrollToTop = useCallback(() => {
    if (typeof window === "undefined") return;
    const scrollingElement = document.scrollingElement as HTMLElement | null;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    if (scrollingElement) scrollingElement.scrollTop = 0;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    scrollToTop();
    const raf = window.requestAnimationFrame(scrollToTop);
    setNotificationsOpen(false);
    setProfileOpen(false);
    setMobileOpen(false);
    return () => window.cancelAnimationFrame(raf);
  }, [location.pathname, location.key, scrollToTop]);

  useEffect(() => {
    const autoOpen = getAutoOpenGroups(location.pathname);
    if (!Object.keys(autoOpen).length) return;
    setOpenNavGroups((old) => {
      let changed = false;
      const next = { ...old };
      for (const [key, value] of Object.entries(autoOpen)) {
        if (value && !next[key]) {
          next[key] = true;
          changed = true;
        }
      }
      return changed ? next : old;
    });
  }, [getAutoOpenGroups, location.pathname]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let mounted = true;
    const loadLicense = async () => {
      try {
        const info = await authUseCases.licenseStatus();
        if (!mounted) return;
        setLicenseInfo({
          plan: info.plan,
          expiringSoon: info.expiringSoon,
          daysRemaining: info.daysRemaining,
          expiresAt: info.expiresAt
        });
      } catch {
        if (mounted) setLicenseInfo(null);
      }
    };
    loadLicense();
    const interval = setInterval(loadLicense, 15 * 60 * 1000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!licenseInfo?.plan) return;
    const normalizedLicensePlan = ensureKnownPlan(licenseInfo.plan);
    const normalizedEntitlementsPlan = ensureKnownPlan(plan);
    if (normalizedLicensePlan === normalizedEntitlementsPlan) return;

    setEntitlements({
      plan: normalizedLicensePlan,
      priceMonthly: PLAN_MONTHLY_PRICING_EUR[normalizedLicensePlan],
      features: getFeatureListForPlan(normalizedLicensePlan)
    });
  }, [licenseInfo?.plan, plan, setEntitlements]);

  useEffect(() => {
    if (!dismissedStorageKey) {
      setDismissedNotificationIds([]);
      return;
    }
    try {
      const raw = localStorage.getItem(dismissedStorageKey);
      if (!raw) {
        setDismissedNotificationIds([]);
        return;
      }
      const parsed = JSON.parse(raw);
      setDismissedNotificationIds(Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : []);
    } catch {
      setDismissedNotificationIds([]);
    }
  }, [dismissedStorageKey]);

  useEffect(() => {
    if (!dismissedStorageKey) return;
    localStorage.setItem(dismissedStorageKey, JSON.stringify(dismissedNotificationIds));
  }, [dismissedNotificationIds, dismissedStorageKey]);

  useEffect(() => {
    if (!privacyAcceptanceKey) {
      setPrivacyNoticeVisible(false);
      return;
    }

    let mounted = true;
    const loadPrivacyStatus = async () => {
      try {
        const result = await authUseCases.privacyCurrent();
        if (!mounted) return;
        setPrivacyNoticeTitle(result.notice.title);
        setPrivacyNoticeSummary(result.notice.summary ?? "Informativa privacy disponibile.");
        setPrivacyNoticeVisible(!result.accepted);
        if (result.accepted) {
          try {
            localStorage.setItem(privacyAcceptanceKey, "1");
          } catch {
            // ignore storage errors
          }
        }
      } catch {
        if (!mounted) return;
        try {
          setPrivacyNoticeVisible(localStorage.getItem(privacyAcceptanceKey) !== "1");
        } catch {
          setPrivacyNoticeVisible(true);
        }
      }
    };

    void loadPrivacyStatus();

    return () => {
      mounted = false;
    };
  }, [privacyAcceptanceKey]);

  useEffect(() => {
    if (!privacyAcceptanceKey) return;

    try {
      if (localStorage.getItem(privacyAcceptanceKey) === "1") setPrivacyNoticeVisible(false);
    } catch {
      // ignore storage errors
    }
  }, [privacyAcceptanceKey]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let mounted = true;
    const load = async () => {
      try {
        const result = await notificationsUseCases.inbox();
        if (mounted) setNotifications(result.data ?? []);
      } catch {
        if (mounted) setNotifications([]);
      }
    };

    void load();
    const interval = setInterval(() => {
      void load();
    }, 30000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    let mounted = true;
    const base = getApiBaseUrl();
    const check = async () => {
      try {
        const res = await fetch(`${base}/health`);
        if (!mounted) return;
        if (res.ok) {
          setHealthFailures(0);
          setBackendReachable(true);
        } else {
          setHealthFailures((prev) => {
            const next = prev + 1;
            if (next >= 3) setBackendReachable(false);
            return next;
          });
        }
      } catch {
        if (!mounted) return;
        setHealthFailures((prev) => {
          const next = prev + 1;
          if (next >= 3) setBackendReachable(false);
          return next;
        });
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (notificationsMenuRef.current && !notificationsMenuRef.current.contains(target)) {
        setNotificationsOpen(false);
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(target)) {
        setProfileOpen(false);
      }
    };

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
        setProfileOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  const visibleNavSections = useMemo(() => navSections, []);

  const visibleMobileNavItems = useMemo(() => mobileNavItems, []);

  const activeLabel = useMemo(() => {
    const findActiveLabel = (items: NavItem[]): string | null => {
      for (const item of items) {
        if (item.children?.length) {
          const childMatch = findActiveLabel(item.children);
          if (childMatch) return childMatch;
          if (item.match?.(location.pathname)) return item.label;
          continue;
        }
        if (item.match?.(location.pathname)) return item.label;
      }
      return null;
    };
    if (location.pathname.startsWith("/upgrade")) return "Upgrade piano";
    for (const section of visibleNavSections) {
      const match = findActiveLabel(section.items);
      if (match) return match;
    }
    return "Fleetum";
  }, [location.pathname, visibleNavSections]);

  const flattenedMobileSidebarItems = useMemo(
    () =>
      visibleNavSections
        .flatMap((section) => section.items)
        .flatMap((item) => (item.children?.length ? item.children : [item]))
        .filter((item): item is NavItem => Boolean(item.to)),
    [visibleNavSections]
  );

  const isCalendarRoute = location.pathname.startsWith("/fermi/calendario");
  const isWideWorkspaceRoute = isCalendarRoute || location.pathname === "/booking";

  const visibleNotifications = useMemo(
    () => notifications.filter((item) => !dismissedNotificationIds.includes(item.id)),
    [dismissedNotificationIds, notifications]
  );

  const notificationSummary = useMemo(() => {
    const counts = visibleNotifications.reduce(
      (acc, item) => {
        if (item.type === "STOPPAGE_OVERDUE") acc.overdue += 1;
        if (item.type === "REMINDER_FAILED") acc.failed += 1;
        if (item.type === "USER_INVITED_PENDING") acc.invited += 1;
        if (item.type === "VEHICLE_DEADLINE") acc.deadlines += 1;
        return acc;
      },
      { overdue: 0, failed: 0, invited: 0, deadlines: 0 }
    );
    return counts;
  }, [visibleNotifications]);

  const displayedPlan = useMemo(() => ensureKnownPlan(licenseInfo?.plan ?? plan), [licenseInfo?.plan, plan]);

  const formatRelativeTime = (value?: string) => {
    if (!value) return "Ora";
    const at = new Date(value).getTime();
    if (Number.isNaN(at)) return "Ora";
    const diffMin = Math.floor((Date.now() - at) / 60000);
    if (diffMin < 1) return "Ora";
    if (diffMin < 60) return `${diffMin} min fa`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} h fa`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} g fa`;
  };

  const notificationMeta = (item: any) => {
    if (item.type === "STOPPAGE_OVERDUE") return { icon: TimerReset, tone: "text-amber-600 dark:text-amber-300", to: "/fermi" };
    if (item.type === "REMINDER_FAILED") return { icon: TriangleAlert, tone: "text-red-600 dark:text-red-300", to: "/fermi" };
    if (item.type === "VEHICLE_DEADLINE") return { icon: AlertTriangle, tone: "text-orange-600 dark:text-orange-300", to: "/anagrafiche/scadenziario" };
    return { icon: UserPlus, tone: "text-blue-600 dark:text-blue-300", to: "/utenti" };
  };

  const onLogout = async () => {
    try {
      await authUseCases.logout();
    } catch {
      // Ignore network/API errors and force local logout anyway.
    } finally {
      logout();
      navigate("/login");
    }
  };

  const toggleTheme = () => {
    const nextTheme: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    setThemeState(nextTheme);
  };

  const toggleSidebar = () => {
    setSidebarHidden((prev) => {
      const next = !prev;
      localStorage.setItem(sidebarStorageKey, next ? "1" : "0");
      return next;
    });
  };

  const dismissNotification = (notificationId: string) => {
    setDismissedNotificationIds((old) => (old.includes(notificationId) ? old : [...old, notificationId]));
  };

  const dismissAllVisibleNotifications = () => {
    if (visibleNotifications.length === 0) return;
    const visibleIds = visibleNotifications.map((item) => item.id).filter((id): id is string => typeof id === "string");
    setDismissedNotificationIds((old) => Array.from(new Set([...old, ...visibleIds])));
  };

  const restoreNotifications = () => {
    setDismissedNotificationIds([]);
  };

  const acceptPrivacyNotice = async () => {
    if (!privacyAcceptanceKey) return;
    try {
      await authUseCases.acceptPrivacy("banner");
    } catch {
      // Manteniamo un fallback locale per non bloccare l'utente in caso di rete instabile.
    }
    try {
      localStorage.setItem(privacyAcceptanceKey, "1");
      localStorage.setItem(
        `${privacyAcceptanceKey}:acceptedAt`,
        JSON.stringify({ version: privacyNoticeVersion, acceptedAt: new Date().toISOString() })
      );
    } catch {
      // Se localStorage non e disponibile, non blocchiamo la sessione corrente.
    }
    setPrivacyNoticeVisible(false);
  };

  return (
    <div className="post-login-shell relative min-h-screen overflow-hidden g-scroll">
      <GBackground />
      <div className="post-login-shell__content relative z-10">
      <div className="saas-topbar post-login-topbar fixed inset-x-0 top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div
          className={cn(
            "mx-auto flex h-16 w-full max-w-[1460px] min-w-0 items-center justify-between gap-3 px-4 sm:px-6",
            sidebarHidden ? "lg:pl-6" : "lg:pl-[304px]"
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="outline" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Pannello operativo</p>
              <p className="truncate text-sm font-semibold text-foreground">{activeLabel}</p>
            </div>
          </div>

          <div className="topbar-controls-zone flex h-full shrink-0 items-center self-stretch gap-2.5 sm:gap-3">
            <Button variant="outline" size="icon" className="hidden lg:inline-flex" onClick={toggleSidebar}>
              {sidebarHidden ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>

            <div ref={notificationsMenuRef} className="relative">
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10"
                aria-label="Apri notifiche"
                onClick={() => {
                  setNotificationsOpen((v) => !v);
                  setProfileOpen(false);
                }}
              >
                <BellRing className="h-4 w-4" />
              </Button>
              {visibleNotifications.length > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white shadow-[0_8px_18px_-10px_rgba(220,38,38,0.9)]">
                  {visibleNotifications.length > 9 ? "9+" : visibleNotifications.length}
                </span>
              ) : null}

              {notificationsOpen ? (
                <div className="saas-floating-panel absolute right-0 top-[calc(100%+0.55rem)] z-[90] w-[min(360px,calc(100vw-1rem))] rounded-xl p-3">
                  <div className="saas-surface rounded-lg p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Riepilogo notifiche</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <div className="rounded-lg border border-border/80 bg-background/85 p-2 shadow-[0_8px_18px_-16px_rgba(15,23,42,0.5)]">
                        <p className="text-muted-foreground">Fermi critici</p>
                        <p className="mt-1 text-base font-semibold">{notificationSummary.overdue}</p>
                      </div>
                      <div className="rounded-lg border border-border/80 bg-background/85 p-2 shadow-[0_8px_18px_-16px_rgba(15,23,42,0.5)]">
                        <p className="text-muted-foreground">Reminder KO</p>
                        <p className="mt-1 text-base font-semibold">{notificationSummary.failed}</p>
                      </div>
                      <div className="rounded-lg border border-border/80 bg-background/85 p-2 shadow-[0_8px_18px_-16px_rgba(15,23,42,0.5)]">
                        <p className="text-muted-foreground">Inviti aperti</p>
                        <p className="mt-1 text-base font-semibold">{notificationSummary.invited}</p>
                      </div>
                      <div className="rounded-lg border border-border/80 bg-background/85 p-2 shadow-[0_8px_18px_-16px_rgba(15,23,42,0.5)]">
                        <p className="text-muted-foreground">Scadenze veicoli</p>
                        <p className="mt-1 text-base font-semibold">{notificationSummary.deadlines}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 max-h-[360px] space-y-2 overflow-auto pr-1">
                    {visibleNotifications.length === 0 ? (
                      <p className="rounded border border-dashed p-3 text-sm text-muted-foreground">Nessuna notifica.</p>
                    ) : (
                      visibleNotifications.slice(0, 12).map((item) => {
                        const meta = notificationMeta(item);
                        const Icon = meta.icon;
                        return (
                          <div key={item.id} className="rounded-lg border border-border/80 bg-background/85 p-2.5 shadow-[0_10px_20px_-18px_rgba(15,23,42,0.5)]">
                            <div className="flex items-start gap-2">
                              <Icon className={`mt-0.5 h-4 w-4 ${meta.tone}`} />
                              <button
                                type="button"
                                onClick={() => {
                                  setNotificationsOpen(false);
                                  navigate(meta.to);
                                }}
                                className="min-w-0 flex-1 text-left"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <p className="truncate text-sm font-semibold">{item.title}</p>
                                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelativeTime(item.createdAt)}</span>
                                </div>
                                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
                              </button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label="Rimuovi notifica"
                                onClick={() => dismissNotification(item.id)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="mt-2 flex items-center justify-between border-t pt-2">
                    <p className="text-xs text-muted-foreground">
                      {dismissedNotificationIds.length > 0
                        ? `${dismissedNotificationIds.length} notifica${dismissedNotificationIds.length > 1 ? "he" : ""} rimoss${dismissedNotificationIds.length > 1 ? "e" : "a"}`
                        : "Aggiornamento live attivo"}
                    </p>
                    <div className="flex items-center gap-1">
                      {dismissedNotificationIds.length > 0 ? (
                        <Button size="sm" variant="ghost" onClick={restoreNotifications}>
                          Ripristina
                        </Button>
                      ) : null}
                      {visibleNotifications.length > 0 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={dismissAllVisibleNotifications}
                          className="gap-1 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Elimina tutte
                        </Button>
                      ) : null}
                      {visibleNotifications.length > 0 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setNotificationsOpen(false);
                            navigate("/fermi");
                          }}
                        >
                          Apri centro operativo
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <Button variant="outline" size="icon" className="h-10 w-10" onClick={toggleTheme} aria-label="Cambia tema">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <FleetumLanguageSwitcher className="premium-language-switcher--topbar" />

            <div ref={profileMenuRef} className="relative">
              <Button
                variant="outline"
                className="h-10 rounded-full px-3.5 shadow-[0_12px_28px_-20px_rgba(99,102,241,0.38)]"
                aria-label="Apri menu profilo"
                onClick={() => {
                  setProfileOpen((v) => !v);
                  setNotificationsOpen(false);
                }}
              >
                <span className="mr-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {displayedPlan}
                </span>
                <span className="grid h-7 w-7 place-items-center rounded-full border bg-card text-sm font-medium">
                  {(user?.firstName?.[0] ?? "U").toUpperCase()}
                </span>
              </Button>

              {profileOpen ? (
                <div className="saas-floating-panel absolute right-0 top-[calc(100%+0.55rem)] z-[90] w-72 rounded-xl p-3">
                  <div className="saas-surface rounded-lg p-3">
                    <p className="text-sm font-semibold text-foreground">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                    <Badge variant="secondary" className="mt-2 uppercase tracking-[0.08em]">
                      Piano: {displayedPlan}
                    </Badge>
                  </div>
                  <div className="mt-2 grid gap-1">
                    {canManageBilling ? (
                      <Button
                        variant="ghost"
                        className="justify-start"
                        onClick={() => {
                          setProfileOpen(false);
                          navigate("/upgrade");
                        }}
                      >
                        Upgrade piano
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      className="justify-start"
                      onClick={() => {
                        setProfileOpen(false);
                        navigate("/utenti");
                      }}
                    >
                      Utenti e Ruoli
                    </Button>
                    <Button
                      variant="ghost"
                      className="justify-start"
                      onClick={() => {
                        setProfileOpen(false);
                        navigate("/profilo/azienda");
                      }}
                    >
                      <Building2 className="h-4 w-4" />
                      Profilo Azienda
                    </Button>
                    <Button
                      variant="ghost"
                      className="justify-start"
                      onClick={() => {
                        setProfileOpen(false);
                        navigate("/privacy");
                      }}
                    >
                      Privacy e trattamento dati
                    </Button>
                    <Button
                      variant="ghost"
                      className="justify-start"
                      onClick={() => {
                        setProfileOpen(false);
                        navigate("/profilo");
                      }}
                    >
                      Profilo e impostazioni
                    </Button>
                    <Button
                      variant="ghost"
                      className="justify-start text-destructive hover:text-destructive"
                      onClick={() => {
                        setProfileOpen(false);
                        onLogout();
                      }}
                    >
                      <LogOut className="h-4 w-4" />
                      Esci
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <aside
        className={cn(
          "saas-sidebar fixed bottom-0 left-0 top-0 z-[45] hidden w-72 flex-col px-5 pb-6 pt-3 text-slate-800 transition-transform duration-300 dark:text-slate-200 lg:flex",
          sidebarHidden ? "-translate-x-full lg:pointer-events-none" : "translate-x-0"
        )}
      >
        <div className="saas-surface g-card g-card-anim rounded-xl p-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Fleetum</p>
            <img src="/brand/fleetum-logo-full-light.svg" alt="Fleetum" className="mt-1 h-8 w-auto max-w-[176px] object-contain dark:hidden" />
            <img src="/brand/fleetum-logo-full-dark.svg" alt="Fleetum" className="mt-1 hidden h-8 w-auto max-w-[176px] object-contain dark:block" />
          </div>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{user?.firstName} {user?.lastName}</p>
        </div>

        <nav className="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pb-6 pr-1">
          {visibleNavSections.map((section) => (
            <div key={section.title}>
              <p className="g-section-label mb-2 px-2">{section.title}</p>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const active = isNavItemActive(item, location.pathname);
                  const Icon = item.icon;
                  const isGroup = Boolean(item.children?.length);
                  const locked = item.feature ? !entitlementsLoading && !entitlementsError && !can(item.feature) : false;
                  const planNeeded = item.feature ? requiredPlan(item.feature) : null;
                  if (isGroup) {
                    const groupOpen = Boolean(openNavGroups[item.key]);
                    const contentId = `nav-group-${item.key}`;
                    return (
                      <div key={item.key}>
                        <button
                          type="button"
                          aria-expanded={groupOpen}
                          aria-controls={contentId}
                          onClick={() => setOpenNavGroups((old) => ({ ...old, [item.key]: !old[item.key] }))}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition duration-200",
                            active
                              ? "g-nav-active bg-primary text-primary-foreground"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          <span>{item.label}</span>
                          <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform duration-200", groupOpen && "rotate-180")} />
                        </button>
                        <div
                          id={contentId}
                          className={cn(
                            "grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out",
                            groupOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                          )}
                        >
                          <div className="min-h-0 space-y-1 pl-6 pt-1">
                            {item.children?.map((child) => {
                              const childActive = isNavItemActive(child, location.pathname);
                              const ChildIcon = child.icon;
                              const childLocked = child.feature ? !entitlementsLoading && !entitlementsError && !can(child.feature) : false;
                              const childPlanNeeded = child.feature ? requiredPlan(child.feature) : null;
                              return (
                                <Link
                                  key={child.key}
                                  to={child.to ?? "#"}
                                  onClick={scrollToTop}
                                  className={cn(
                                    "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition duration-200",
                                    childActive
                                      ? "g-nav-active bg-primary text-primary-foreground"
                                      : childLocked
                                        ? "text-slate-500/95 hover:bg-violet-100/50 hover:text-violet-700 dark:text-slate-300 dark:hover:bg-violet-500/15 dark:hover:text-violet-200"
                                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                                  )}
                                >
                                  <ChildIcon className="h-4 w-4" />
                                  <span>{child.label}</span>
                                  {childLocked ? (
                                    <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-violet-300/70 bg-violet-100/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-violet-700 dark:border-violet-400/45 dark:bg-violet-500/15 dark:text-violet-200">
                                      <Lock className="h-3 w-3" />
                                      {childPlanNeeded === "ENTERPRISE" ? "Enterprise" : "Pro"}
                                    </span>
                                  ) : null}
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <Link
                      key={item.key}
                      to={item.to ?? "#"}
                      onClick={scrollToTop}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition duration-200",
                        active
                          ? "g-nav-active bg-primary text-primary-foreground"
                          : locked
                            ? "text-slate-500/95 hover:bg-violet-100/50 hover:text-violet-700 dark:text-slate-300 dark:hover:bg-violet-500/15 dark:hover:text-violet-200"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                      {locked ? (
                        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-violet-300/70 bg-violet-100/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-violet-700 dark:border-violet-400/45 dark:bg-violet-500/15 dark:text-violet-200">
                          <Lock className="h-3 w-3" />
                          {planNeeded === "ENTERPRISE" ? "Enterprise" : "Pro"}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/55 backdrop-blur-sm transition-opacity lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        <div
          className={cn(
            "saas-sidebar g-sidebar flex h-full w-[86%] max-w-xs flex-col px-4 pb-5 pt-4 text-slate-800 transition-transform dark:text-slate-200",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Menu</p>
              <img src="/brand/fleetum-logo-full-light.svg" alt="Fleetum" className="mt-0.5 h-6 w-auto max-w-[145px] object-contain dark:hidden" />
              <img src="/brand/fleetum-logo-full-dark.svg" alt="Fleetum" className="mt-0.5 hidden h-6 w-auto max-w-[145px] object-contain dark:block" />
            </div>
            <Button variant="outline" size="icon" onClick={() => setMobileOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1">
            {flattenedMobileSidebarItems.map((item) => {
              const Icon = item.icon;
              const active = isNavItemActive(item, location.pathname);
              return (
                <Link
                  key={item.key}
                  to={item.to ?? "#"}
                  onClick={() => {
                    setMobileOpen(false);
                    scrollToTop();
                  }}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                    active ? "bg-primary text-primary-foreground" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      <main
        className={cn(
          "pb-24 pt-[4.5rem] lg:pb-10",
          sidebarHidden ? "lg:ml-0" : "lg:ml-72",
          isWideWorkspaceRoute && "pb-8"
        )}
      >
        <div className={cn("mx-auto w-full px-4 sm:px-6", isWideWorkspaceRoute ? "max-w-none lg:px-4" : "max-w-[1460px]")}>
          {!backendReachable ? (
            <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Backend non raggiungibile. Verifica che API e database siano attivi. (tentativi falliti: {healthFailures})
            </div>
          ) : null}
          {licenseInfo?.expiringSoon ? (
            <div className="mb-4 rounded-xl border border-amber-400/50 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
              Licenza in scadenza
              {licenseInfo.daysRemaining !== null ? ` tra ${licenseInfo.daysRemaining} giorni` : ""}.
              {licenseInfo.expiresAt ? ` Scadenza: ${new Date(licenseInfo.expiresAt).toLocaleDateString("it-IT")}.` : ""}
            </div>
          ) : null}
          <Outlet />
        </div>
      </main>

      {privacyNoticeVisible ? (
        <div className="fixed bottom-5 left-1/2 z-[95] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 rounded-3xl border border-primary/20 bg-background/95 p-4 shadow-[0_28px_80px_-34px_rgba(15,23,42,0.62)] backdrop-blur-xl dark:border-primary/25">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">{privacyNoticeTitle}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {privacyNoticeSummary} Dopo l'accettazione non verra piu
                  mostrata su questo browser per questa versione.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => navigate("/privacy")}>
                Leggi
              </Button>
              <Button type="button" onClick={acceptPrivacyNotice}>
                Accetto
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="saas-floating-panel fixed inset-x-3 bottom-3 z-40 rounded-2xl border-border/60 p-2 lg:hidden">
        <div className="grid grid-cols-6 gap-1">
            {visibleMobileNavItems.map((item) => {
              const active =
                item.to === "/fermi"
                ? location.pathname.startsWith("/fermi") &&
                  !location.pathname.startsWith("/fermi/kanban") &&
                  !location.pathname.startsWith("/fermi/calendario")
                : location.pathname.startsWith(item.to);
            const Icon = item.icon;
            const locked = item.feature ? !entitlementsLoading && !entitlementsError && !can(item.feature) : false;
            const planNeeded = item.feature ? requiredPlan(item.feature) : null;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium",
                  active
                    ? "bg-primary text-primary-foreground"
                    : locked
                      ? "text-violet-600 dark:text-violet-300"
                      : "text-muted-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
                {locked ? <span className="text-[9px] uppercase">{planNeeded === "ENTERPRISE" ? "Ent" : "Pro"}</span> : null}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  </div>
  );
};
