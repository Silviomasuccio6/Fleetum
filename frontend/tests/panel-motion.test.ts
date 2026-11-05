import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPanelMotion, panelOriginBounds, panelMotionDuration } from '../src/presentation/components/ui/panel-motion';
import { CustomerCollection } from '../src/presentation/components/customers/customer-workspace';

const viewport = { left: 0, top: 34, width: 390, height: 810 };
test('panel origins are clipped to the visible application, including the preview banner', () => {
  assert.deepEqual(panelOriginBounds({ left: -10, top: 10, width: 420, height: 200 }, viewport), { left: 0, top: 34, width: 390, height: 176 });
});
test('offscreen, tiny and invalid origins fall back to the lateral opening', () => {
  for (const origin of [null, { left: 0, top: 900, width: 300, height: 100 }, { left: 0, top: 20, width: 20, height: 100 }, { left: NaN, top: 40, width: 200, height: 100 }, { left: 0, top: 40, width: -1, height: 100 }]) {
    assert.equal(panelOriginBounds(origin, viewport), null);
  }
});
test('DOM rectangle getters need no enumerable own fields to describe an origin', () => {
  const rectangle = Object.create({ left: 10, top: 100, width: 280, height: 120 });
  assert.deepEqual(panelOriginBounds(rectangle, viewport), { left: 10, top: 100, width: 280, height: 120 });
});
test('reduced motion applies to both opening and closing', () => {
  assert.equal(panelMotionDuration(true), 0); assert.equal(panelMotionDuration(true, true), 0);
  assert.equal(panelMotionDuration(false), 280); assert.equal(panelMotionDuration(false, true), 190);
});
test('small text can travel with the panel without being treated as a small interactive target', () => {
  const title = { left: 20, top: 100, width: 120, height: 17 };
  assert.equal(panelOriginBounds(title, viewport), null);
  assert.deepEqual(panelOriginBounds(title, viewport, 1), title);
});
test('the selected customer is exposed in both responsive views without exposing internal ids', () => {
  const rows = [{ id: 'internal-qa-customer', customerType: 'PERSONA_FISICA' as const, firstName: 'Synthetic', lastName: '<Example>', email: 'qa@example.invalid', contractsTotal: 0 }];
  const html = renderToStaticMarkup(React.createElement(CustomerCollection, { rows, selectedId: rows[0].id, onOpen: () => {} }));
  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 2);
  assert.ok(html.includes('Selezionata')); assert.ok(html.includes('&lt;Example&gt;'));
  assert.ok(!html.includes('internal-qa-customer')); assert.ok(html.includes('Contratti'));
});

// Exercise the controller's lifecycle without a browser, real timers or animation delays.
function withMotionEnvironment(reduced: boolean, run: (env: ReturnType<typeof motionEnvironment>) => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const env = motionEnvironment(reduced);
  Object.defineProperty(globalThis, 'window', { value: env.window, configurable: true });
  try { run(env); } finally { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); }
}
function motionEnvironment(reduced: boolean) {
  const events = new Map<string, EventListener>(), timers = new Map<number, () => void>();
  let next = 0, created = 0, cancelled = 0;
  const subscribe = (name: string, listener: EventListener) => events.set(name, listener);
  const unsubscribe = (name: string) => events.delete(name);
  const media = { matches: reduced, addEventListener: subscribe, removeEventListener: unsubscribe };
  const bounds = { left: 0, top: 34, width: 390, height: 810 };
  const panel = { dataset: {} as Record<string, string>, parentElement: { getBoundingClientRect: () => bounds }, getBoundingClientRect: () => bounds,
    addEventListener: subscribe, removeEventListener: unsubscribe,
    animate() { created++; return { finished: new Promise<void>(() => {}), reverse() {}, playbackRate: 1, cancel() { cancelled++; } }; }
  } as unknown as HTMLElement;
  const window = { matchMedia: () => media, addEventListener: subscribe, removeEventListener: unsubscribe,
    setTimeout(fn: () => void) { const id = ++next; timers.set(id, fn); return id; }, clearTimeout(id: number) { timers.delete(id); }
  };
  return { panel, window, events, timers, created: () => created, cancelled: () => cancelled, finish: () => { for (const fn of [...timers.values()]) fn(); } };
}
test('an early close is idempotent and releases timers and listeners on destruction', () => {
  withMotionEnvironment(false, env => {
    const motion = createPanelMotion(env.panel, env.panel, null);
    assert.equal(env.panel.dataset.panelPhase, 'opening');
    let dismissed = 0;
    motion.dismiss(() => dismissed++); motion.dismiss(() => dismissed++);
    assert.equal(env.panel.dataset.panelPhase, 'closing'); env.finish();
    assert.equal(dismissed, 1); assert.equal(env.timers.size, 0);
    motion.destroy(); assert.equal(env.events.size, 0); assert.equal(env.panel.dataset.panelPhase, undefined);
    assert.equal(env.cancelled(), env.created());
  });
});
test('switching a visible vehicle panel to editing can skip entry while retaining animated exit', () => {
  withMotionEnvironment(false, env => {
    const motion = createPanelMotion(env.panel, env.panel, null, false);
    assert.equal(env.panel.dataset.panelPhase, 'open'); assert.equal(env.created(), 0);
    let dismissed = false; motion.dismiss(() => { dismissed = true; });
    assert.equal(env.created(), 1); assert.equal(dismissed, false); env.finish();
    assert.equal(dismissed, true); motion.destroy();
  });
});
test('reduced motion closes synchronously without creating effects or leaving a timer', () => {
  withMotionEnvironment(true, env => {
    const motion = createPanelMotion(env.panel, env.panel, null);
    let dismissed = false; motion.dismiss(() => { dismissed = true; });
    assert.equal(dismissed, true); assert.equal(env.created(), 0); assert.equal(env.timers.size, 0);
    motion.destroy(); assert.equal(env.events.size, 0);
  });
});
