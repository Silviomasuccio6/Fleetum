import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type RefObject } from 'react';
import { createPanelMotion, type PanelMotionHandle } from '../components/ui/panel-motion';

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function usePanelMotion(panel: RefObject<HTMLElement>, frame: RefObject<HTMLElement>, origin: HTMLElement | null, enabled: boolean, identity: string, handle?: RefObject<PanelMotionHandle | null>, animateOpen = true) {
  const controller = useRef<ReturnType<typeof createPanelMotion> | null>(null);
  useImperativeHandle(handle, () => ({ dismiss(done) { if (controller.current) controller.current.dismiss(done); else done(); } }), []);
  useClientLayoutEffect(() => {
    if (!enabled || !panel.current || !frame.current) return;
    const motion = createPanelMotion(panel.current, frame.current, origin, animateOpen); controller.current = motion;
    return () => { motion.destroy(); if (controller.current === motion) controller.current = null; };
  }, [panel, frame, origin, enabled, identity, animateOpen]);
}
