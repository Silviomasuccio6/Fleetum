import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export const getDialogFocusTarget = <T>(
  focusable: readonly T[],
  activeElement: T | null,
  shiftKey: boolean
): T | null => {
  if (focusable.length === 0) return null;
  const activeIndex = activeElement === null ? -1 : focusable.indexOf(activeElement);
  if (activeIndex === -1) return shiftKey ? focusable.at(-1)! : focusable[0];
  if (shiftKey && activeIndex === 0) return focusable.at(-1)!;
  if (!shiftKey && activeIndex === focusable.length - 1) return focusable[0];
  return null;
};

export const shouldCloseDialogOnKey = (key: string, saving: boolean) => key === "Escape" && !saving;

export const getCrudFieldId = (formId: string, index: number) => `${formId}-field-${index}`;

export const shouldRestoreDialogFocus = (wasOpen: boolean, open: boolean, saving: boolean) =>
  wasOpen && !open && !saving;

const getFocusableElements = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true"
  );

type UseAccessibleDialogInput = {
  open: boolean;
  saving: boolean;
  onClose: () => void;
  fallbackFocusRef?: RefObject<HTMLElement>;
};

export const useAccessibleDialog = ({ open, saving, onClose, fallbackFocusRef }: UseAccessibleDialogInput) => {
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    wasOpenRef.current = true;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      const initialFocus = dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]");
      const focusable = getFocusableElements(dialog);
      (initialFocus ?? focusable[0] ?? dialog).focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!shouldRestoreDialogFocus(wasOpenRef.current, open, saving)) return;
    wasOpenRef.current = false;
    const opener = openerRef.current;
    const target = opener?.isConnected ? opener : fallbackFocusRef?.current;
    if (!target?.isConnected) return;
    const focusFrame = window.requestAnimationFrame(() => {
      if (target.isConnected) target.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open, saving, fallbackFocusRef]);

  const rememberOpener = (element: HTMLElement) => {
    openerRef.current = element;
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (shouldCloseDialogOnKey(event.key, saving)) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;

    const focusable = getFocusableElements(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const target = getDialogFocusTarget(focusable, document.activeElement as HTMLElement | null, event.shiftKey);
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  return { dialogRef, rememberOpener, onKeyDown };
};
