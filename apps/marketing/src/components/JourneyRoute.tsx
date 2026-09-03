import { Link } from "react-router-dom";
import { Button, useReducedMotion, useScrollReveal } from "@restaurant/ui";
import { useScrollProgress } from "../lib/useScrollProgress";
import { HOW_IT_WORKS_STEPS } from "../lib/content";
import { IconArrowRight } from "./icons";
import { MenuMock } from "./FeatureMocks";

/**
 * "The route": a single continuous vertical line the visitor scrolls down, not six independent
 * cards. A marker travels the line as you scroll (useScrollProgress — the same continuous,
 * scroll-linked mechanism the Hero uses, deliberately not the Offer board/Showcase's discrete
 * reveal-on-enter, so this section's motion *feels* different too, not just its layout) while each
 * node lights up once the marker reaches it. Same neutral blueprint foundation as the Hero (white
 * line, white text, amber reserved only for the position marker and the final CTA) rather than a
 * new dominant color — this section is literally "the path through the blueprint," so echoing the
 * Hero's specific neutral language is the coherent choice, not a repeat of Offer's or Showcase's.
 */

const LEGS = [
  { label: "Setup", steps: [0, 1] },
  { label: "Launch", steps: [2, 3] },
  { label: "Operate", steps: [4, 5] },
];

function legFor(stepIndex: number) {
  return LEGS.find((l) => l.steps.includes(stepIndex))?.label ?? "";
}

/** A tiny real-feeling "new restaurant" form snippet for step 1 — no existing mock covers account
 *  creation, so this is the one genuinely new (but minimal, non-decorative) UI fragment here. */
function CreateRestaurantMoment() {
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-white/10 bg-[#0f0d0c] p-3 font-mono text-xs">
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <span className="text-white/40">Restaurant name</span>
        <span className="text-white">Bella Vista</span>
      </div>
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <span className="text-white/40">Cuisine</span>
        <span className="text-white">Italian</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-white/40">Location</span>
        <span className="text-white">Boston, MA</span>
      </div>
    </div>
  );
}

function CustomizeMoment() {
  const colors = ["#e08a3e", "#0f766e", "#7c3aed", "#be123c"];
  return (
    <div className="flex items-center gap-2 rounded-sm border border-white/10 bg-[#0f0d0c] p-3">
      {colors.map((c, i) => (
        <span key={c} className="h-6 w-6 rounded-full border-2" style={{ background: c, borderColor: i === 0 ? "white" : "transparent" }} />
      ))}
      <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-white/40">Brand color</span>
    </div>
  );
}

function PublishMoment() {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-white/10 bg-[#0f0d0c] p-3 font-mono text-xs">
      <span className="h-2 w-2 rounded-full bg-success" style={{ boxShadow: "0 0 8px var(--color-success)" }} />
      <span className="text-white">bellavista.tablecloth.app</span>
      <span className="ml-auto text-[10px] uppercase tracking-wide text-success">Live</span>
    </div>
  );
}

function OrdersMoment() {
  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-white/10 bg-[#0f0d0c] p-3 font-mono text-xs">
      <div className="flex items-center justify-between">
        <span className="text-white/70">#1047 · Pickup</span>
        <span className="text-primary">New</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-white/70">#1046 · Delivery</span>
        <span className="text-info">Preparing</span>
      </div>
    </div>
  );
}

function ManageMoment() {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-sm border border-white/10 bg-[#0f0d0c] p-3 font-mono text-xs">
      <div>
        <p className="text-white/40">Revenue</p>
        <p className="text-white">$8,420</p>
      </div>
      <div>
        <p className="text-white/40">Orders</p>
        <p className="text-white">312</p>
      </div>
    </div>
  );
}

const MOMENTS = [CreateRestaurantMoment, () => <MenuMock />, CustomizeMoment, PublishMoment, OrdersMoment, ManageMoment];

function StepNode({ index, active }: { index: number; active: boolean }) {
  const { title, description } = HOW_IT_WORKS_STEPS[index];
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  const Moment = MOMENTS[index];
  return (
    <div ref={ref} className="relative pb-14 pl-16 last:pb-0 sm:pl-20">
      <div
        className="absolute left-6 top-1 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border font-mono text-[10px] transition-all duration-500 sm:left-8"
        style={{
          borderColor: active ? "var(--color-primary)" : "rgba(255,255,255,0.2)",
          background: active ? "var(--color-primary)" : "#0f0d0c",
          color: active ? "var(--color-primary-foreground)" : "rgba(255,255,255,0.4)",
        }}
      >
        {index + 1}
      </div>
      <div
        className="transition-all duration-700"
        style={{ opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(14px)" }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">{legFor(index)}</span>
        <h3 className="mt-1 font-heading text-xl text-white sm:text-2xl">{title}</h3>
        <p className="mt-2 max-w-md text-sm text-white/55">{description}</p>
        <div className="mt-4 max-w-xs">
          <Moment />
        </div>
      </div>
    </div>
  );
}

export function JourneyRoute() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>();
  const reducedMotion = useReducedMotion();
  const activeCount = reducedMotion ? HOW_IT_WORKS_STEPS.length : Math.floor(progress * HOW_IT_WORKS_STEPS.length * 1.15);

  return (
    <div>
      <div className="mb-14 max-w-xl">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/50">How it works</span>
        <h2 className="mt-3 font-heading text-3xl text-white sm:text-4xl">From signup to your first order</h2>
      </div>

      <div ref={ref} className="relative">
        {/* the route itself: a static faint line, a white fill showing how far the visitor has
            travelled, and a small marker riding the fill's leading edge. */}
        <div className="absolute left-6 top-1 bottom-1 w-px bg-white/10 sm:left-8" aria-hidden />
        <div
          className="absolute left-6 top-1 w-px bg-white/60 sm:left-8"
          style={{ height: `${Math.min(100, progress * 115)}%`, transition: reducedMotion ? "none" : "height 120ms linear" }}
          aria-hidden
        />
        {!reducedMotion && (
          <div
            className="absolute left-6 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary sm:left-8"
            style={{ top: `${Math.min(100, progress * 115)}%`, boxShadow: "0 0 10px var(--color-primary)", transition: "top 120ms linear" }}
            aria-hidden
          />
        )}

        {HOW_IT_WORKS_STEPS.map((_, i) => (
          <StepNode key={HOW_IT_WORKS_STEPS[i].title} index={i} active={i < activeCount} />
        ))}
      </div>

      <div className="mt-4 flex justify-center pl-16 sm:pl-20">
        <Link to="/how-it-works">
          <Button variant="outline" className="border-white/30 text-white hover:bg-white/10">
            See the full walkthrough <IconArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
