import { useScrollProgress } from "../lib/useScrollProgress";
import { AnimatedNumber } from "./AnimatedNumber";
import { IconChart, IconClipboard } from "./icons";
import { STOREFRONT_URL } from "../lib/links";

/**
 * THE REAL LIVE DEMO IFRAME IS PROTECTED. This renders it as one physical object sitting inside
 * the hero's environment (a screen placed on a table, not a card floating in a layout grid) — a
 * small paper ticket rests beside it, two operational-data labels sit clear of its box. The iframe
 * itself gets only a light resting tilt (a couple of degrees, easing toward flat on scroll) so it
 * reads as "a real screen at an angle," never distorted enough to hurt legibility or trust.
 * Reduced motion collapses everything to its resting, untilted state via useScrollProgress's own
 * contract — no separate branch needed here.
 */
export function HeroScene() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>();
  const p = Math.min(1, progress * 1.6);

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[620px]" style={{ perspective: "1600px" }}>
      <div className="relative" style={{ transformStyle: "preserve-3d" }}>
        {/* paper kitchen ticket — a physical object resting beside the screen */}
        <div
          className="absolute -left-4 -top-10 z-10 w-44 rounded-sm p-3.5 sm:-left-10"
          style={{
            transform: `translateZ(30px) rotate(${-9 + p * 2}deg)`,
            background: "linear-gradient(155deg, #f6efdf, #ece2ca)",
            borderTop: "2px solid #b8763f",
            boxShadow: "0 20px 36px -14px rgba(0,0,0,0.6)",
          }}
          aria-hidden
        >
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#8a7550]">Order #214</p>
          <p className="mt-1.5 text-xs font-semibold text-[#2a2013]">Margherita Pizza ×2</p>
          <span
            className="mt-1.5 inline-block rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-[#8a4a1f]"
            style={{ background: "rgba(184,118,63,0.22)" }}
          >
            New
          </span>
        </div>

        {/* THE REAL SCREEN — same iframe, same src, same title as the original hero */}
        <div
          className="relative overflow-hidden rounded-xl border border-white/10 bg-surface shadow-[0_50px_100px_-30px_rgba(0,0,0,0.85)]"
          style={{ transform: `rotateX(${3 - p * 3}deg) rotateY(${-4 + p * 4}deg) translateZ(10px)`, transformOrigin: "center bottom" }}
        >
          <div className="flex items-center gap-1.5 border-b border-border bg-background px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
            <span className="ml-3 truncate text-xs text-muted">{STOREFRONT_URL.replace("http://", "")}</span>
          </div>
          <iframe src={STOREFRONT_URL} title="Live demo restaurant preview" className="h-[340px] w-full border-0 sm:h-[380px]" loading="lazy" />
        </div>

        {/* operational data — kept clear of the iframe's own box (iframes composite above CSS
            z-ordering unpredictably across browsers, so "in front of" has to mean "not
            overlapping," not "a higher translateZ"). */}
        <div
          className="absolute -bottom-6 -right-3 hidden items-center gap-2.5 rounded-lg border border-white/10 bg-[#171310]/95 px-3.5 py-2.5 shadow-lg backdrop-blur sm:flex"
          style={{ transform: `translateZ(60px)` }}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success/15 text-success">
            <IconChart className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] text-white/50">Revenue this week</p>
            <p className="font-heading text-sm font-semibold text-white">
              <AnimatedNumber value={8420} format={(n) => `$${Math.round(n).toLocaleString()}`} />
            </p>
          </div>
        </div>

        <div
          className="absolute -right-6 top-8 hidden items-center gap-2.5 rounded-lg border border-white/10 bg-[#171310]/95 px-3.5 py-2.5 shadow-lg backdrop-blur lg:flex"
          style={{ transform: `translateZ(60px)` }}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-info/15 text-info">
            <IconClipboard className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] text-white/50">Orders today</p>
            <p className="font-heading text-sm font-semibold text-white">
              <AnimatedNumber value={47} />
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
