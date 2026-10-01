import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useReducedMotion } from "@restaurant/ui";

/**
 * A scroll-scrubbed scene: a tall section whose inner frame stays pinned to the viewport while
 * the visitor scrolls through it, handing the scene a 0→1 progress value. Native scroll + sticky
 * positioning — no scroll hijacking, no scroll library, the browser's own scrollbar and keyboard
 * scrolling keep working exactly as normal.
 *
 * Under prefers-reduced-motion there is no pin and no scrubbing: the scene renders once, at its
 * final composition (progress = 1), as an ordinary full-height section — the brief's "elegant
 * static" version rather than a broken half-animated one.
 *
 * Progress lives in React state, updated at most once per animation frame. Scenes keep their
 * heavy children (product UI) in useMemo so a frame only re-renders the transforms around them.
 */
export function Pinned({
  length,
  background,
  className = "",
  label,
  children,
}: {
  /** Total scroll length in viewport heights (e.g. 2.6 → 260vh). */
  length: number;
  background?: string;
  className?: string;
  /** Accessible name for the scene's region. */
  label: string;
  children: (p: number) => ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const [p, setP] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const next = travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 1;
      setP((prev) => (Math.abs(prev - next) < 0.0005 ? prev : next));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
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

  const sectionStyle: CSSProperties = {
    background,
    height: reducedMotion ? undefined : `${length * 100}vh`,
  };

  return (
    <section ref={ref} aria-label={label} className={`relative ${className}`} style={sectionStyle}>
      <div
        className={
          reducedMotion
            ? "relative min-h-[100svh] overflow-hidden"
            : "sticky top-0 h-[100svh] overflow-hidden"
        }
      >
        {children(reducedMotion ? 1 : p)}
      </div>
    </section>
  );
}
