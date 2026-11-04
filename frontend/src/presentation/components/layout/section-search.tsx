import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { useAnchoredMenu } from "../../hooks/use-anchored-menu";
import { matchSections, type SectionEntry } from "./section-search-model";

export function SectionSearch({ entries, onNavigate }: { entries: SectionEntry[]; onNavigate: (to: string) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const id = useId(), input = useRef<HTMLInputElement>(null), mobileTrigger = useRef<HTMLButtonElement>(null);
  const { root, position } = useAnchoredMenu(open, () => setOpen(false));
  const results = matchSections(entries, query);
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  const close = () => {
    setOpen(false);
    if (mobileTrigger.current?.getClientRects().length) mobileTrigger.current.focus();
    else input.current?.focus();
  };
  const choose = (entry?: SectionEntry) => {
    if (!entry) return;
    setQuery(""); close(); onNavigate(entry.to);
  };
  return <div ref={root} className="workspace-section-search" data-open={open}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <button ref={mobileTrigger} type="button" className="workspace-search-trigger" aria-label="Cerca una sezione"
      aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined}
      onClick={() => { setOpen(!open); requestAnimationFrame(() => input.current?.focus()); }}><Search size={18} aria-hidden="true"/></button>
    <div className="workspace-search-content" id={`${id}-panel`} data-above={position.above}>
      <div className="workspace-search-field">
        <Search size={17} aria-hidden="true"/>
        <input ref={input} type="text" role="combobox" aria-label="Cerca una sezione" placeholder="Cerca una sezione…"
          autoComplete="off" maxLength={120} aria-autocomplete="list" aria-expanded={open}
          aria-controls={open ? `${id}-results` : undefined} aria-describedby={`${id}-help`}
          aria-activedescendant={open && results[active] ? `${id}-${active}` : undefined} value={query}
          onClick={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }}
          onKeyDown={event => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
            else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && (open || event.key.startsWith("Arrow"))) {
              event.preventDefault(); setOpen(true);
              setActive(event.key === "Home" ? 0 : event.key === "End" ? Math.max(0, results.length - 1) : Math.max(0, Math.min(results.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))));
            } else if (event.key === "Enter" && open) { event.preventDefault(); choose(results[active]); }
          }}/>
        {query ? <button type="button" aria-label="Cancella ricerca" onClick={() => { setQuery(""); setActive(0); input.current?.focus(); }}><X size={15} aria-hidden="true"/></button> : null}
        <button type="button" className="workspace-search-close" aria-label="Chiudi ricerca" onClick={close}><X size={17} aria-hidden="true"/></button>
      </div>
      <span id={`${id}-help`} className="sr-only">Cerca nelle sezioni accessibili del gestionale. Usa le frecce e Invio per aprire.</span>
      {open ? <div className="workspace-search-results" data-above={position.above} style={{ maxHeight: position.maxHeight }}>
        <p className="workspace-search-hint">Sezioni del gestionale</p>
        <div id={`${id}-results`} role="listbox" aria-label="Sezioni disponibili">
          {results.map((entry, index) => <div key={entry.to} id={`${id}-${index}`} role="option" aria-selected={index === active}
            onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(entry)}>
            <span><strong>{entry.label}</strong><small>{entry.group}</small></span><ArrowUpRight size={15} aria-hidden="true"/>
          </div>)}
        </div>
        <p role="status" className={results.length ? "sr-only" : "workspace-search-empty"}>{results.length ? `${results.length} sezioni disponibili` : "Nessuna sezione trovata. Prova un altro nome."}</p>
      </div> : null}
    </div>
  </div>;
}
