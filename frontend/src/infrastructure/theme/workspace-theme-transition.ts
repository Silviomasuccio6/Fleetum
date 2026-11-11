import type { ThemeMode } from "./theme-manager";

type NativeTransition = {
  ready: Promise<unknown>;
  finished: Promise<unknown>;
  updateCallbackDone?: Promise<unknown>;
  skipTransition: () => void;
};
type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => NativeTransition;
};
type Change = { from: ThemeMode; to: ThemeMode; trigger: HTMLElement; pointer: boolean; apply: () => void };
type Job = { id: number; change: Change; applied: boolean; transition?: NativeTransition; animation?: Animation; detach: () => void };
const attribute = "data-fleetum-theme-transition";

export const themeCircle = (rect: Pick<DOMRect, "left" | "top" | "width" | "height">, width: number, height: number) => {
  const x = Math.max(0, Math.min(width, rect.left + rect.width / 2));
  const y = Math.max(0, Math.min(height, rect.top + rect.height / 2));
  return { x, y, radius: Math.hypot(Math.max(x, width - x), Math.max(y, height - y)) + 2 };
};

/** Only the authenticated workspace opts in. Native snapshots never duplicate the React tree. */
export const createWorkspaceThemeTransition = () => {
  let serial = 0;
  let active: Job | undefined;

  const release = (job: Job) => {
    if (active !== job) return;
    active = undefined;
    job.detach();
    document.documentElement.removeAttribute(attribute);
    job.animation?.cancel();
    try { job.transition?.skipTransition(); } catch { /* The native transition may already have ended. */ }
  };
  const applyOnce = (job: Job) => {
    // skipTransition does not skip the queued update callback. Reject superseded jobs explicitly.
    if (active !== job || job.id !== serial || job.applied) return;
    job.applied = true;
    job.change.apply();
  };
  const finish = (job: Job) => { applyOnce(job); release(job); };
  const cancel = () => {
    serial++;
    if (active) release(active);
  };

  const change = (request: Change): "circular" | "instant" => {
    const interrupted = Boolean(active);
    cancel();
    const doc = document as TransitionDocument;
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    // On rapid input, settle the latest intent immediately instead of queuing snapshots of stale themes.
    if (interrupted || !request.pointer || reduced.matches || document.hidden || request.from === request.to ||
      !root.hasAttribute("data-fleetum-workspace") || typeof doc.startViewTransition !== "function" || typeof root.animate !== "function") {
      request.apply();
      return "instant";
    }

    const circle = themeCircle(request.trigger.getBoundingClientRect(), window.innerWidth, window.innerHeight);
    const job: Job = { id: serial, change: request, applied: false, detach: () => {} };
    active = job;
    root.setAttribute(attribute, request.to === "dark" ? "to-dark" : "to-light");
    const invalidate = () => finish(job);
    const hidden = () => { if (document.hidden) finish(job); };
    const motion = () => { if (reduced.matches) finish(job); };
    window.addEventListener("resize", invalidate);
    window.addEventListener("beforeprint", invalidate);
    document.addEventListener("visibilitychange", hidden);
    reduced.addEventListener("change", motion);
    job.detach = () => {
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("beforeprint", invalidate);
      document.removeEventListener("visibilitychange", hidden);
      reduced.removeEventListener("change", motion);
    };

    try {
      const transition = doc.startViewTransition(() => applyOnce(job));
      job.transition = transition;
      transition.updateCallbackDone?.catch(() => finish(job));
      transition.ready.then(() => {
        if (active !== job) return;
        const clips = [`circle(0px at ${circle.x}px ${circle.y}px)`, `circle(${circle.radius}px at ${circle.x}px ${circle.y}px)`];
        try {
          job.animation = root.animate({ clipPath: request.to === "dark" ? clips : [...clips].reverse() }, {
            duration: 280, easing: "cubic-bezier(.77,0,.175,1)", fill: "both",
            pseudoElement: request.to === "dark" ? "::view-transition-new(root)" : "::view-transition-old(root)"
          });
          job.animation.finished.then(() => release(job), () => release(job));
        } catch { finish(job); }
      }, () => finish(job));
      transition.finished.then(() => { if (!job.animation) finish(job); }, () => finish(job));
    } catch { finish(job); }
    return "circular";
  };
  return { change, cancel };
};
