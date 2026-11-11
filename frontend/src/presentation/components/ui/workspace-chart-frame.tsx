import { useRef, type ReactNode } from "react";
import { useWorkspaceChartTransition } from "../../hooks/use-workspace-chart-transition";

/** Retains Recharts, its tooltips and axes; only the data paths receive the approved reveal. */
export function WorkspaceChartFrame({ data, children, label, className = "dashboard-chart" }: { data: unknown; children: ReactNode; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reveal = useRef(0);
  useWorkspaceChartTransition(data == null ? null : JSON.stringify(data), animate => {
    if (!animate || !ref.current || typeof ref.current.animate !== "function") { reveal.current = 0; return undefined; }
    const start = Math.max(0, Math.min(1, reveal.current));
    reveal.current = 0;
    const animations: Animation[] = [];
    ref.current.querySelectorAll<SVGElement>(".recharts-line-curve,.recharts-area-curve,.recharts-area-area").forEach(path => {
      try {
        const animation = path.animate({ clipPath: [`inset(-4px ${(1 - start) * 100}% -4px -4px)`, "inset(-4px -4px -4px -4px)"] }, { duration: 280, easing: "cubic-bezier(.77,0,.175,1)" });
        animation.finished.catch(() => {});
        animations.push(animation);
      } catch { /* A browser without SVG masks still presents the complete data. */ }
    });
    return { cancel: settle => {
      const first = animations[0];
      const progress = first?.playState === "running" ? first.effect?.getComputedTiming().progress : null;
      // A rapid selection continues from the visible edge; completed or settled reveals start afresh.
      reveal.current = !settle && progress != null ? start + (1 - start) * progress : 0;
      animations.forEach(animation => animation.cancel());
    } };
  });
  return <div ref={ref} className={className} role="img" aria-label={label}>{children}</div>;
}
