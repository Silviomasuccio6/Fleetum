import { useEffect, useLayoutEffect, useRef } from "react";

export type ChartTransition = { cancel: (settle: boolean) => void };
export const chartMotionAllowed = (previous: string | null, next: string | null, pointer: boolean, reduced: boolean, visible: boolean) =>
  previous !== null && next !== null && previous !== next && pointer && !reduced && visible;

/** Same timing function as the theme: solve x(t) before evaluating y(t). */
export const chartMotionEase = (progress: number) => {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  let low = 0, high = 1, t = progress;
  for (let i = 0; i < 14; i++) {
    t = (low + high) / 2;
    const x = 3 * (1 - t) ** 2 * t * .77 + 3 * (1 - t) * t ** 2 * .175 + t ** 3;
    if (x < progress) low = t; else high = t;
  }
  return 3 * (1 - t) * t ** 2 + t ** 3;
};

const useCommitEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useWorkspaceChartTransition(signature: string | null, run: (animate: boolean) => ChartTransition | undefined) {
  const previous = useRef<string | null>(null);
  const input = useRef({ pointer: false, at: 0 });
  const active = useRef<ChartTransition>();
  const reduced = useRef(typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = media.matches;
    const pointer = () => { input.current = { pointer: true, at: Date.now() }; };
    const keyboard = () => { input.current.pointer = false; active.current?.cancel(true); };
    const preference = () => { reduced.current = media.matches; if (media.matches) active.current?.cancel(true); };
    const hidden = () => { if (document.hidden) active.current?.cancel(true); };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("visibilitychange", hidden);
    media.addEventListener("change", preference);
    return () => {
      active.current?.cancel(true);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("visibilitychange", hidden);
      media.removeEventListener("change", preference);
    };
  }, []);
  useCommitEffect(() => {
    const animate = chartMotionAllowed(previous.current, signature, input.current.pointer && Date.now() - input.current.at <= 2500, reduced.current, !document.hidden);
    active.current?.cancel(false);
    active.current = run(animate);
    previous.current = signature;
    // Only actual data changes start a transition; identity changes in callbacks/tooltip state must not replay it.
  }, [signature]);
}
