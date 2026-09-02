import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@restaurant/ui";

/**
 * Tracks how far a ref'd element has travelled through the viewport, as a 0–1 fraction, updated on
 * scroll via rAF-throttling (never more than once per frame). Mirrors useScrollReveal's
 * reduced-motion contract exactly: under reduced motion the listener is never attached and this
 * reports a fixed `1` (final state) immediately, so every consumer's "animate toward 1" logic
 * collapses to its resting position for free, no separate reduced-motion branch needed per caller.
 */
export function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [progress, setProgress] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      setProgress(1);
      return;
    }
    const el = ref.current;
    if (!el || typeof window === "undefined") {
      setProgress(1);
      return;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // 0 when the element's top just enters the viewport bottom, 1 when its bottom reaches the
      // viewport top — a plain "how far through the viewport has this travelled" fraction.
      const raw = (vh - rect.top) / (vh + rect.height);
      setProgress(Math.min(1, Math.max(0, raw)));
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reducedMotion]);

  return { ref, progress };
}
