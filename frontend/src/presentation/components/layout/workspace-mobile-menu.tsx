import { useEffect, useId, useLayoutEffect, useRef, useState, type ElementType, type RefObject } from "react";
import { Link } from "react-router-dom";
import { Search, UserRound, X } from "lucide-react";
import { translateText, useFleetumLanguage } from "../../i18n/fleetum-language";
import { FleetumLanguageSwitcher } from "../i18n/fleetum-language-switcher";
import { WorkspaceLogo } from "../brand/workspace-logo";
import { createMobileMenuMotion, isolateMobileMenu } from "./mobile-menu-motion";
import { mobileMenuSections } from "./mobile-menu-model";
import type { SectionEntry } from "./section-search-model";
import "../../styles/workspace-mobile-menu.css";

type Item = { key: string; label: string; to?: string; icon: ElementType; children?: Item[]; match?: (path: string) => boolean };
type Props = {
  sections: Array<{ title: string; items: Item[] }>;
  authorized: SectionEntry[];
  ready: boolean;
  dialogRef: RefObject<HTMLDivElement>;
  pointer: boolean;
  userName: string;
  isActive: (item: Item) => boolean;
  onClose: () => void;
  onNavigate: () => void;
};
const useCommitEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function WorkspaceMobileMenu({ sections, authorized, ready, dialogRef, pointer, userName, isActive, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState("");
  const { language } = useFleetumLanguage();
  const id = useId(), nav = useRef<HTMLElement>(null);
  const motion = useRef<ReturnType<typeof createMobileMenuMotion>>();
  const close = useRef(onClose); close.current = onClose;
  const groups = mobileMenuSections(sections, ready ? authorized : [], query, value => translateText(value, language));
  const count = groups.reduce((sum, section) => sum + section.items.length, 0);
  useCommitEffect(() => {
    const panel = dialogRef.current;
    if (!panel) return;
    const restore = isolateMobileMenu(panel);
    const controller = createMobileMenuMotion(panel, pointer); motion.current = controller;
    return () => { controller.destroy(); motion.current = undefined; restore(); };
    // Opening input is captured once. Locale, query and context renders must not replay an entrance.
  }, [dialogRef]);
  return <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Menu principale" tabIndex={-1} className="workspace-mobile-menu">
    <header className="workspace-mobile-menu-header">
      <div className="workspace-mobile-menu-brand">
        <WorkspaceLogo />
        <span>Menu</span>
      </div>
      <button type="button" className="workspace-mobile-menu-close" aria-label="Chiudi menu principale"
        onClick={event => motion.current ? motion.current.dismiss(() => close.current(), event.detail > 0) : close.current()}><X aria-hidden="true" /></button>
    </header>
    <div className="workspace-mobile-menu-search">
      <Search aria-hidden="true" />
      <input type="search" aria-label="Cerca una sezione" aria-describedby={`${id}-help`} placeholder="Vai a una sezione…"
        autoComplete="off" maxLength={120} value={query} disabled={!ready} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === "ArrowDown") { event.preventDefault(); nav.current?.querySelector<HTMLAnchorElement>("a[href]")?.focus(); }
          else if (event.key === "Enter" && query.trim() && count === 1) { event.preventDefault(); nav.current?.querySelector<HTMLAnchorElement>("a[href]")?.click(); }
        }} />
      {query ? <button type="button" aria-label="Cancella ricerca" onClick={event => {
        setQuery(""); event.currentTarget.parentElement?.querySelector("input")?.focus();
      }}><X aria-hidden="true" /></button> : null}
    </div>
    <span id={`${id}-help`} className="sr-only">Cerca tra le sezioni consentite. Usa Tab o freccia giù per raggiungere i risultati.</span>
    <nav ref={nav} className="workspace-mobile-menu-sections" aria-label="Sezioni del gestionale">
      {groups.map((section, index) => <section key={section.title} aria-labelledby={`${id}-section-${index}`}>
        <h2 id={`${id}-section-${index}`}>{section.title}</h2>
        <div className="workspace-mobile-menu-links">{section.items.map(item => {
          const Icon = item.icon;
          return <Link key={item.to} to={item.to} aria-current={isActive(item) ? "page" : undefined} onClick={event => {
            if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onNavigate();
          }}><Icon aria-hidden="true" /><span>{item.label}</span></Link>;
        })}</div>
      </section>)}
      {!ready ? <p role="status" className="workspace-mobile-menu-empty">Caricamento delle sezioni…</p> : !count ? <p role="status" className="workspace-mobile-menu-empty">{query.trim() ? "Nessuna sezione trovata. Prova un altro nome." : "Nessuna sezione disponibile per il tuo accesso."}</p> : null}
    </nav>
    {query && count > 0 ? <span role="status" translate="no" className="sr-only">{count} {language === "en" ? "available sections" : "sezioni disponibili"}</span> : null}
    <footer className="workspace-mobile-menu-footer">
      <span className="workspace-mobile-menu-language-label">Lingua</span>
      <FleetumLanguageSwitcher className="workspace-mobile-language" />
      {userName ? <span className="workspace-mobile-menu-identity" translate="no"><UserRound aria-hidden="true" /><span>{userName}</span></span> : null}
    </footer>
  </div>;
}
