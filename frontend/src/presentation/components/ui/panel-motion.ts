export type PanelBounds = { left: number; top: number; width: number; height: number };
export type PanelMotionHandle = { dismiss: (done: () => void) => void };

export const panelMotionDuration = (reduced: boolean, closing = false) => reduced ? 0 : closing ? 190 : 280;

/** Clip the origin to the actual overlay, including the local-preview offset. */
export function panelOriginBounds(origin: PanelBounds | null, viewport: PanelBounds, minimum = 24): PanelBounds | null {
  if (!origin || ![origin.left, origin.top, origin.width, origin.height, viewport.left, viewport.top, viewport.width, viewport.height].every(Number.isFinite)) return null;
  if (origin.width <= 0 || origin.height <= 0 || viewport.width <= 0 || viewport.height <= 0 || !Number.isFinite(minimum) || minimum <= 0) return null;
  const left = Math.max(origin.left, viewport.left), top = Math.max(origin.top, viewport.top);
  const right = Math.min(origin.left + origin.width, viewport.left + viewport.width);
  const bottom = Math.min(origin.top + origin.height, viewport.top + viewport.height);
  return right - left >= minimum && bottom - top >= minimum ? { left, top, width: right - left, height: bottom - top } : null;
}

export function createPanelMotion(panel: HTMLElement, frame: HTMLElement, originButton: HTMLElement | null, animateOpen = true) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const origin = originButton?.closest<HTMLElement>('[data-panel-origin]') ?? null;
  let phase: 'opening' | 'open' | 'closing' | 'closed' = 'open';
  let animations: Animation[] = [], layers: HTMLElement[] = [], version = 0;
  let timer: number | undefined, closeDone: (() => void) | null = null, disposed = false;
  const reduced = () => media.matches || typeof panel.animate !== 'function';
  const setPhase = (value: typeof phase) => { phase = value; panel.dataset.panelPhase = value; };
  const clear = () => {
    window.clearTimeout(timer); timer = undefined;
    animations.forEach(animation => animation.cancel()); animations = [];
    layers.forEach(layer => layer.remove()); layers = [];
  };
  const settleOpen = () => { version++; clear(); setPhase('open'); };
  const settleClosed = () => {
    version++; clear(); setPhase('closed'); const done = closeDone; closeDone = null; done?.();
  };
  const awaitEnd = (done: () => void, milliseconds: number) => {
    const current = ++version;
    const finish = () => { if (!disposed && current === version) done(); };
    Promise.all(animations.map(animation => animation.finished)).then(finish, () => {});
    timer = window.setTimeout(finish, milliseconds + 120);
  };
  const animate = (element: HTMLElement, keyframes: Keyframe[], milliseconds: number, reverse: boolean) => {
    const animation = element.animate(keyframes, { duration: milliseconds, easing: 'cubic-bezier(.2,.72,.2,1)', fill: 'both', direction: reverse ? 'reverse' : 'normal' });
    animations.push(animation);
  };
  const layer = (kind: string, bounds: PanelBounds) => {
    const element = document.createElement('div'); element.className = `fleetum-panel-${kind}`;
    element.setAttribute('aria-hidden', 'true'); element.inert = true;
    Object.assign(element.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
    panel.append(element); layers.push(element); return element;
  };
  const fillColor = (element: HTMLElement) => {
    let current: HTMLElement | null = element;
    while (current) {
      const color = getComputedStyle(current).backgroundColor;
      if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
      current = current.parentElement;
    }
    return getComputedStyle(panel).getPropertyValue('--refinement-panel-surface').trim() || '#ffffff';
  };
  const build = (milliseconds: number, reverse: boolean) => {
    const measured = panel.getBoundingClientRect();
    const target: PanelBounds = { left: measured.left, top: measured.top, width: measured.width, height: measured.height };
    const viewport = panel.parentElement?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const from = panelOriginBounds(origin?.isConnected ? origin.getBoundingClientRect() : null, viewport);
    if (!from || !target.width || !target.height) {
      panel.dataset.panelMotion = 'lateral';
      animate(panel, [{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'translateX(0)' }], milliseconds, reverse);
      return;
    }
    panel.dataset.panelMotion = 'shared';
    const dx = from.left - target.left, dy = from.top - target.top, sx = from.width / target.width, sy = from.height / target.height;
    const surface = layer('surface', target), edge = layer('edge', { ...target, width: 2 });
    const radius = parseFloat(getComputedStyle(origin!).borderTopLeftRadius) || 0;
    animate(surface, [
      { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, borderRadius: `${radius / sx}px / ${radius / sy}px`, backgroundColor: fillColor(origin!) },
      { transform: 'translate(0,0) scale(1,1)', borderRadius: '0px', backgroundColor: getComputedStyle(surface).backgroundColor }
    ], milliseconds, reverse);
    animate(edge, [{ transform: `translate(${dx}px,${dy}px) scaleY(${sy})` }, { transform: 'translate(0,0) scaleY(1)' }], milliseconds, reverse);
    const polygon = (x: number, y: number, width: number, height: number) => `polygon(${x}px ${y}px,${x + width}px ${y}px,${x + width}px ${y + height}px,${x}px ${y + height}px)`;
    animate(frame, [{ clipPath: polygon(dx, dy, from.width, from.height) }, { clipPath: polygon(0, 0, target.width, target.height) }], milliseconds, reverse);
    const sourceTitle = originButton?.querySelector<HTMLElement>('[data-panel-origin-title]');
    const destinationTitle = panel.querySelector<HTMLElement>('[data-panel-title]');
    if (sourceTitle && destinationTitle) {
      const sourceRect = sourceTitle.getBoundingClientRect(), destinationRect = destinationTitle.getBoundingClientRect();
      const visibleTitle = panelOriginBounds(sourceRect, viewport, 1);
      if (visibleTitle && visibleTitle.width >= sourceRect.width - .5 && visibleTitle.height >= sourceRect.height - .5) {
        const name = layer('identity', sourceRect), style = getComputedStyle(sourceTitle);
        name.textContent = sourceTitle.textContent; name.setAttribute("translate", "no");
        Object.assign(name.style, { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight });
        animate(name, [{ transform: 'translate(0,0)', opacity: 1, offset: 0 }, { opacity: 1, offset: .58 }, { opacity: 0, offset: .8 }, { transform: `translate(${destinationRect.left - sourceRect.left}px,${destinationRect.top - sourceRect.top}px)`, opacity: 0, offset: 1 }], milliseconds, reverse);
      }
    }
    const reveal = (selector: string, start: number, end: number) => {
      const element = panel.querySelector<HTMLElement>(selector); if (!element) return;
      animate(element, [{ opacity: 0, offset: 0 }, { opacity: 0, offset: start }, { opacity: 1, offset: end }, { opacity: 1, offset: 1 }], milliseconds, reverse);
    };
    reveal('[data-panel-title]', .8, .98); reveal('[data-panel-eyebrow],.customer-eyebrow', .45, .85);
    reveal('[data-panel-close],.customer-drawer-header > button', .55, .9);
    reveal('[data-panel-content],.customer-drawer-content', .46, .98); reveal('[data-panel-footer],.customer-drawer-footer', .5, .95);
  };
  const dismiss = (done: () => void) => {
    if (disposed) { done(); return; }
    if (phase === 'closing' || phase === 'closed') return;
    closeDone = done;
    const milliseconds = panelMotionDuration(reduced(), true);
    if (!milliseconds) { settleClosed(); return; }
    if (phase === 'opening' && animations.length) {
      version++; window.clearTimeout(timer); setPhase('closing');
      animations.forEach(animation => { animation.reverse(); animation.playbackRate = -280 / milliseconds; });
    } else { version++; clear(); setPhase('closing'); build(milliseconds, true); }
    awaitEnd(settleClosed, milliseconds);
  };
  const interact = () => { if (phase === 'opening') settleOpen(); };
  const onKey = (event: KeyboardEvent) => {
    if (phase === 'closing') { event.preventDefault(); event.stopPropagation(); }
    else if (event.key === 'Tab') interact();
  };
  const resize = () => { if (phase === 'opening') settleOpen(); else if (phase === 'closing') settleClosed(); };
  const preference = () => { if (reduced()) resize(); };
  panel.addEventListener('pointerdown', interact, true); panel.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', resize); media.addEventListener('change', preference);
  const milliseconds = animateOpen ? panelMotionDuration(reduced()) : 0;
  if (milliseconds) { setPhase('opening'); build(milliseconds, false); awaitEnd(settleOpen, milliseconds); }
  else { panel.dataset.panelMotion = 'direct'; setPhase('open'); }
  return {
    dismiss,
    destroy() {
      disposed = true; version++; closeDone = null; clear();
      panel.removeEventListener('pointerdown', interact, true); panel.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', resize); media.removeEventListener('change', preference);
      delete panel.dataset.panelPhase; delete panel.dataset.panelMotion;
    }
  };
}
