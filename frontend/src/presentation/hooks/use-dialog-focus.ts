import { useEffect, useRef, type RefObject } from "react";

/** Keep keyboard focus in the foremost dialog and restore its opener on close. */
export const useDialogFocus = (open: boolean, ref: RefObject<HTMLElement | null>, onEscape?: () => void) => {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement;
    const previousLabel = previous?.getAttribute("aria-label");
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
    )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
    const frame = window.requestAnimationFrame(() => (focusable()[0] ?? dialog).focus());
    const onKeyDown = (event: KeyboardEvent) => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'));
      if (dialogs.at(-1) !== dialog) return;
      if (event.key === "Escape" && escapeRef.current) {
        event.preventDefault();
        escapeRef.current();
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      if (previous instanceof HTMLElement && previous.isConnected && previous.getClientRects().length > 0) {
        previous.focus();
      } else if (previousLabel) {
        // Responsive lists can replace a hidden row trigger with its visible card equivalent.
        const replacement = Array.from(document.querySelectorAll<HTMLElement>("[aria-label]"))
          .find((element) => element.getAttribute("aria-label") === previousLabel && element.getClientRects().length > 0);
        replacement?.focus();
      }
    };
  }, [open, ref]);
};
