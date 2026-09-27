import { useReducedMotion } from "@restaurant/ui";
import { useScrollProgress } from "../lib/useScrollProgress";

interface ScrollParallaxGridProps {
  /** Total pixels the grid drifts across the section's full scroll-through — kept small (a
   *  fraction of one 88px grid cell) so it reads as depth, not a distraction from the real content
   *  sitting on top of it. */
  travel?: number;
}

/**
 * The same blueprint-grid texture the Hero/Final CTA already use (including `bg-grid-drift`'s own
 * ambient, time-based 40s animation, which stays active underneath), plus a genuine scroll-linked
 * parallax shift on top — the background moves at a different rate than the foreground content as
 * the section scrolls through, the same depth cue `CameraRig` gives the Hero's 3D scene, without
 * any WebGL (`useScrollProgress` is the same continuous, non-WebGL mechanism `WhyWeExist`/
 * `WhatWeReplace`/`JourneyRoute` already use). Deliberately its own small component with its own
 * `useScrollProgress` call, not a prop threaded through the parent — a busy section (e.g.
 * OperationsBoard's 12 tiles) must never re-render on every scroll frame merely because this one
 * background layer is moving.
 */
export function ScrollParallaxGrid({ travel = 40 }: ScrollParallaxGridProps) {
  const { ref, progress } = useScrollProgress<HTMLDivElement>();
  const reducedMotion = useReducedMotion();
  const shift = reducedMotion ? 0 : (progress - 0.5) * travel;

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="bg-grid-drift absolute inset-x-0 opacity-[0.06]"
        style={{
          top: "-10%",
          height: "120%",
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)",
          backgroundSize: "88px 88px",
          transform: `translateY(${shift}px)`,
          transition: reducedMotion ? "none" : "transform 60ms linear",
        }}
      />
    </div>
  );
}
