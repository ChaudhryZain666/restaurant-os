import type { CSSProperties, ReactNode } from "react";
import { COVER } from "./media";

/**
 * Product UI as physical objects. A `Surface` is a pane of the product — labelled like a piece of
 * equipment ("ORDERS · LIVE"), not dressed in fake browser chrome — so the dashboard, the queue
 * and the storefront read as parts of one operating system laid out in space.
 *
 * Content is the real demo restaurant: Wildwood Kitchen's actual menu items, prices and photos
 * (the same assets the live storefront serves), the same order number (#1047) and customer
 * (Jordan Lee) used across the rest of the site.
 */
export function Surface({
  label,
  status = "Live",
  children,
  className = "",
  style,
}: {
  label: string;
  status?: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[14px] border border-white/[0.09] bg-[#1d1719] shadow-[0_60px_120px_-40px_rgba(0,0,0,0.85)] ${className}`}
      style={style}
    >
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em]">
        <span className="text-white/55">{label}</span>
        <span className="flex items-center gap-1.5 text-[#c9838d]">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#c9838d]" />
          {status}
        </span>
      </div>
      {children}
    </div>
  );
}

const DEMO_DISHES = [
  { name: "Margherita Pizza", price: "$12.50", img: "/v3/margherita-pizza-thumb.webp" },
  { name: "Braised Short Rib", price: "$21.00", img: "/v3/braised-short-rib-thumb.webp" },
  {
    name: "Wild Mushroom & Taleggio Pizza",
    price: "$16.00",
    img: "/v3/wild-mushroom-taleggio-pizza-thumb.webp",
  },
  { name: "Grilled Salmon", price: "$18.50", img: "/v3/grilled-salmon-thumb.webp" },
];

/** The customer's side: Wildwood Kitchen's own ordering page. */
export function StorefrontPane() {
  return (
    <div>
      <div className="relative h-28 overflow-hidden">
        <img src={COVER.small} alt="" className="h-full w-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1d1719] via-[#1d1719]/40 to-transparent" />
        <div className="absolute bottom-3 left-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#9fd9a8]">
            ● Open for orders
          </p>
          <p className="font-heading text-xl text-[#f6f0e2]">Wildwood Kitchen</p>
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-3">
        {DEMO_DISHES.slice(0, 3).map((d) => (
          <li key={d.name} className="flex items-center gap-3 rounded-lg bg-white/[0.03] p-2">
            <img src={d.img} alt="" className="h-10 w-10 rounded-md object-cover" loading="lazy" />
            <span className="flex-1 truncate text-[13px] text-white/85">{d.name}</span>
            <span className="text-[12px] text-white/55">{d.price}</span>
            <span
              aria-hidden
              className="flex h-6 w-6 items-center justify-center rounded-full bg-[#c9838d] text-sm text-[#1d1719]"
            >
              +
            </span>
          </li>
        ))}
      </ul>
      <div className="mx-3 mb-3 flex items-center justify-between rounded-lg bg-[#c9838d] px-3 py-2 text-[12px] font-semibold text-[#2b1418]">
        <span>2 items · $25.00</span>
        <span>Checkout →</span>
      </div>
    </div>
  );
}

/** The menu, live: availability changes reach the storefront without a republish. */
export function MenuPane() {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-3">
      {DEMO_DISHES.map((d, i) => {
        const out = i === DEMO_DISHES.length - 1;
        return (
          <li key={d.name} className="flex items-center gap-3 rounded-lg bg-white/[0.03] p-2">
            <img
              src={d.img}
              alt=""
              className="h-10 w-10 rounded-md object-cover"
              style={{ filter: out ? "grayscale(1) brightness(0.6)" : undefined }}
              loading="lazy"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-white/85">{d.name}</span>
              <span className="block text-[11px] text-white/55">{d.price}</span>
            </span>
            <span
              className="font-mono text-[9px] uppercase tracking-[0.16em]"
              style={{ color: out ? "#e7b36a" : "#9fd9a8" }}
            >
              {out ? "86'd today" : "Available"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The kitchen's side: the live queue. */
export function OrdersPane() {
  const rows = [
    { n: "#1047", d: "Margherita ×2 · Pickup", s: "New", c: "#e3aab2" },
    { n: "#1046", d: "Short Rib · Delivery", s: "Preparing", c: "#8fb2f0" },
    { n: "#1045", d: "Salmon · Table 4", s: "Ready", c: "#9fd9a8" },
  ];
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-3">
      {rows.map((r) => (
        <li
          key={r.n}
          className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2.5"
        >
          <span>
            <span className="block font-mono text-[12px] text-white/85">{r.n}</span>
            <span className="block text-[11px] text-white/55">{r.d}</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: r.c }}>
            {r.s}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The owner's side: the week, at a glance. Same demo numbers as the rest of the site. */
export function AnalyticsPane() {
  const pts = [22, 30, 26, 41, 38, 52, 61];
  const max = 64;
  const d = pts
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i / (pts.length - 1)) * 100},${100 - (v / max) * 100}`)
    .join(" ");
  return (
    <div className="p-4">
      <div className="grid grid-cols-3 gap-2">
        {[
          ["This week", "$8,420"],
          ["Orders", "312"],
          ["Returning", "38%"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-white/[0.03] p-2.5">
            <p className="text-[10px] text-white/55">{k}</p>
            <p className="font-heading text-lg text-[#f6f0e2]">{v}</p>
          </div>
        ))}
      </div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="mt-3 h-16 w-full"
        aria-hidden
      >
        <path d={`${d} L100,100 L0,100 Z`} fill="rgba(201,131,141,0.14)" />
        <path
          d={d}
          fill="none"
          stroke="#c9838d"
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

/** The counter's side: a POS sale settling. */
export function PosPane() {
  return (
    <div className="p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] text-white/50">Table 4 · Riley</span>
        <span className="font-heading text-2xl text-[#f6f0e2]">$18.50</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {["Card", "Cash", "Split"].map((m, i) => (
          <span
            key={m}
            className="rounded-md py-2 text-center text-[11px]"
            style={{
              background: i === 0 ? "#c9838d" : "rgba(255,255,255,0.04)",
              color: i === 0 ? "#2b1418" : "rgba(255,255,255,0.6)",
            }}
          >
            {m}
          </span>
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#9fd9a8]">
        ✓ Paid · recorded to the order
      </p>
    </div>
  );
}

/** The relationship: a regular's loyalty balance. */
export function LoyaltyPane() {
  return (
    <div className="p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#611b28] font-heading text-sm text-[#f6f0e2]">
          J
        </span>
        <span>
          <span className="block text-[13px] text-white/85">Jordan Lee</span>
          <span className="block text-[11px] text-white/55">12 orders · regular</span>
        </span>
      </div>
      <p className="mt-3 font-heading text-3xl text-[#f6f0e2]">2,140 pts</p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#9fd9a8]">
        +25 on order #1047
      </p>
    </div>
  );
}

/** A paper kitchen ticket — the one physical object that travels the whole page. */
export function Ticket({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden
      className={`w-[150px] rounded-[3px] px-3.5 py-3 text-[#2a2013] shadow-[0_24px_40px_-14px_rgba(0,0,0,0.7)] ${className}`}
      style={{
        background: "linear-gradient(160deg,#f7f0e0,#ebe0c6)",
        borderTop: "3px solid #b8763f",
        ...style,
      }}
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#8a7550]">Order #1047</p>
      <p className="mt-1 text-[12px] font-semibold">Margherita Pizza ×2</p>
      <p className="mt-1 flex justify-between font-mono text-[10px] text-[#8a7550]">
        <span>Jordan Lee</span>
        <span>$25.00</span>
      </p>
    </div>
  );
}
