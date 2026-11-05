import { WorkspaceMobileMenu } from "./workspace-mobile-menu";
import { SectionSearch } from "./section-search";
import { allowedSearchSections } from "./section-search-model";
import "../../styles/topbar-refinement.css";
import { SiteContextControl, SiteDataBoundary, useSiteContextSync, useCompanySiteView } from "./site-context";
import { useSiteAccessStore } from "../../../application/stores/site-access-store";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { flushSync } from "react-dom";
import {
  BellRing,
  Building2,
  CalendarDays,
  CarFront,
  ChevronDown,
  ChartColumnIncreasing,
  ClipboardList,
  CreditCard,
  Gauge,
  KanbanSquare,
  LogOut,
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
import { authUseCases } from "../../../application/usecases/auth-usecases";
import { notificationsUseCases } from "../../../application/usecases/notifications-usecases";
import { useAuthStore } from "../../../application/stores/auth-store";
import { FeatureKey } from "../../../domain/constants/entitlements";
import { filterFeatureVisibleItems } from "../../../domain/policies/feature-visibility";
import { canManageTenantBilling, canReadTenantBilling } from "../../../domain/policies/billing-access";
import { ThemeMode, applyTheme, getStoredTheme, setTheme, themeStorageKey } from "../../../infrastructure/theme/theme-manager";
import { createWorkspaceThemeTransition } from "../../../infrastructure/theme/workspace-theme-transition";
import { getApiBaseUrl } from "../../../infrastructure/api/api-base-url";
import { cn } from "../../../lib/utils";
import { useEntitlements } from "../../hooks/use-entitlements";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useDialogFocus } from "../../hooks/use-dialog-focus";
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

const originalNavSections: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Panoramica",
    items: [
      { key: "dashboard", to: "/dashboard", label: "Dashboard", icon: Gauge, match: (path) => path === "/dashboard" },
      {
        key: "billing",
        to: "/upgrade",
        label: "Piano e fatturazione",
        icon: CreditCard,
        match: (path) => path.startsWith("/upgrade")
      },
      {
        key: "booking",
        to: "/booking",
        label: "Prenotazioni",
        icon: CalendarDays,
        match: (path) => path === "/booking" || path.startsWith("/rental-bookings/")
      },
      {
        key: "booking-contratti",
        to: "/booking/contratti",
        label: "Contratti",
        icon: ClipboardList,
        match: (path) => path.startsWith("/booking/contratti")
      },
      {
        key: "booking-listini",
        to: "/booking/listini",
        label: "Listini",
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

const allNavItems = originalNavSections.flatMap((section) => section.items);
const orderNavItems = (keys: string[]) => keys.map((key) => allNavItems.find((item) => item.key === key)!).filter(Boolean);
const navSections = [
  { title: "Operatività", items: orderNavItems(["dashboard", "booking", "booking-contratti", "booking-listini"]) },
  { title: "Flotta", items: orderNavItems(["veicoli", "fermi-calendario", "fermi-tecnici"]) },
  { title: "Anagrafiche", items: orderNavItems(["clienti", "sedi", "officine"]) },
  { title: "Gestione", items: orderNavItems(["statistiche", "billing"]) }
];
export const AppLayout = () => {
  const sidebarStorageKey = "fermi_sidebar_hidden";
  const privacyNoticeVersion = "2026-05-05";
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, user, setUser, logout } = useAuthStore();
  useSiteContextSync();
  const siteRevision=useSiteAccessStore(s=>s.revision);
  const siteReady=useSiteAccessStore(s=>s.status==="ready");
  const companyView=useCompanySiteView();
  const canManageBilling = canManageTenantBilling(user) && companyView;
  const canReadBilling = canReadTenantBilling(user) && companyView;
  const canReadUsers = Boolean(user?.permissions.some(p => p === "*" || p === "users:read"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobilePointer = useRef(false);
  const mobileNavigateFocus = useRef(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(mobileOpen, mobileMenuRef, () => setMobileOpen(false));
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setMobileOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => { document.body.style.overflow = previous; desktop.removeEventListener("change", closeOnDesktop); };
  }, [mobileOpen]);
  useEffect(() => {
    if (mobileOpen || !mobileNavigateFocus.current) return;
    mobileNavigateFocus.current = false;
    const frame = window.requestAnimationFrame(() => document.getElementById("workspace-main")?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [mobileOpen]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notificationsOwner,setNotificationsOwner]=useState(-1);
  const [notificationsState, setNotificationsState] = useState<"loading" | "ready" | "error">("loading");
  const [notificationsReload, setNotificationsReload] = useState(0);
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<string[]>([]);
  const [backendReachable, setBackendReachable] = useState(true);
  const [healthFailures, setHealthFailures] = useState(0);
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(sidebarStorageKey) === "1";
  });
  const [theme, setThemeState] = useState<ThemeMode>(() => getStoredTheme());
  const themeIntent = useRef(theme);
  const themePending = useRef(false);
  const themeTransition = useRef<ReturnType<typeof createWorkspaceThemeTransition> | null>(null);
  if (!themeTransition.current) themeTransition.current = createWorkspaceThemeTransition();
  useEffect(() => {
    const synchronize = () => {
      const next = getStoredTheme();
      if (next === themeIntent.current && document.documentElement.classList.contains("dark") === (next === "dark")) return;
      themeTransition.current?.cancel();
      themePending.current = false;
      themeIntent.current = next;
      applyTheme(next);
      setThemeState(next);
    };
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === themeStorageKey) synchronize(); };
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const preference = () => { if (!themePending.current) synchronize(); };
    window.addEventListener("storage", storage);
    system.addEventListener("change", preference);
    return () => {
      window.removeEventListener("storage", storage);
      system.removeEventListener("change", preference);
      themeTransition.current?.cancel();
    };
  }, []);
  useEffect(() => () => {
    themeTransition.current?.cancel();
    themePending.current = false;
    themeIntent.current = document.documentElement.classList.contains("dark") ? "dark" : "light";
  }, [location.pathname]);
  const {
    can,
    plan,
    expiresAt,
    daysRemaining,
    expiringSoon,
    loaded: entitlementsLoaded
  } = useEntitlements();
  const notificationsMenuRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const notificationsTrigger = useRef<HTMLButtonElement | null>(null);
  const profileTrigger = useRef<HTMLButtonElement | null>(null);
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
    setNotifications([]); setNotificationsState("loading");
    if (!isAuthenticated || !siteReady) return;
    let mounted = true;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await notificationsUseCases.inbox();
        if (mounted) { setNotifications(result.data ?? []); setNotificationsOwner(siteRevision); setNotificationsState("ready"); }
      } catch {
        if (mounted) { setNotifications([]); setNotificationsState("error"); }
      } finally { inFlight = false; }
    };

    void load();
    const interval = setInterval(() => {
      void load();
    }, 30000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isAuthenticated, user?.id, user?.tenantId, notificationsReload, siteRevision, siteReady]);

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
        if (notificationsMenuRef.current?.contains(document.activeElement)) notificationsTrigger.current?.focus();
        if (profileMenuRef.current?.contains(document.activeElement)) profileTrigger.current?.focus();
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

  const visibleNavSections = useMemo(
    () =>
      navSections
        .map((section) => ({
          ...section,
          items: filterFeatureVisibleItems(section.items, entitlementsLoaded, can)
        }))
        .filter((section) => section.items.length > 0),
    [can, entitlementsLoaded]
  );

  const searchSections = allowedSearchSections([
    ...visibleNavSections.flatMap(section => section.items.flatMap(item => (item.children ?? [item])
      .filter(item => Boolean(item.to)).map(item => ({label:item.label,to:item.to!,group:section.title})))),
    {label:"Profilo e impostazioni",to:"/profilo",group:"Account"},
    {label:"Utenti e ruoli",to:"/utenti",group:"Azienda"},
    {label:"Profilo azienda",to:"/profilo/azienda",group:"Azienda"}
  ], user?.permissions ?? [], canReadBilling || canManageBilling, companyView)
    .filter(entry => entry.to !== "/dashboard" || (entitlementsLoaded && can("reports_basic")));

  const isCalendarRoute = location.pathname.startsWith("/fermi/calendario");
  const isWideWorkspaceRoute = isCalendarRoute || location.pathname === "/booking";

  const visibleNotifications = useMemo(
    () => notificationsOwner===siteRevision ? notifications.filter((item) => !dismissedNotificationIds.includes(item.id)) : [],
    [dismissedNotificationIds, notifications, notificationsOwner, siteRevision]
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

  const displayedPlan = plan;

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
    if (item.type === "STOPPAGE_OVERDUE") return { icon: TimerReset, kind:"warning", tone: "text-amber-600 dark:text-amber-300", to: "/fermi" };
    if (item.type === "REMINDER_FAILED") return { icon: TriangleAlert, kind:"error", tone: "text-red-600 dark:text-red-300", to: "/fermi" };
    if (item.type === "VEHICLE_DEADLINE") return { icon: AlertTriangle, kind:"warning", tone: "text-orange-600 dark:text-orange-300", to: "/anagrafiche/scadenziario" };
    return { icon: UserPlus, kind:"info", tone: "text-blue-600 dark:text-blue-300", to: "/utenti" };
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

  const toggleTheme = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const nextTheme: ThemeMode = themeIntent.current === "dark" ? "light" : "dark";
    themeIntent.current = nextTheme;
    themePending.current = true;
    themeTransition.current!.change({
      from: document.documentElement.classList.contains("dark") ? "dark" : "light",
      to: nextTheme, trigger: event.currentTarget, pointer: event.detail > 0,
      apply: () => flushSync(() => {
        themePending.current = false;
        setTheme(nextTheme);
        setThemeState(nextTheme);
      })
    });
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
    <div className="workspace-shell relative min-h-screen g-scroll" data-appearance="refined" data-surfaces="soft" data-sidebar-hidden={sidebarHidden}>
      <a href="#workspace-main" className="workspace-skip-link">Vai al contenuto</a>
      <div className="post-login-shell__content relative z-10">
      <div className="saas-topbar post-login-topbar fixed inset-x-0 top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div
          className={cn(
            "workspace-topbar-inner mx-auto flex h-16 w-full max-w-none min-w-0 items-center justify-between gap-3 px-4 sm:px-6"
          )}
        >
          <div className="workspace-context-zone flex min-w-0 items-center gap-3">
            <Button variant="outline" size="icon" className="lg:hidden" onClickCapture={event => { mobilePointer.current = event.detail > 0; }} onClick={event => { event.currentTarget.focus(); setMobileOpen(true); }} aria-label="Apri menu principale">
              <Menu className="h-5 w-5" />
            </Button>
            <SiteContextControl/>
          </div>

          <SectionSearch key={`${user?.tenantId}:${user?.id}:${siteRevision}:${siteReady}`} entries={siteReady ? searchSections : []} onNavigate={to => {
            setProfileOpen(false); setNotificationsOpen(false); navigate(to);
          }}/>

          <div className="topbar-controls-zone flex h-full shrink-0 items-center self-stretch gap-2.5 sm:gap-3">
            <Button variant="outline" size="icon" className="hidden lg:inline-flex" onClick={toggleSidebar} aria-label={sidebarHidden ? "Mostra navigazione" : "Nascondi navigazione"}>
              {sidebarHidden ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>

            <div ref={notificationsMenuRef} className="relative">
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10"
                ref={notificationsTrigger}
                aria-expanded={notificationsOpen}
                aria-controls="workspace-notifications"
                aria-label={`Apri notifiche${notificationsState === "ready" ? `, ${visibleNotifications.length} disponibili` : ""}`}
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
                <div id="workspace-notifications" role="region" aria-label="Notifiche" className="workspace-account-popover saas-floating-panel absolute right-0 top-[calc(100%+0.55rem)] z-[90] w-[min(360px,calc(100vw-1rem))] rounded-xl p-3">
                  <div className="workspace-notifications-body" tabIndex={0}>
                  <div className="saas-surface rounded-lg p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Riepilogo notifiche</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs" hidden={notificationsState !== "ready"}>
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

                  <div className="mt-3 space-y-2 pr-1">
                    {notificationsState === "loading" ? <p role="status">Caricamento delle notifiche…</p> : notificationsState === "error" ? <div role="alert" className="space-y-2"><p>Le notifiche non sono disponibili.</p><Button variant="outline" onClick={() => setNotificationsReload(key => key + 1)}>Riprova</Button></div> : visibleNotifications.length === 0 ? (
                      <p className="rounded border border-dashed p-3 text-sm text-muted-foreground">Nessuna notifica.</p>
                    ) : (
                      visibleNotifications.slice(0, 12).map((item) => {
                        const meta = notificationMeta(item);
                        const Icon = meta.icon;
                        return (
                          <div key={item.id} data-tone={meta.kind} className="workspace-notification-entry">
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
                                  <p className="text-sm font-semibold">{item.title}</p>
                                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelativeTime(item.createdAt)}</span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
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

                  </div>

                  <div className="workspace-notifications-footer mt-2 flex items-center justify-between border-t pt-2">
                    <p className="text-xs text-muted-foreground">
                      {dismissedNotificationIds.length > 0
                        ? `${dismissedNotificationIds.length} notifica${dismissedNotificationIds.length > 1 ? "he" : ""} rimoss${dismissedNotificationIds.length > 1 ? "e" : "a"}`
                        : notificationsState === "ready" ? "Aggiornamento ogni 30 secondi" : "Aggiornamento non disponibile"}
                    </p>
                    <div className="workspace-notifications-actions flex items-center gap-1">
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

            <Button variant="outline" size="icon" className="h-10 w-10" onClick={toggleTheme} aria-label={theme === "dark" ? "Attiva tema chiaro" : "Attiva tema scuro"} aria-pressed={theme === "dark"}>
              {theme === "dark" ? <Sun aria-hidden="true" className="h-4 w-4" /> : <Moon aria-hidden="true" className="h-4 w-4" />}
            </Button>

            <FleetumLanguageSwitcher className="premium-language-switcher--topbar" />

            <div ref={profileMenuRef} className="relative">
              <Button
                variant="outline"
                className="h-10 rounded-full px-3.5 shadow-[0_12px_28px_-20px_rgba(99,102,241,0.38)]"
                ref={profileTrigger}
                aria-expanded={profileOpen}
                aria-controls="workspace-profile-menu"
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
                <div id="workspace-profile-menu" role="region" aria-label="Menu del profilo" className="workspace-account-popover saas-floating-panel absolute right-0 top-[calc(100%+0.55rem)] z-[90] w-72 rounded-xl p-3">
                  <div className="saas-surface rounded-lg p-3">
                    <p className="text-sm font-semibold text-foreground">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                    <Badge variant="secondary" className="mt-2 uppercase tracking-[0.08em]">
                      Piano: {displayedPlan}
                    </Badge>
                  </div>
                  <FleetumLanguageSwitcher className="workspace-profile-language" />
                  <div className="mt-2 grid gap-1">
                    {canReadBilling || canManageBilling ? (
                      <Button
                        variant="ghost"
                        className="justify-start"
                        onClick={() => {
                          setProfileOpen(false);
                          navigate("/upgrade");
                        }}
                      >
                        Piano e fatturazione
                      </Button>
                    ) : null}
                    {canReadUsers ? <>
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
                      Profilo Azienda
                    </Button>
                    </> : null}
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
          "saas-sidebar workspace-sidebar-desktop fixed bottom-0 left-0 top-0 z-[45] hidden w-60 flex-col px-4 pb-6 pt-3 text-slate-800 transition-transform duration-300 dark:text-slate-200 lg:flex",
          sidebarHidden ? "-translate-x-full lg:pointer-events-none" : "translate-x-0"
        )}
      >
        <div className="workspace-brand">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Fleetum</p>
            <img src="/brand/fleetum-logo-full-light.svg" alt="Fleetum" className="mt-1 h-8 w-auto max-w-[176px] object-contain dark:hidden" />
            <img src="/brand/fleetum-logo-full-dark.svg" alt="Fleetum" className="mt-1 hidden h-8 w-auto max-w-[176px] object-contain dark:block" />
          </div>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{user?.firstName} {user?.lastName}</p>
        </div>

        <nav aria-label="Navigazione principale" className="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pb-6 pr-1">
          {visibleNavSections.map((section) => (
            <div key={section.title}>
              <p className="g-section-label mb-2 px-2">{section.title}</p>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const active = isNavItemActive(item, location.pathname);
                  const Icon = item.icon;
                  const isGroup = Boolean(item.children?.length);
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
                          hidden={!groupOpen}
                          className={cn(
                            "overflow-hidden",
                            groupOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                          )}
                        >
                          <div className="min-h-0 space-y-1 pl-6 pt-1">
                            {item.children?.map((child) => {
                              const childActive = isNavItemActive(child, location.pathname);
                              const ChildIcon = child.icon;
                              return (
                                <Link
                                  key={child.key}
                                  to={child.to ?? "#"}
                                  aria-current={childActive ? "page" : undefined}
                                  onClick={scrollToTop}
                                  className={cn(
                                    "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition duration-200",
                                    childActive
                                      ? "g-nav-active bg-primary text-primary-foreground"
                                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                                  )}
                                >
                                  <ChildIcon className="h-4 w-4" />
                                  <span>{child.label}</span>
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
                      aria-current={active ? "page" : undefined}
                      onClick={scrollToTop}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition duration-200",
                        active
                          ? "g-nav-active bg-primary text-primary-foreground"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {mobileOpen ? <WorkspaceMobileMenu
        dialogRef={mobileMenuRef} pointer={mobilePointer.current}
        sections={visibleNavSections} authorized={siteReady ? searchSections : []} ready={siteReady && entitlementsLoaded}
        userName={[user?.firstName, user?.lastName].filter(Boolean).join(" ")}
        isActive={item => isNavItemActive(item, location.pathname)}
        onClose={() => setMobileOpen(false)}
        onNavigate={() => { mobileNavigateFocus.current = true; setMobileOpen(false); scrollToTop(); }}
      /> : null}

      <main
        id="workspace-main"
        tabIndex={-1}
        className={cn(
          "workspace-main pb-6 pt-[5.5rem] lg:pb-10",
          sidebarHidden ? "lg:ml-0" : "lg:ml-60",
          isWideWorkspaceRoute && "workspace-main-wide"
        )}
      >
        <div className={cn("mx-auto w-full px-4 sm:px-6", isWideWorkspaceRoute ? "max-w-none lg:px-6" : "max-w-[1460px]")}>
          {!backendReachable ? (
            <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Backend non raggiungibile. Verifica che API e database siano attivi. (tentativi falliti: {healthFailures})
            </div>
          ) : null}
          {expiringSoon ? (
            <div className="mb-4 rounded-xl border border-amber-400/50 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
              Licenza in scadenza
              {daysRemaining !== null ? ` tra ${daysRemaining} giorni` : ""}.
              {expiresAt ? ` Scadenza: ${new Date(expiresAt).toLocaleDateString("it-IT")}.` : ""}
            </div>
          ) : null}
          <SiteDataBoundary><Outlet /></SiteDataBoundary>
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

    </div>
  </div>
  );
};
