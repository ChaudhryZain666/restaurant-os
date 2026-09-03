import { Logo, useReducedMotion } from "@restaurant/ui";
import { useScrollProgress } from "../lib/useScrollProgress";

/**
 * "Why we exist" — the problem, shown rather than stated. A restaurant's real tool sprawl
 * (a generic website, a marketplace listing, a delivery app, a loyalty punch card, a spreadsheet,
 * a POS that talks to none of it) starts scattered and drifts together into one point as the
 * section scrolls into view — the real Logo, not an invented mark. Scroll-linked via
 * useScrollProgress (the same continuous mechanism the Hero uses), collapsing to the fully-
 * converged end state immediately under reduced motion.
 */

const SCATTERED = [
  { label: "Website", x: -34, y: -26 },
  { label: "Marketplace listing", x: 30, y: -32 },
  { label: "Delivery app", x: -40, y: 12 },
  { label: "Loyalty punch card", x: 36, y: 8 },
  { label: "Spreadsheet", x: -18, y: 34 },
  { label: "POS", x: 22, y: 30 },
];

export function WhyWeExist() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>();
  const reducedMotion = useReducedMotion();
  const p = reducedMotion ? 1 : Math.min(1, progress * 1.4);

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
          hypothetical one). */}
      <div className="relative mx-auto mt-16 h-[380px] max-w-2xl overflow-hidden sm:h-[420px]">
        <svg viewBox="-100 -80 200 160" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
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
                stroke="#e08a3e"
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
              className="absolute left-1/2 top-1/2 whitespace-nowrap rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-white/55 backdrop-blur-sm"
              style={{
                transform: `translate(-50%,-50%) translate(${x}%,${y}%) scale(${scale})`,
                opacity: 1 - p * 0.85,
                transition: reducedMotion ? "none" : "transform 150ms linear, opacity 150ms linear",
              }}
            >
              {item.label}
            </div>
          );
        })}

        <div
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3"
          style={{ opacity: p, transform: `translate(-50%,-50%) scale(${0.85 + p * 0.15})`, transition: reducedMotion ? "none" : "opacity 200ms linear, transform 200ms linear" }}
        >
          <Logo />
          <p className="max-w-xs text-center text-sm text-white/60">
            Ordering, menu, customers, delivery, loyalty and analytics — one system, owned by the restaurant.
          </p>
        </div>
      </div>
    </div>
  );
}
