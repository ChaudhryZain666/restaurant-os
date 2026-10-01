import { Reveal } from "@restaurant/ui";
import { AnimatedNumber } from "../AnimatedNumber";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Daily revenue for the demo week — sums to the same $8,420 used everywhere else on the site.
const DAILY = [820, 960, 900, 1180, 1340, 1720, 1500];

const NUMBERS = [
  {
    value: 8420,
    format: (n: number) => `$${Math.round(n).toLocaleString()}`,
    label: "Direct revenue this week",
    note: "0% of it to a marketplace",
  },
  { value: 312, label: "Orders", note: "Online, at the table and at the counter" },
  {
    value: 38,
    format: (n: number) => `${Math.round(n)}%`,
    label: "From returning customers",
    note: "People you can now name",
  },
  { value: 2140, label: "Points on Jordan's account", note: "A reason to order direct, again" },
];

const LEVERS = [
  { title: "Loyalty", copy: "Points accrue on every order automatically and redeem at checkout." },
  { title: "Promotions", copy: "Percentage or fixed-amount codes — WELCOME10 for a first order." },
  {
    title: "Customer accounts",
    copy: "Every customer's order history, so you actually know your regulars.",
  },
];

function RevenueChart() {
  const W = 1000;
  const H = 220;
  const max = 1900;
  const pts = DAILY.map((v, i) => [
    40 + (i / (DAILY.length - 1)) * (W - 80),
    H - 30 - (v / max) * (H - 60),
  ]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 2];
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Daily direct revenue for the demo week, peaking on Saturday at $1,720"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="40"
            x2={W - 40}
            y1={30 + f * (H - 60)}
            y2={30 + f * (H - 60)}
            stroke="#2b2116"
            strokeOpacity="0.07"
          />
        ))}
        <path d={`${d} L${W - 40},${H - 30} L40,${H - 30} Z`} fill="rgba(97,27,40,0.08)" />
        <path d={d} fill="none" stroke="#611b28" strokeWidth="2.5" strokeLinejoin="round" />
        {pts.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={i === 5 ? 6 : 3}
            fill={i === 5 ? "#611b28" : "#eee7d7"}
            stroke="#611b28"
            strokeWidth="2"
          />
        ))}
        <text
          x={lx}
          y={ly - 16}
          textAnchor="middle"
          fontFamily="var(--font-heading)"
          fontSize="22"
          fill="#611b28"
        >
          $1,720
        </text>
        {DAYS.map((day, i) => (
          <text
            key={day}
            x={pts[i][0]}
            y={H - 6}
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize="13"
            letterSpacing="2"
            fill="#6b5d48"
          >
            {day.toUpperCase()}
          </text>
        ))}
      </svg>
      <figcaption className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#6b5d48]">
        Direct revenue by day · busiest: Saturday
      </figcaption>
    </figure>
  );
}

/**
 * SCENES 6–7 — THE CUSTOMER and THE BUSINESS, as an editorial spread rather than a feature grid:
 * a tall photograph of the week's top seller beside oversized numbers, then a quiet revenue chart
 * drawn to scale. Everything is labelled as the demo restaurant's week — illustrative, never
 * presented as a real customer's results. A deliberate stillness after four pinned scenes: this
 * section simply scrolls.
 */
export function Business() {
  return (
    <section
      aria-labelledby="business-title"
      className="relative px-5 py-28 sm:px-10 sm:py-36 lg:px-16"
      style={{ background: "#eee7d7" }}
    >
      <div className="mx-auto max-w-7xl">
        <Reveal className="max-w-4xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#611b28]">
            The customer · The business
          </p>
          <h2
            id="business-title"
            className="mt-4 font-heading text-[11vw] font-semibold leading-[0.95] tracking-tight text-[#2b2116] lg:text-[6vw]"
          >
            Every order <em>teaches you</em> something.
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <Reveal variant="mask" className="relative">
            <figure className="m-0">
              <div className="aspect-[4/5] overflow-hidden rounded-sm">
                <img
                  src="/v3/margherita-pizza.jpg"
                  alt="Margherita pizza at Wildwood Kitchen"
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <figcaption className="mt-3 flex items-baseline justify-between border-t border-[#2b2116]/15 pt-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#6b5d48]">
                  Top seller this week
                </span>
                <span className="font-heading text-lg text-[#2b2116]">
                  Margherita Pizza · 38 sold
                </span>
              </figcaption>
            </figure>
          </Reveal>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#6b5d48]">
              A week at Wildwood Kitchen — GarnishTable's demo restaurant
            </p>
            <dl className="m-0 mt-6 grid gap-x-10 sm:grid-cols-2">
              {NUMBERS.map((n, i) => (
                <Reveal key={n.label} index={i} className="border-t border-[#2b2116]/15 py-7">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#6b5d48]">
                    {n.label}
                  </dt>
                  <dd className="m-0">
                    <span className="block font-heading text-[16vw] font-semibold leading-none tracking-tight text-[#2b2116] sm:text-[8vw] lg:text-[5.2vw]">
                      <AnimatedNumber value={n.value} format={n.format} durationMs={1400} />
                    </span>
                    <span className="mt-2 block text-[15px] text-[#6b5d48]">{n.note}</span>
                  </dd>
                </Reveal>
              ))}
            </dl>
          </div>
        </div>

        <Reveal className="mt-20">
          <RevenueChart />
        </Reveal>

        <div className="mt-20 grid gap-8 border-t border-[#2b2116]/15 pt-10 sm:grid-cols-3">
          {LEVERS.map((l, i) => (
            <Reveal key={l.title} index={i}>
              <h3 className="font-heading text-2xl text-[#2b2116]">{l.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#6b5d48]">{l.copy}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
