import { useLayoutEffect, useRef, useState } from "react";
import { logoMarkAsset } from "@restaurant/ui";
import { Pinned } from "./Pinned";
import { ease, seg, useIsDesktop } from "./motion";

interface Station {
  id: string;
  name: string;
  caption: string;
}

const STATIONS: Station[] = [
  {
    id: "customer",
    name: "Customer",
    caption: "Jordan orders from your storefront — or a QR code at the table, or your counter.",
  },
  {
    id: "order",
    name: "Order",
    caption: "Checked out on your own Stripe account, with a promo code applied.",
  },
  {
    id: "core",
    name: "GarnishTable",
    caption: "One order record — sent everywhere it needs to be, at once.",
  },
  {
    id: "kitchen",
    name: "Kitchen",
    caption: "It lands in the live queue, with a timer from the moment it arrives.",
  },
  {
    id: "pos",
    name: "POS",
    caption: "Counter and table sales settle on the same system, attributed to staff.",
  },
  {
    id: "delivery",
    name: "Delivery",
    caption: "Your zones, your fees — or Uber Eats, connected from the dashboard.",
  },
  { id: "loyalty", name: "Loyalty", caption: "Points land on Jordan's account automatically." },
  {
    id: "analytics",
    name: "Analytics",
    caption: "Revenue, top sellers and returning customers update with every order.",
  },
];
const RETURN_CAPTION =
  "…and Jordan comes back. The loop closes at your restaurant, not someone else's.";

type Layout = { w: number; h: number; pos: Record<string, [number, number]>; path: string };

const DESKTOP: Layout = {
  w: 1000,
  h: 600,
  pos: {
    customer: [500, 60],
    order: [500, 165],
    core: [500, 290],
    kitchen: [170, 455],
    pos: [330, 520],
    delivery: [500, 545],
    loyalty: [670, 520],
    analytics: [830, 455],
  },
  path: "M500 60 L500 165 L500 290 C360 300 220 360 170 455 C220 500 270 515 330 520 C400 535 450 545 500 545 C550 545 600 535 670 520 C730 510 790 490 830 455 C940 360 930 180 820 110 C730 55 600 45 500 60",
};

const MOBILE: Layout = {
  w: 400,
  h: 760,
  pos: {
    customer: [200, 40],
    order: [200, 130],
    core: [200, 245],
    kitchen: [95, 375],
    pos: [300, 440],
    delivery: [95, 510],
    loyalty: [300, 580],
    analytics: [95, 655],
  },
  path: "M200 40 L200 130 L200 245 C150 300 100 330 95 375 C130 410 250 410 300 440 C260 480 140 480 95 510 C130 545 250 550 300 580 C260 620 140 620 95 655 C40 700 20 720 60 740 C380 760 395 300 370 150 C350 60 280 30 200 40",
};

/**
 * SCENE 4 — THE MOVEMENT. One real path through the operation, scrubbed by scroll: a paper ticket
 * (the same order #1047 from the opening) travels Customer → Order → GarnishTable → Kitchen → POS →
 * Delivery → Loyalty → Analytics → and back to the customer. Each station lights as the ticket
 * reaches it and the caption names what actually happens there — every caption is a shipped
 * capability. SVG + HTML, so every station name is real, readable text; the full sequence is also
 * an ordered list for screen readers.
 */
export function Movement() {
  const desktop = useIsDesktop();
  const L = desktop ? DESKTOP : MOBILE;
  const pathRef = useRef<SVGPathElement>(null);
  const [samples, setSamples] = useState<{ x: number; y: number }[]>([]);
  const [stops, setStops] = useState<number[]>([]);

  // Sample the path once per layout, and find where along it each station sits.
  useLayoutEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const total = path.getTotalLength();
    const N = 480;
    const pts = Array.from({ length: N + 1 }, (_, i) => {
      const pt = path.getPointAtLength((i / N) * total);
      return { x: pt.x, y: pt.y };
    });
    // Stations are visited in order, so each search starts where the previous station was found —
    // otherwise "Customer", which is both the start and the end of the loop, could match the end.
    let from = 0;
    const at = STATIONS.map((s) => {
      const [sx, sy] = L.pos[s.id];
      let best = from;
      let bestD = Infinity;
      for (let i = from; i <= N; i++) {
        const d = (pts[i].x - sx) ** 2 + (pts[i].y - sy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      from = best;
      return best / N;
    });
    setSamples(pts);
    setStops(at);
  }, [L]);

  return (
    <Pinned length={3.2} background="#0f0c0d" label="How an order moves through GarnishTable">
      {(p) => {
        const t = ease(seg(p, 0.08, 0.92));
        const idx = samples.length ? Math.round(t * (samples.length - 1)) : 0;
        const ticket = samples[idx] ?? { x: L.pos.customer[0], y: L.pos.customer[1] };
        let current = 0;
        stops.forEach((s, i) => {
          if (t >= s - 0.004) current = i;
        });
        const returned = t > 0.985;
        const caption = returned ? RETURN_CAPTION : STATIONS[current]?.caption;
        const heading = returned ? "Back to the customer" : STATIONS[current]?.name;

        return (
          <div className="relative flex h-full w-full flex-col px-5 pb-6 pt-24 sm:px-10 lg:flex-row lg:items-center lg:gap-10 lg:px-16 lg:pt-16">
            <div className="relative z-10 shrink-0 lg:w-[30%]">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#c9838d]">
                The movement
              </p>
              <h2 className="mt-3 font-heading text-[8vw] font-semibold leading-[1] tracking-tight text-[#f6f0e2] lg:text-[2.9vw]">
                Follow one order through the restaurant.
              </h2>
              <div
                className="mt-6 hidden min-h-[7.5rem] border-t border-white/10 pt-5 lg:block"
                aria-live="off"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/45">
                  {heading}
                </p>
                <p className="mt-2 font-heading text-2xl leading-snug text-[#f6f0e2]">{caption}</p>
              </div>
            </div>

            <div
              className="relative mx-auto mt-4 flex-1 lg:mt-0"
              style={{
                maxWidth: desktop
                  ? "min(100%, calc((100svh - 140px) * 1.667))"
                  : "min(100%, calc((100svh - 260px) * 0.526))",
                width: "100%",
              }}
            >
              <div className="relative w-full" style={{ aspectRatio: `${L.w} / ${L.h}` }}>
                <svg
                  viewBox={`0 0 ${L.w} ${L.h}`}
                  className="absolute inset-0 h-full w-full"
                  aria-hidden
                >
                  {["kitchen", "pos", "delivery", "loyalty", "analytics"].map((id) => (
                    <line
                      key={id}
                      x1={L.pos.core[0]}
                      y1={L.pos.core[1]}
                      x2={L.pos[id][0]}
                      y2={L.pos[id][1]}
                      stroke="rgba(245,239,230,0.07)"
                      strokeWidth="1"
                    />
                  ))}
                  <path
                    ref={pathRef}
                    d={L.path}
                    fill="none"
                    stroke="rgba(245,239,230,0.14)"
                    strokeWidth="1.5"
                    strokeDasharray="3 7"
                  />
                  <path
                    d={L.path}
                    fill="none"
                    stroke="url(#gt-move)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    pathLength={1}
                    strokeDasharray="1 1"
                    strokeDashoffset={1 - t}
                  />
                  <defs>
                    <linearGradient id="gt-move" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#611b28" />
                      <stop offset="100%" stopColor="#e3aab2" />
                    </linearGradient>
                  </defs>
                </svg>

                {/* the core */}
                <div
                  className="absolute flex items-center justify-center"
                  style={{
                    left: `${(L.pos.core[0] / L.w) * 100}%`,
                    top: `${(L.pos.core[1] / L.h) * 100}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <div
                    aria-hidden
                    className="gt-glow-pulse absolute h-40 w-40 rounded-full"
                    style={{
                      background: "radial-gradient(circle, rgba(97,27,40,0.7), transparent 70%)",
                      filter: "blur(8px)",
                    }}
                  />
                  <img
                    src={logoMarkAsset}
                    alt=""
                    className="relative h-12 w-12 object-contain lg:h-14 lg:w-14"
                    style={{ filter: "brightness(0) invert(1)" }}
                  />
                </div>

                <ol className="m-0 list-none p-0">
                  {STATIONS.map((s, i) => {
                    const [x, y] = L.pos[s.id];
                    const lit = stops.length > 0 && t >= stops[i] - 0.004;
                    const now = i === current && !returned;
                    if (s.id === "core") {
                      return (
                        <li key={s.id} className="sr-only">
                          {s.name}: {s.caption}
                        </li>
                      );
                    }
                    return (
                      <li
                        key={s.id}
                        className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                        style={{ left: `${(x / L.w) * 100}%`, top: `${(y / L.h) * 100}%` }}
                      >
                        <span
                          className="block h-3.5 w-3.5 rounded-full border transition-colors duration-300"
                          style={{
                            borderColor: lit ? "#e3aab2" : "rgba(245,239,230,0.3)",
                            background: lit ? "#611b28" : "#0f0c0d",
                            boxShadow: now ? "0 0 0 6px rgba(201,131,141,0.18)" : "none",
                          }}
                        />
                        <span
                          className="mt-2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.2em] transition-colors duration-300 lg:text-[11px]"
                          style={{
                            color: now
                              ? "#f6f0e2"
                              : lit
                                ? "rgba(245,239,230,0.7)"
                                : "rgba(245,239,230,0.35)",
                          }}
                        >
                          {s.name}
                        </span>
                        <span className="sr-only">: {s.caption}</span>
                      </li>
                    );
                  })}
                </ol>

                {/* the ticket */}
                <div
                  aria-hidden
                  className="absolute"
                  style={{
                    left: `${(ticket.x / L.w) * 100}%`,
                    top: `${(ticket.y / L.h) * 100}%`,
                    transform: "translate(-50%, -50%)",
                    opacity: p > 0.02 && !returned ? 1 : 0,
                    transition: "opacity 300ms ease",
                  }}
                >
                  <span
                    className="block h-6 w-5 rounded-[2px] shadow-[0_8px_18px_-4px_rgba(0,0,0,0.8)]"
                    style={{
                      background: "linear-gradient(160deg,#f7f0e0,#ebe0c6)",
                      borderTop: "3px solid #b8763f",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* mobile caption, under the diagram */}
            <div className="relative mt-2 min-h-[5.5rem] border-t border-white/10 pt-3 lg:hidden">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/45">
                {heading}
              </p>
              <p className="mt-1 text-[15px] leading-snug text-[#f6f0e2]">{caption}</p>
            </div>
          </div>
        );
      }}
    </Pinned>
  );
}
