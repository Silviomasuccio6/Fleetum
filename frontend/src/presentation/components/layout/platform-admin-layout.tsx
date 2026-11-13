import { FormEvent, useEffect, useRef, useState } from "react";
import { ChevronRight, LogOut, Menu, Search, X } from "lucide-react";
import { Outlet, useNavigate } from "react-router-dom";
import { platformAuthStorage } from "../../../infrastructure/platform/platform-auth-storage";
import { snackbar } from "../../../application/stores/snackbar-store";
import { platformAdminUseCases } from "../../../application/usecases/platform/platform-admin-usecases";
import { ThemeMode, getStoredTheme, setTheme } from "../../../infrastructure/theme/theme-manager";
import { PlatformThemeToggle } from "../platform/platform-theme-toggle";
import { PlatformDialog } from "../platform/platform-dialog";
import { isPlatformSectionId, PlatformSectionId, platformSectionLabel, platformSections } from "../platform/platform-navigation";
import { PlatformSnackbarViewport } from "../platform/platform-snackbar-viewport";

const PlatformLogo = () => (
  <span className="satin-logo" role="img" aria-label="Fleetum">
    <img className="satin-logo-light" src="/brand/fleetum-logo-full-light.svg" alt="" />
    <img className="satin-logo-dark" src="/brand/fleetum-logo-full-dark.svg" alt="" />
  </span>
);

export const PlatformAdminLayout = () => {
  const navigate = useNavigate();
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredTheme());
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [activeSection, setActiveSection] = useState<PlatformSectionId>("overview");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTheme(themeMode); }, [themeMode]);
  useEffect(() => {
    const onSection = (event: Event) => {
      const section = (event as CustomEvent<{ section?: unknown }>).detail?.section;
      if (isPlatformSectionId(section)) setActiveSection(section);
    };
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !document.querySelector("dialog:modal")) {
        event.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener("platform-console:active-section", onSection);
    window.addEventListener("keydown", onShortcut);
    return () => {
      window.removeEventListener("platform-console:active-section", onSection);
      window.removeEventListener("keydown", onShortcut);
    };
  }, []);

  const dispatchSection = (section: PlatformSectionId) => {
    navigate("/console");
    setActiveSection(section);
    window.dispatchEvent(new CustomEvent("platform-console:set-section", { detail: { section } }));
    setMenuOpen(false);
  };
  const searchCompanies = (event: FormEvent) => {
    event.preventDefault();
    dispatchSection("tenants");
    window.dispatchEvent(new CustomEvent("platform-console:search", { detail: { query } }));
  };
  const navigation = () => (
    <nav aria-label="Sezioni Platform">
      {["Gestione", "Acquisizione", "Sistema"].map((group) => (
        <div className="satin-nav-group" key={group}>
          <p className="satin-nav-label">{group}</p>
          {platformSections.filter((item) => item.group === group).map(({ id, label, icon: Icon }) => (
            <button type="button" key={id} className="satin-nav-item" aria-current={activeSection === id ? "page" : undefined}
              onClick={() => dispatchSection(id)}><Icon size={17} aria-hidden="true" /><span>{label}</span></button>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="platform-satin">
      <a className="satin-skip" href="#platform-content" onClick={(event) => { event.preventDefault(); document.getElementById("platform-content")?.focus(); }}>Vai al contenuto</a>
      <aside className="satin-sidebar">
        <div className="satin-brand"><PlatformLogo /><span>Platform Console</span></div>
        {navigation()}
        <div className="satin-sidebar-footer"><span className="satin-avatar" aria-hidden="true">F</span><div><strong>Amministrazione</strong><span>Fleetum Platform</span></div></div>
      </aside>
      <div className="satin-workspace">
        <header className="satin-topbar">
          <button type="button" className="satin-icon-button satin-menu-trigger" onClick={() => setMenuOpen(true)} aria-label="Apri menu sezioni" aria-haspopup="dialog"><Menu size={19} /></button>
          <div className="satin-breadcrumb"><span>Platform</span><ChevronRight size={13} aria-hidden="true" /><strong>{platformSectionLabel(activeSection)}</strong></div>
          <form className="satin-search" role="search" onSubmit={searchCompanies}>
            <Search size={16} aria-hidden="true" /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca aziende…" aria-label="Cerca aziende nella Console" />
            <button type="submit" aria-label="Esegui ricerca"><ChevronRight size={16} /></button>
          </form>
          <div className="satin-topbar-actions">
            <PlatformThemeToggle mode={themeMode} onToggle={() => setThemeMode((current) => current === "dark" ? "light" : "dark")} />
            <button type="button" className="satin-icon-button" aria-label={loggingOut ? "Uscita in corso" : "Esci dalla Platform"} title="Esci dalla Platform" disabled={loggingOut} aria-busy={loggingOut} onClick={async () => {
              setLoggingOut(true);
              try {
                const result = await platformAdminUseCases.logout();
                if (result.sessionCleared && !platformAuthStorage.get()) navigate("/login", { replace: true });
              } catch {
                snackbar.error("Uscita non confermata. La sessione resta aperta: riprova.");
              } finally {
                setLoggingOut(false);
              }
            }}><LogOut size={17} /></button>
          </div>
        </header>
        <main id="platform-content" className="satin-content" tabIndex={-1}><Outlet /></main>
      </div>
      {menuOpen ? <PlatformDialog label="Menu Platform" onDismiss={() => setMenuOpen(false)}>
        <div className="satin-mobile-header"><PlatformLogo /><button type="button" className="satin-icon-button" onClick={() => setMenuOpen(false)} aria-label="Chiudi menu sezioni"><X size={19} /></button></div>
        {navigation()}
      </PlatformDialog> : null}
      <PlatformSnackbarViewport />
    </div>
  );
};
