import { useLayoutEffect, useRef, useState } from "react";

/** A local popover: below its trigger unless only the space above is usable. */
export function useAnchoredMenu(open: boolean, close: () => void) {
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const [position, setPosition] = useState({ above: false, maxHeight: 320 });
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const measure = () => {
      const rect = root.current!.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const flip = below < 160 && above > below;
      setPosition({ above: flip, maxHeight: Math.max(40, Math.min(320, flip ? above : below)) });
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) closeRef.current();
    };
    measure();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);
  return { root, position };
}
