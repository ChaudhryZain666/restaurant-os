import { Logo, useReducedMotion } from "@restaurant/ui";
import { useScrollProgress } from "../lib/useScrollProgress";
import { IconCart, IconClipboard, IconMenuBook, IconStar, IconStore, IconTruck } from "./icons";

/**
 * "Why we exist" — the problem, shown rather than stated. A restaurant's real tool sprawl
 * (a generic website, a marketplace listing, a delivery app, a loyalty punch card, a spreadsheet,
 * a POS that talks to none of it) starts scattered and drifts together into one point as the
 * section scrolls into view — the real Logo, not an invented mark. Scroll-linked via
 * useScrollProgress (the same continuous mechanism the Hero uses), collapsing to the fully-
 * converged end state immediately under reduced motion. Each fragment carries its own icon (not a
 * plain text pill) and gains a slight blur as it converges, so the motion reads as dissolving into
 * one point of light rather than six labels sliding to the middle.
 */

const SCATTERED = [
  { label: "Website", icon: IconMenuBook, x: -34, y: -26 },
  { label: "Marketplace listing", icon: IconStore, x: 30, y: -32 },
  { label: "Delivery app", icon: IconTruck, x: -40, y: 12 },
  { label: "Loyalty punch card", icon: IconStar, x: 36, y: 8 },
  { label: "Spreadsheet", icon: IconClipboard, x: -18, y: 34 },
  { label: "POS", icon: IconCart, x: 22, y: 30 },
];

export function WhyWeExist() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>();
  const reducedMotion = useReducedMotion();
  const p = reducedMotion ? 1 : Math.min(1, progress * 1.4);
  // Phase 80 — the chips converge toward the same center point as p -> 1, but their own opacity
  // used to only fade to 0.15 (never fully gone), so at any scroll position where a reader pauses
  // near full convergence, six half-visible labels overlap directly on the Logo — a genuinely
  // illegible jumble, not just a fleeting transitional frame (confirmed via a static screenshot
  // caught mid-scroll). Reaching true 0 well before the labels are close enough to overlap (by
  // p=0.55, while they're still ~45% of the way out from center) means there is no scroll position
  // where overlapping-but-still-visible text can occur at all — not a faster animation, a resting
  // state that's clean at every point along it.
  const chipOpacity = Math.max(0, 1 - p / 0.55);

  return (
    <div ref={ref}>
      <div className="mx-auto max-w-2xl text-center">
        <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/45">Why we exist</span>
        <h2 className="mt-3 font-heading text-3xl text-white sm:text-4xl">Restaurants didn't choose to be this fragmented.</h2>
        <p className="mt-4 text-white/60">
          A website here. A marketplace listing there. A delivery app, a loyalty card, a spreadsheet for the
          numbers, a POS that doesn't talk to any of it — and none of it is really <em className="not-italic text-white/85">yours</em>.
        </p>
      </div>

      {/* overflow-hidden: the scattered chips use whitespace-nowrap + percentage transforms that
          can extend past this container's edge on narrow viewports — clip here rather than let a
          child push the whole page wider (confirmed a real 390px horizontal-overflow bug, not a
          hypothetical one). Height is percentage/viewBox-driven, not tied to a specific pixel
          number — reduced from 380/420px, which left a large dead void once the chips finish
          converging and fading (confirmed via screenshot: the payoff sits alone in the lower half
          of an oversized box with nothing above or below it). */}
      <div className="relative mx-auto mt-16 h-[260px] max-w-2xl overflow-hidden sm:h-[300px]">
        {/* atmosphere that deepens as the fragments collapse — reinforces "everything pulled into
            one point of light" rather than a flat, static background the whole time. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: "radial-gradient(circle, rgba(97,27,40,0.22) 0%, transparent 65%)",
            opacity: 0.3 + p * 0.7,
            transition: reducedMotion ? "none" : "opacity 200ms linear",
          }}
        />

        <svg viewBox="-100 -80 200 160" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {/* a closing iris ring — shrinks toward the center as the fragments converge, rather than
              only the lines/chips doing the work of showing collapse. */}
          <circle
            cx="0"
            cy="0"
            r={60 * (1 - p) + 4}
            fill="none"
            stroke="#c9838d"
            strokeWidth="0.3"
            opacity={0.3 * (1 - p * 0.7)}
            style={{ transition: reducedMotion ? "none" : "r 150ms linear, opacity 150ms linear" }}
          />
          {SCATTERED.map((item) => {
            const cx = item.x * (1 - p);
            const cy = item.y * (1 - p);
            return (
              <line
                key={item.label}
                x1={cx}
                y1={cy}
                x2="0"
                y2="0"
                stroke="#c9838d"
                strokeWidth="0.4"
                opacity={p * 0.4}
                style={{ transition: reducedMotion ? "none" : "opacity 200ms linear" }}
              />
            );
          })}
        </svg>

        {SCATTERED.map((item) => {
          const x = item.x * (1 - p);
          const y = item.y * (1 - p);
          const scale = 1 - p * 0.5;
          return (
            <div
              key={item.label}
              className="absolute left-1/2 top-1/2 flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-white/55 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)] backdrop-blur-sm"
              style={{
                transform: `translate(-50%,-50%) translate(${x}%,${y}%) scale(${scale})`,
                opacity: chipOpacity,
                filter: reducedMotion ? "none" : `blur(${p * 3}px)`,
                transition: reducedMotion ? "none" : "transform 150ms linear, opacity 150ms linear, filter 150ms linear",
              }}
            >
              <item.icon className="h-3 w-3 flex-shrink-0 text-[#c9838d]" />
              {item.label}
            </div>
          );
        })}

        <div
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4"
          style={{ opacity: p, transform: `translate(-50%,-50%) scale(${0.85 + p * 0.15})`, transition: reducedMotion ? "none" : "opacity 200ms linear, transform 200ms linear" }}
        >
          {/* the same oxblood glow the Hero's mark uses — the payoff of "everything converges into
              one system" reads as a real arrival moment, not a small logo lost in a large box. */}
          <div className="relative flex items-center justify-center">
            <div
              aria-hidden
              className="absolute rounded-full"
              style={{
                inset: -28,
                background: "radial-gradient(circle, var(--gt-glow) 0%, rgba(97,27,40,0.3) 45%, transparent 75%)",
                filter: "blur(12px)",
                opacity: 0.7 * p,
              }}
            />
            <Logo size="lg" />
          </div>
          <p className="max-w-xs text-center text-sm text-white/60">
            Ordering, menu, customers, delivery, loyalty and analytics — one system, owned by the restaurant.
          </p>
        </div>
      </div>
    </div>
  );
}
