import { useEffect, useRef, useState } from "react";
import { useReducedMotion, useScrollReveal } from "@restaurant/ui";

/**
 * Counts up from 0 to `value` once scrolled into view (via the same useScrollReveal every other
 * reveal in this app uses — one shared "has this entered the viewport" mechanism, not a bespoke
 * one here). Renders the final value immediately under reduced motion, matching every other
 * motion primitive in this codebase's contract.
 */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  durationMs = 900,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const { ref, visible } = useScrollReveal<HTMLSpanElement>();
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(reducedMotion ? value : 0);
  const started = useRef(false);

  useEffect(() => {
    if (!visible || started.current) return;
    started.current = true;
    if (reducedMotion) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <span ref={ref} className={className}>
      {format(display)}
    </span>
  );
}
