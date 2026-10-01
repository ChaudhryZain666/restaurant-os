import { logoMarkAsset } from "@restaurant/ui";
import { Pinned } from "./Pinned";
import { ease, lerp, seg, useIsDesktop } from "./motion";

const WORDS = [
  "Ordering",
  "Menu",
  "Kitchen",
  "POS",
  "Delivery",
  "Customers",
  "Loyalty",
  "Analytics",
  "Locations",
];

/** Scattered composition: x/y are the word's center as % of the frame, s its scale, r rotation,
 *  d a parallax depth (how far it drifts while scattered). Hand-placed, not random — the scatter
 *  is a composition, and it must read the same on every load. */
const SCATTER_DESKTOP = [
  { x: 22, y: 26, s: 1.25, r: -4, d: 60 },
  { x: 74, y: 18, s: 0.8, r: 3, d: 30 },
  { x: 60, y: 46, s: 1.45, r: 0, d: 90 },
  { x: 15, y: 62, s: 0.95, r: 5, d: 40 },
  { x: 84, y: 66, s: 1.05, r: -6, d: 70 },
  { x: 38, y: 84, s: 1.15, r: 2, d: 50 },
  { x: 46, y: 14, s: 0.7, r: -2, d: 20 },
  { x: 30, y: 44, s: 0.75, r: 7, d: 80 },
  { x: 70, y: 86, s: 0.85, r: -3, d: 35 },
];
const SCATTER_MOBILE = [
  { x: 30, y: 24, s: 1.1, r: -4, d: 40 },
  { x: 72, y: 32, s: 0.8, r: 4, d: 25 },
  { x: 50, y: 44, s: 1.3, r: 0, d: 60 },
  { x: 26, y: 56, s: 0.9, r: 5, d: 30 },
  { x: 74, y: 60, s: 1.0, r: -5, d: 50 },
  { x: 42, y: 74, s: 1.05, r: 2, d: 35 },
  { x: 66, y: 16, s: 0.7, r: -2, d: 20 },
  { x: 30, y: 88, s: 0.75, r: 6, d: 45 },
  { x: 72, y: 84, s: 0.85, r: -3, d: 30 },
];

function mix(a: [number, number, number], b: [number, number, number], t: number) {
  return `rgb(${Math.round(lerp(a[0], b[0], t))}, ${Math.round(lerp(a[1], b[1], t))}, ${Math.round(lerp(a[2], b[2], t))})`;
}
const INK: [number, number, number] = [15, 12, 13];
const WINE: [number, number, number] = [74, 22, 32];
const PARCH: [number, number, number] = [238, 231, 215];
const IVORY: [number, number, number] = [246, 240, 226];
const BROWN: [number, number, number] = [43, 33, 22];

/**
 * SCENE 2 — THE RESTAURANT. Nine real operational words scattered huge across the frame — the
 * restaurant's moving parts. Scrolling carries the page itself across from the dark cinematic
 * world into warm parchment (the transition between the two worlds is the scene), the words pull
 * into orbit around the restaurant at the center, keep circling, and the line lands:
 * "GarnishTable brings them together." The words are a real list in the DOM.
 */
export function MovingParts() {
  const desktop = useIsDesktop();
  const scatter = desktop ? SCATTER_DESKTOP : SCATTER_MOBILE;

  return (
    <Pinned length={2.6} label="Your restaurant has a lot of moving parts">
      {(p) => {
        const dawn = ease(seg(p, 0.12, 0.42)); // ink → parchment
        const gather = ease(seg(p, 0.3, 0.68)); // scatter → orbit
        const outro = ease(seg(p, 0.66, 0.84));
        const spin = seg(p, 0.6, 1) * 46; // keeps circling once gathered
        const rx = desktop ? 31 : 37;
        const ry = desktop ? 30 : 24;
        const ground = dawn < 0.5 ? mix(INK, WINE, dawn * 2) : mix(WINE, PARCH, (dawn - 0.5) * 2);
        const wordColor = mix(IVORY, BROWN, seg(dawn, 0.55, 0.85));
        const headline = 1 - seg(p, 0.08, 0.2); // headline clears before the words move in
        const wordsIn = seg(p, 0.02, 0.16);

        return (
          <div className="relative h-full w-full" style={{ background: ground }}>
            <h2
              className="absolute left-5 right-5 top-[16%] font-heading text-[10vw] font-semibold leading-[0.95] tracking-tight sm:left-10 lg:left-16 lg:max-w-[52rem] lg:text-[5.4vw]"
              style={{
                color: "#f6f0e2",
                opacity: headline,
                transform: `translateY(${lerp(0, -40, 1 - headline)}px)`,
              }}
            >
              Your restaurant has a lot of <em>moving parts.</em>
            </h2>

            <ul
              className="m-0 list-none p-0"
              aria-label="The parts of a restaurant GarnishTable runs"
            >
              {WORDS.map((w, i) => {
                const sc = scatter[i];
                const ang = ((i / WORDS.length) * 360 - 90 + spin) * (Math.PI / 180);
                const ox = 50 + rx * Math.cos(ang);
                const oy = 54 + ry * Math.sin(ang);
                const drift = (1 - gather) * sc.d * (p - 0.15);
                const x = lerp(sc.x, ox, gather);
                const y = lerp(sc.y, oy, gather);
                const s = lerp(sc.s, desktop ? 0.3 : 0.32, gather);
                return (
                  <li
                    key={w}
                    className="absolute whitespace-nowrap font-heading font-semibold uppercase leading-none tracking-[-0.01em]"
                    style={{
                      left: `${x}%`,
                      top: `${y}%`,
                      fontSize: desktop ? "6.4vw" : "13vw",
                      color: wordColor,
                      opacity: lerp(0.16, 1, wordsIn) * lerp(0.55 + (sc.s - 0.7) * 0.6, 1, gather),
                      transform: `translate(-50%, calc(-50% - ${drift}px)) rotate(${lerp(sc.r, 0, gather)}deg) scale(${s})`,
                      willChange: "transform",
                    }}
                  >
                    {w}
                  </li>
                );
              })}
            </ul>

            {/* the restaurant at the center */}
            <div
              className="absolute left-1/2 top-[54%] flex flex-col items-center"
              style={{
                opacity: seg(p, 0.5, 0.7),
                transform: `translate(-50%, -50%) scale(${lerp(0.7, 1, seg(p, 0.5, 0.75))})`,
              }}
            >
              <div
                aria-hidden
                className="absolute h-56 w-56 rounded-full"
                style={{
                  background: "radial-gradient(circle, rgba(97,27,40,0.18), transparent 70%)",
                }}
              />
              <img
                src={logoMarkAsset}
                alt=""
                className="relative h-16 w-16 object-contain lg:h-20 lg:w-20"
              />
              <p className="relative mt-3 font-mono text-[10px] uppercase tracking-[0.28em] text-[#6b5d48]">
                Your restaurant
              </p>
            </div>

            <p
              className="absolute inset-x-5 bottom-[7%] text-center font-heading text-[8vw] font-semibold leading-[1.02] tracking-tight text-[#2b2116] lg:bottom-[6%] lg:text-[3.6vw]"
              style={{ opacity: outro, transform: `translateY(${lerp(30, 0, outro)}px)` }}
            >
              GarnishTable brings them <em className="text-[#611b28]">together.</em>
            </p>
          </div>
        );
      }}
    </Pinned>
  );
}
