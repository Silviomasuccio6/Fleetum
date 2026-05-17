import { useEffect, useRef, useState } from "react";
import { Activity, BarChart3, Building2, ChevronDown, Lock, Menu, SlidersHorizontal, Users } from "lucide-react";
import { Outlet, useNavigate } from "react-router-dom";
import { platformAdminUseCases } from "../../../application/usecases/platform/platform-admin-usecases";
import { ThemeMode, getStoredTheme, setTheme } from "../../../infrastructure/theme/theme-manager";
import { PlatformThemeToggle } from "../platform/platform-theme-toggle";
import { Button } from "../ui/button";

type PlatformSection = "overview" | "clients" | "revenue" | "events" | "tools";

export const PlatformAdminLayout = () => {
  const navigate = useNavigate();
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredTheme());
  const [consoleMenuOpen, setConsoleMenuOpen] = useState(false);
  const [activeSectionLabel, setActiveSectionLabel] = useState("Clienti");
  const consoleMenuRef = useRef<HTMLDivElement | null>(null);
  const sectionLabel: Record<PlatformSection, string> = {
    overview: "Dashboard",
    clients: "Clienti",
    revenue: "Ricavi",
    events: "Eventi & Audit",
    tools: "Strumenti"
  };
  const consoleMenuItems: Array<{
    section: PlatformSection;
    label: string;
    description: string;
    icon: any;
  }> = [
    { section: "clients", label: "Clienti", description: "Gestione clienti e licenze", icon: Building2 },
    { section: "overview", label: "Dashboard", description: "KPI globali e live", icon: Users },
    { section: "revenue", label: "Ricavi", description: "Trend e performance economica", icon: BarChart3 },
    { section: "events", label: "Eventi", description: "Audit operativo", icon: Activity },
    { section: "tools", label: "Strumenti", description: "Azioni e utilità", icon: SlidersHorizontal }
  ];

  useEffect(() => {
    setTheme(themeMode);
  }, [themeMode]);

  useEffect(() => {
    const onActiveSectionChanged = (event: Event) => {
      const payload = (event as CustomEvent<{ section?: PlatformSection }>).detail;
      if (payload?.section && sectionLabel[payload.section]) {
        setActiveSectionLabel(sectionLabel[payload.section]);
      }
    };
    window.addEventListener("platform-console:active-section", onActiveSectionChanged as EventListener);
    return () => window.removeEventListener("platform-console:active-section", onActiveSectionChanged as EventListener);
  }, []);

  useEffect(() => {
    if (!consoleMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!consoleMenuRef.current) return;
      if (!consoleMenuRef.current.contains(event.target as Node)) {
        setConsoleMenuOpen(false);
      }
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConsoleMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [consoleMenuOpen]);

  const toggleTheme = () => {
    setThemeMode((current) => (current === "dark" ? "light" : "dark"));
  };

  const dispatchSection = (section: PlatformSection) => {
    navigate("/console");
    setActiveSectionLabel(sectionLabel[section]);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("platform-console:set-section", { detail: { section } }));
    }, 0);
    setConsoleMenuOpen(false);
  };

  const openMobileSidebar = () => {
    window.dispatchEvent(new CustomEvent("platform-console:open-mobile-sidebar"));
    setConsoleMenuOpen(false);
  };

  return (
    <div className="platform-shell post-login-shell min-h-screen bg-background">
      <header className="platform-topbar sticky top-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="mx-auto flex h-16 max-w-[1540px] min-w-0 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div ref={consoleMenuRef} className="relative shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                aria-label="Apri menu sezioni"
                aria-expanded={consoleMenuOpen}
                onClick={() => setConsoleMenuOpen((old) => !old)}
              >
                <Menu className="h-4 w-4" />
                Menu
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${consoleMenuOpen ? "rotate-180" : ""}`} />
              </Button>

              {consoleMenuOpen ? (
                <div className="platform-console-menu-pop platform-admin-mobile-aside g-sidebar absolute left-0 top-full z-[80] mt-2 w-[300px] rounded-2xl border border-border/70 p-3 shadow-xl">
                  <div className="mb-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Sezioni Console</p>
                  </div>
                  <div className="space-y-1.5">
                    {consoleMenuItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.section}
                          type="button"
                          className="platform-admin-nav-item platform-console-menu-item"
                          onClick={() => dispatchSection(item.section)}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 text-left">
                            <span className="block text-sm font-semibold text-foreground">{item.label}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{item.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="my-2 h-px bg-border/70 lg:hidden" />
                  <Button type="button" variant="ghost" size="sm" className="platform-console-menu-item w-full justify-start lg:hidden" onClick={openMobileSidebar}>
                    Apri menu laterale completo
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="grid h-9 w-9 place-items-center rounded-lg border bg-muted text-foreground">
              <img src="/brand/fleetum-symbol-color.svg" alt="" className="h-6 w-6 object-contain" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold uppercase tracking-[0.14em] text-foreground">Platform Console</p>
              <p className="truncate text-xs font-medium text-muted-foreground">{activeSectionLabel}</p>
            </div>
          </div>

          <div className="hidden shrink-0 items-center gap-2 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-foreground lg:flex">
            <Lock className="h-3.5 w-3.5" />
            Local-only · IP restricted
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <PlatformThemeToggle mode={themeMode} onToggle={toggleTheme} />
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                platformAdminUseCases.logout();
                navigate("/login");
              }}
            >
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1540px] space-y-6 px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
};
