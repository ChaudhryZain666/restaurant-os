import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A single, reusable focus-trap primitive shared by every modal/drawer in the Menu Builder (the
 * item editor and the live-preview overlay) instead of each hand-rolling its own Tab-cycling logic.
 * While `active`, Tab/Shift+Tab are constrained to focusable elements inside `containerRef`, an
 * initial element is focused on activation, and focus returns to whatever was focused right before
 * activation once `active` goes false again — so keyboard use never leaks into the page behind an
 * open dialog, and never gets stranded once it closes.
 */
export function useFocusTrap<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  active: boolean,
  options?: { initialFocusRef?: RefObject<HTMLElement | null> }
) {
  useEffect(() => {
    if (!active) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = containerRef.current;

    function getFocusable(): HTMLElement[] {
      if (!container) return [];
      return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    }

    (options?.initialFocusRef?.current ?? getFocusable()[0])?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeInside = container?.contains(document.activeElement) ?? false;
      if (e.shiftKey) {
        if (!activeInside || document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (!activeInside || document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
