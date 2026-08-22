import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion.js";

/**
 * Reveals an element once as it enters the viewport, via a single IntersectionObserver per
 * element that disconnects itself the moment it fires (never re-observes, never leaks). Under
 * reduced motion, skips the observer entirely and reports "visible" immediately — the caller's
 * CSS also neutralizes the transition itself (see .reveal in index.css), so this is a second,
 * independent guarantee rather than the only one.
 */
export function useScrollReveal<T extends HTMLElement>(options?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px", ...options }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  return { ref, visible };
}
