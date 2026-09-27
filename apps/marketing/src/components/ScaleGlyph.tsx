/**
 * A visual-scale motif for WhoIsItFor: one glowing node → a small cluster → a dense constellation,
 * echoing the brief's "one restaurant → multiple restaurants → agency constellation" direction and
 * foreshadowing the agency/multi-location content later on the page. Positions are fixed per tier
 * (not randomized) so the shape reads the same on every load.
 */
const TIERS: Record<"one" | "few" | "many", { cx: number; cy: number; r: number }[]> = {
  one: [{ cx: 40, cy: 30, r: 5 }],
  few: [
    { cx: 40, cy: 22, r: 5 },
    { cx: 20, cy: 38, r: 3.5 },
    { cx: 60, cy: 38, r: 3.5 },
    { cx: 40, cy: 44, r: 3 },
  ],
  many: [
    { cx: 40, cy: 20, r: 5 },
    { cx: 16, cy: 30, r: 3 },
    { cx: 64, cy: 28, r: 3 },
    { cx: 26, cy: 44, r: 2.5 },
    { cx: 54, cy: 46, r: 2.5 },
    { cx: 40, cy: 40, r: 2.5 },
    { cx: 12, cy: 48, r: 2 },
    { cx: 70, cy: 46, r: 2 },
    { cx: 46, cy: 54, r: 2 },
  ],
};

export function ScaleGlyph({ tier }: { tier: "one" | "few" | "many" }) {
  const nodes = TIERS[tier];
  const [hub, ...rest] = nodes;
  return (
    <svg viewBox="0 0 80 60" className="h-14 w-20" aria-hidden>
      {rest.map((n, i) => (
        <line
          key={i}
          x1={hub.cx}
          y1={hub.cy}
          x2={n.cx}
          y2={n.cy}
          stroke="var(--gt-brand-fixed)"
          strokeWidth={0.6}
          opacity={0.35}
        />
      ))}
      {nodes.map((n, i) => (
        <circle key={i} cx={n.cx} cy={n.cy} r={n.r} fill="var(--gt-brand-fixed)" opacity={i === 0 ? 0.9 : 0.5} />
      ))}
    </svg>
  );
}
