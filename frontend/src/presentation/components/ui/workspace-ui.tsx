import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type PageHeaderProps = { eyebrow: string; title: string; description: string; actions?: ReactNode };

export const WorkspacePageHeader = ({ eyebrow, title, description, actions }: PageHeaderProps) => (
  <header className="workspace-page-header">
    <div>
      <p className="workspace-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="workspace-description">{description}</p>
    </div>
    <div className="workspace-page-actions">{actions}</div>
  </header>
);

type Metric = { label: string; value: number | string; hint: string; icon: LucideIcon };

export const WorkspaceMetricStrip = ({ items, loading = false, collapsible = false }: { items: Metric[]; loading?: boolean; collapsible?: boolean }) => {
  const [expanded, setExpanded] = useState(() => typeof window === "undefined" || !window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    if (!collapsible) return;
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setExpanded(!media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [collapsible]);
  const content = <dl className="workspace-metrics" aria-label="Riepilogo del periodo" aria-busy={loading}>
    {items.map(({ label, value, hint, icon: Icon }) => (
      <div className="workspace-metric" key={label}>
        <dt><Icon className="h-4 w-4" aria-hidden={true} />{label}</dt>
        <dd className="workspace-metric-value">{loading ? "—" : value}</dd>
        <dd className="workspace-metric-hint">{hint}</dd>
      </div>
    ))}
  </dl>;
  return collapsible ? <details className="workspace-summary" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>Riepilogo del periodo<span>{expanded ? "Nascondi indicatori" : "Mostra indicatori"}</span></summary>{content}
  </details> : content;
};

export const WorkspaceFilterGroup = ({ children, activeCount }: { children: ReactNode; activeCount: number }) => {
  const [expanded, setExpanded] = useState(() => typeof window === "undefined" || !window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setExpanded(!media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return <details className="workspace-filter-group" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>Filtri per sede e stato<span>{activeCount ? `${activeCount} attivi` : "Mostra filtri"}</span></summary>
    <div className="workspace-filter-group-fields">{children}</div>
  </details>;
};
