/** Isolate only siblings along the dialog's ancestry; never make the dialog's own ancestor inert. */
export function isolateMobileMenu(dialog: HTMLElement) {
  const changed: HTMLElement[] = [];
  let branch: HTMLElement | null = dialog;
  while (branch?.parentElement && branch.parentElement !== document.documentElement) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (sibling instanceof HTMLElement && sibling !== branch && !sibling.inert) {
        sibling.inert = true; changed.push(sibling);
      }
    }
    branch = branch.parentElement;
  }
  return () => changed.forEach(element => { element.inert = false; });
}

/** A single short workspace transition. No snapshots, clones, per-row motion or React frame updates. */
export function createMobileMenuMotion(panel: HTMLElement, pointer: boolean) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let phase: "opening" | "open" | "closing" | "closed" = "open";
  let animation: Animation | undefined, timer: number | undefined, generation = 0, disposed = false;
  let closeDone: (() => void) | undefined;
  const clear = () => { generation++; window.clearTimeout(timer); timer = undefined; animation?.cancel(); animation = undefined; };
  const settle = () => {
    const closing = phase === "closing";
    clear(); phase = closing ? "closed" : "open";
    if (closing) { const done = closeDone; closeDone = undefined; done?.(); }
  };
  const run = (closing: boolean, input: boolean) => {
    const from = phase === "opening" ? { opacity: getComputedStyle(panel).opacity, transform: getComputedStyle(panel).transform } : { opacity: "1", transform: "none" };
    clear(); phase = closing ? "closing" : "opening";
    if (!input || media.matches || document.hidden || typeof panel.animate !== "function") { settle(); return; }
    const duration = closing ? 160 : 220, id = generation;
    const finish = () => { if (!disposed && generation === id) settle(); };
    try {
      animation = panel.animate(closing ? [from, { opacity: 0, transform: "translateY(12px)" }] : [
        { opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }
      ], { duration, easing: "cubic-bezier(.23,1,.32,1)", fill: "both" });
      animation.finished.then(finish, finish);
      timer = window.setTimeout(finish, duration + 100);
    } catch { settle(); }
  };
  const resize = () => { if (phase === "opening" || phase === "closing") settle(); };
  const reduce = () => { if (media.matches) resize(); };
  const hidden = () => { if (document.hidden) resize(); };
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", hidden);
  media.addEventListener("change", reduce);
  run(false, pointer);
  return {
    dismiss(done: () => void, input: boolean) {
      if (disposed) return;
      if (phase === "closed") { done(); return; }
      if (phase === "closing") { if (!input) settle(); return; }
      closeDone = done; run(true, input);
    },
    destroy() {
      disposed = true; closeDone = undefined; clear();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", hidden);
      media.removeEventListener("change", reduce);
    }
  };
}
