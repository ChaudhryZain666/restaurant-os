import { useScrollProgress } from "../lib/useScrollProgress";
import { AnimatedNumber } from "./AnimatedNumber";
import { MenuMock } from "./FeatureMocks";
import { IconChart } from "./icons";

/**
 * The hero's right-side visual — same slot the old static browser-chrome mockup occupied, replaced
 * with a layered CSS 3D scene (perspective + translateZ, no WebGL/3D library) dramatizing
 * physical-restaurant → digital-order → revenue in one glance: a wood-grain "table" back plane, a
 * kitchen order ticket mid-plane, and the real MenuMock front-and-center as the phone the order
 * came from. Scroll-linked via useScrollProgress — the planes part further as the hero scrolls
 * through view, settling to their resting pose immediately under reduced motion (the hook's own
 * contract), so nothing here needs a separate reduced-motion branch.
 */
export function HeroScene() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>();
  const p = Math.min(1, progress * 1.6); // reach full separation a little before the section fully passes

  return (
    <div ref={ref} className="relative" style={{ perspective: "1400px" }}>
      <div
        className="relative h-[420px] sm:h-[460px]"
        style={{ transformStyle: "preserve-3d", transform: `rotateX(${4 - p * 4}deg) rotateY(${-3 + p * 3}deg)` }}
      >
        {/* back plane — the physical table */}
        <div
          className="absolute inset-4 rounded-2xl border border-border/60"
          style={{
            transform: `translateZ(-70px) scale(1.06)`,
            background:
              "repeating-linear-gradient(100deg, color-mix(in srgb, var(--color-accent) 10%, var(--color-surface)) 0px, color-mix(in srgb, var(--color-accent) 10%, var(--color-surface)) 2px, var(--color-surface) 2px, var(--color-surface) 26px), radial-gradient(ellipse 70% 60% at 30% 20%, color-mix(in srgb, var(--color-primary) 8%, transparent), transparent 70%)",
            boxShadow: "inset 0 0 60px rgba(0,0,0,0.12)",
          }}
          aria-hidden
        />

        {/* mid plane — a kitchen order ticket, drifting into place */}
        <div
          className="absolute left-6 top-8 w-56 rounded-lg border border-border bg-surface p-4 shadow-lg sm:left-10 sm:top-10"
          style={{
            transform: `translateZ(${-10 + p * 30}px) rotate(${-6 + p * 2}deg)`,
            opacity: 0.55 + p * 0.45,
            transition: "transform 120ms linear, opacity 120ms linear",
          }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Order #214 · 12:04pm</p>
          <p className="mt-2 text-sm font-semibold text-foreground">Margherita Pizza ×2</p>
          <p className="text-sm text-foreground/80">Loaded Fries ×1</p>
          <span className="mt-2 inline-block rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-primary">
            New
          </span>
        </div>

        {/* front plane — the real customer menu (actual MenuMock, not invented UI) */}
        <div
          className="absolute bottom-2 right-2 w-[240px] overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated sm:w-[260px]"
          style={{ transform: `translateZ(${50 + p * 40}px) rotate(${5 - p * 5}deg)` }}
        >
          <div className="flex items-center gap-1.5 border-b border-border bg-background px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-danger/60" />
            <span className="h-2 w-2 rounded-full bg-warning/60" />
            <span className="h-2 w-2 rounded-full bg-success/60" />
            <span className="ml-1.5 truncate text-[10px] text-muted">yourrestaurant.tablecloth.app</span>
          </div>
          <MenuMock />
        </div>

        {/* revenue chip — same content as before, now counting up */}
        <div
          className="absolute bottom-2 left-0 hidden items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-lg sm:flex"
          style={{ transform: `translateZ(${90 + p * 20}px)` }}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success/15 text-success">
            <IconChart className="h-[18px] w-[18px]" />
          </span>
          <div>
            <p className="text-xs text-muted">Revenue this week</p>
            <p className="font-heading text-sm font-semibold text-foreground">
              <AnimatedNumber value={8420} format={(n) => `$${Math.round(n).toLocaleString()}`} />
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
