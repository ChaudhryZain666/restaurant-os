import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useReducedMotion } from "@restaurant/ui";
import { GlowMark } from "../GlowMark";

/**
 * The hero's system visual: one real order travelling the loop a restaurant actually runs —
 * Customer → Order → Kitchen → POS → Delivery — around the restaurant at the center. Not a
 * decorative "network": every station is a stage GarnishTable genuinely runs, and the detail on
 * each card follows the same demo order (#1047, Jordan Lee) used across the rest of the site.
 *
 * Built in HTML + SVG, not WebGL: the labels are real text (crawlable, readable by a screen reader
 * as an ordered list), it costs nothing to load, and it can't fail. A single ticket marker steps
 * around the ring; under reduced motion it stays put and no station is singled out.
 *
 * Each card is anchored to the OUTSIDE of its node (above the top one, beside the side ones, below
 * the bottom pair) rather than all sitting on one larger radius — on a single radius the side
 * cards' width put them on top of their own nodes and under the travelling ticket.
 */

type Anchor = "above" | "right" | "below-right" | "below-left" | "left";

const STATIONS: { name: string; detail: string; anchor: Anchor }[] = [
  { name: "Customer", detail: "Jordan Lee · new order", anchor: "above" },
  { name: "Order", detail: "#1047 · 2 items", anchor: "right" },
  { name: "Kitchen", detail: "Preparing · 8 min", anchor: "below-right" },
  { name: "POS", detail: "Paid · $25.00", anchor: "below-left" },
  { name: "Delivery", detail: "On the way · 18 min", anchor: "left" },
];

const SIZE = 560;
const C = SIZE / 2;
const RING_R = 116;
const GAP = 18;
const STEP_MS = 2200;

function node(i: number) {
  const a = ((-90 + i * 72) * Math.PI) / 180;
  return { x: C + RING_R * Math.cos(a), y: C + RING_R * Math.sin(a) };
}

function cardStyle(anchor: Anchor, x: number, y: number): CSSProperties {
  switch (anchor) {
    case "above":
      return { left: x, top: y - GAP, transform: "translate(-50%, -100%)" };
    case "right":
      return { left: x + GAP, top: y, transform: "translate(0, -50%)" };
    case "below-right":
      return { left: x - 24, top: y + GAP };
    case "below-left":
      return { left: x + 24, top: y + GAP, transform: "translate(-100%, 0)" };
    case "left":
      return { left: x - GAP, top: y, transform: "translate(-100%, -50%)" };
  }
}

export function SystemRing() {
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const id = window.setInterval(() => setStep((s) => s + 1), STEP_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion]);

  const active = reducedMotion ? -1 : step % STATIONS.length;

  return (
    // The outer box is the real layout size per breakpoint; the ring is scaled inside it, so a
    // scaled-down ring never leaves an invisible full-size layout box overflowing its column.
    <div className="relative mx-auto h-[460px] w-[460px] xl:h-[515px] xl:w-[515px]">
      <div
        className="absolute left-1/2 top-1/2 origin-center -translate-x-1/2 -translate-y-1/2 scale-[0.82] xl:scale-[0.92]"
        style={{ width: SIZE, height: SIZE }}
      >
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 h-full w-full" aria-hidden>
          <circle
            cx={C}
            cy={C}
            r={RING_R + 52}
            fill="none"
            stroke="rgba(245,239,230,0.05)"
            strokeWidth="1"
          />
          <circle
            cx={C}
            cy={C}
            r={RING_R}
            fill="none"
            stroke="rgba(245,239,230,0.18)"
            strokeWidth="1"
            strokeDasharray="2 6"
          />
          {STATIONS.map((_, i) => {
            const p = node(i);
            const on = i === active;
            return (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={5}
                fill={on ? "#c9838d" : "#24171b"}
                stroke={on ? "#f6f0e2" : "rgba(245,239,230,0.35)"}
                strokeWidth="1.25"
                style={{ transition: "fill 400ms ease, stroke 400ms ease" }}
              />
            );
          })}
          {!reducedMotion && (
            <g
              style={{
                transform: `rotate(${step * 72}deg)`,
                transformOrigin: `${C}px ${C}px`,
                transition: "transform 1100ms cubic-bezier(0.65, 0, 0.35, 1)",
              }}
            >
              <circle cx={C} cy={C - RING_R} r={15} fill="rgba(201,131,141,0.2)" />
              <rect
                x={C - 7}
                y={C - RING_R - 9}
                width={14}
                height={18}
                rx={2}
                fill="#f2e9d6"
                stroke="#b8763f"
                strokeWidth="1.5"
              />
            </g>
          )}
        </svg>

        <div
          className="absolute flex flex-col items-center"
          style={{ left: C, top: C, transform: "translate(-50%, -50%)" }}
        >
          <GlowMark size={52} glowSize={124} />
          <span className="-mt-5 font-mono text-[10px] uppercase tracking-[0.22em] text-white/50">
            Your restaurant
          </span>
        </div>

        <ol className="absolute inset-0 m-0 list-none p-0">
          {STATIONS.map((s, i) => {
            const p = node(i);
            const on = i === active;
            return (
              <li
                key={s.name}
                className="absolute w-[150px] rounded-md border px-3 py-2 transition-[border-color,background-color,opacity] duration-500"
                style={{
                  ...cardStyle(s.anchor, p.x, p.y),
                  borderColor: on ? "rgba(201,131,141,0.6)" : "rgba(245,239,230,0.1)",
                  background: on ? "rgba(97,27,40,0.34)" : "rgba(23,20,22,0.72)",
                  opacity: active === -1 || on ? 1 : 0.62,
                }}
              >
                <span
                  className="block font-mono text-[10px] uppercase tracking-[0.18em]"
                  style={{ color: on ? "#e3aab2" : "rgba(245,239,230,0.45)" }}
                >
                  {String(i + 1).padStart(2, "0")} · {s.name}
                </span>
                <span className="mt-0.5 block text-xs text-white/80">{s.detail}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** The same five stages as a compact strip — the hero's mobile/tablet version, where the ring
 *  would either be unreadably small or push the headline off the first screen. */
export function SystemStrip() {
  return (
    <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-2 p-0 font-mono text-[10px] uppercase tracking-[0.16em] text-white/55">
      {STATIONS.map((s, i) => (
        <li key={s.name} className="flex items-center gap-2">
          <span className="rounded-full border border-white/15 px-2.5 py-1">{s.name}</span>
          {i < STATIONS.length - 1 && (
            <span aria-hidden className="text-white/25">
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
