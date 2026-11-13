import { ReactNode, useEffect, useRef } from "react";

type Props = { children: ReactNode; label: string; onDismiss: () => void; inspector?: boolean };

/** Kept inside the authenticated shell so dialogs inherit only Platform tokens. */
export const PlatformDialog = ({ children, label, onDismiss, inspector = false }: Props) => {
  const ref = useRef<HTMLDialogElement>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const dialog = ref.current!;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const open = () => {
      dialog.close();
      if (inspector && desktop.matches) dialog.show();
      else dialog.showModal();
    };
    open();
    if (inspector) desktop.addEventListener("change", open);
    const onEscape = (event: KeyboardEvent) => {
      // Native modal dialogs deliver cancel; nonmodal desktop inspectors do not.
      if (inspector && desktop.matches && event.key === "Escape" && !document.querySelector("dialog:modal")) {
        dismissRef.current();
      }
    };
    document.addEventListener("keydown", onEscape);
    return () => {
      desktop.removeEventListener("change", open);
      document.removeEventListener("keydown", onEscape);
      const shouldRestore = dialog.contains(document.activeElement) || document.activeElement === document.body;
      dialog.close();
      if (shouldRestore && origin?.isConnected) origin.focus();
    };
  }, [inspector]);

  return (
    <dialog ref={ref} className={inspector ? "satin-dialog satin-inspector" : "satin-dialog satin-confirm"}
      aria-label={label} onCancel={(event) => { event.preventDefault(); onDismiss(); }}>
      {children}
    </dialog>
  );
};
