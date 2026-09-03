import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "@restaurant/ui";
import { usePublicPlans, formatPlanPrice, type PublicPlan } from "../lib/plans";
import { IconArrowRight, IconCheck } from "./icons";

/**
 * "Choose the scale" — v2. The problem with v1: a growth line + three markers + a text panel is
 * still fundamentally a pricing table with a diagram bolted on. This version makes ONE thing the
 * whole scene: a pinned architectural floor plan (the same blueprint/plan-view material as the
 * Hero, executed in this chapter's parchment/wine palette, not repeated verbatim) that visibly
 * grows denser — more tables, a kitchen zone, live order/analytics/promo markers, then additional
 * connected locations — as the visitor moves from Start to Prove to Scale. What populates the plan
 * is driven directly by each real plan's own entitlements (business_analytics, business_promotions,
 * custom_domains, max_locations/max_businesses) — never invented, never hardcoded.
 *
 * Interaction: a classic pinned scrollytelling pattern. Three real plan panels sit in a normal
 * scrolling left column; the stage on the right is `position: sticky` and re-renders for whichever
 * panel is currently nearest the viewport center (IntersectionObserver-driven, not a scroll-math
 * hack). Clicking a panel (or its row in the mobile stack) jumps straight to it. Reduced motion
 * collapses every transform to an instant state change — nothing here depends on motion to be
 * understood, per the same contract every other primitive on this page already follows.
 */

const STAGE_LABEL = ["Start", "Prove", "Scale"];
const STAGE_NARRATIVE = [
  "One restaurant, one focused ordering page — everything you need to take your first direct orders.",
  "Orders are flowing, customers are returning, and you can finally see what's working.",
  "The same system now runs a whole portfolio — every location reporting into one view.",
];

const ENTITLEMENT_LABELS: Record<string, string> = {
  custom_domains: "Custom domain / white-label",
  business_analytics: "Business analytics",
  business_promotions: "Promotions & discount codes",
};

function planFeatures(plan: PublicPlan): string[] {
  const features: string[] = [];
  for (const e of plan.entitlements) {
    if (e.key === "max_locations" && typeof e.value === "number") {
      features.push(`${e.value} location${e.value === 1 ? "" : "s"} included`);
    } else if (e.key === "max_businesses" && typeof e.value === "number") {
      features.push(`${e.value} businesses included`);
    } else if (ENTITLEMENT_LABELS[e.key] && e.value === true) {
      features.push(ENTITLEMENT_LABELS[e.key]);
    }
  }
  if (plan.trialDays) features.unshift(`${plan.trialDays}-day free trial`);
  return features;
}

function planMonthlyCents(plan: PublicPlan): number {
  return plan.pricing.find((p) => p.interval === "monthly")?.amountCents ?? Number.POSITIVE_INFINITY;
}

function entitlement(plan: PublicPlan, key: string): boolean | number | string | undefined {
  return plan.entitlements.find((e) => e.key === key)?.value;
}

/** Re-animates every time `value` changes (not just once on first reveal) — the price is meant to
 *  visibly interpolate between tiers, not just AnimatedNumber's one-shot count-up-on-reveal. */
function useTweenedNumber(value: number, durationMs = 700) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      setDisplay(value);
      prev.current = value;
      return;
    }
    const from = prev.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else prev.current = to;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reducedMotion]);

  return display;
}

/** Which of the 3 refs is nearest the viewport's vertical center right now — the classic
 *  scrollytelling "which panel is the reader on" signal. Computed directly from each panel's own
 *  distance-from-viewport-center on scroll (rAF-throttled, same discipline as useScrollProgress),
 *  not IntersectionObserver ratio comparison — a panel much taller than the viewport can never
 *  reach a high intersection ratio against a narrow center band, which silently starved later
 *  panels of ever winning the comparison. Distance-to-center has no such ceiling. */
function useCenterActive(refs: React.RefObject<HTMLElement>[]) {
  const [active, setActive] = useState(1);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const viewportCenter = window.innerHeight / 2;
      let best = -1;
      let bestDistance = Infinity;
      refs.forEach((r, i) => {
        if (!r.current) return;
        const rect = r.current.getBoundingClientRect();
        const panelCenter = rect.top + rect.height / 2;
        const distance = Math.abs(panelCenter - viewportCenter);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      });
      if (best !== -1) setActive(best);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [refs]);
  return [active, setActive] as const;
}

/** The pinned stage — a growing architectural floor plan. Density and which markers appear are
 *  computed directly from the active plan's real entitlements, not from the stage index alone. */
function Stage({ plan, stageIndex, compact = false }: { plan: PublicPlan | undefined; stageIndex: number; compact?: boolean }) {
  const reducedMotion = useReducedMotion();
  // Multiple Stage instances render at once (3 mobile-only + 1 desktop sticky) — hardcoded
  // gradient/filter ids collided across them (invalid duplicate DOM ids), which silently broke
  // every url(#id) reference and made the whole floor plan render blank. useId() keeps each
  // instance's defs unique.
  const uid = useId();
  const idWarmGlow = `warmGlow-${uid}`;
  const idSoftDrop = `softDrop-${uid}`;
  const idTableFill = `tableFill-${uid}`;
  const price = plan ? plan.pricing.find((p) => p.interval === "monthly")?.amountCents ?? 0 : 0;
  const tweenedCents = useTweenedNumber(price / 100);
  const priceLabel = plan ? formatPlanPrice(plan.pricing, "monthly") ?? "Contact us" : "—";
  const hasAnalytics = plan ? Boolean(entitlement(plan, "business_analytics")) : false;
  const hasPromotions = plan ? Boolean(entitlement(plan, "business_promotions")) : false;
  const hasDomain = plan ? Boolean(entitlement(plan, "custom_domains")) : false;
  const locations = plan ? Number(entitlement(plan, "max_locations") ?? 1) : 1;
  const businesses = plan ? Number(entitlement(plan, "max_businesses") ?? 0) : 0;
  const satelliteCount = businesses > 0 ? Math.min(businesses - 1, 3) : Math.max(0, locations - 1);
  const t = (v: number, on: number) => (reducedMotion ? on : v);

  return (
    <div
      className="relative overflow-hidden rounded-sm border"
      style={{ borderColor: "#d9cdb0", background: "linear-gradient(160deg,#faf6ec,#f2ebd9)" }}
    >
      <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "#d9cdb0" }}>
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7a4550]">
          Floor plan — {STAGE_LABEL[stageIndex]}
        </span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-[#8f8570]">
          {plan?.name ?? ""}
        </span>
      </div>

      <div className={compact ? "relative h-[240px]" : "relative h-[360px] sm:h-[420px]"}>
        <svg viewBox="0 0 400 320" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <radialGradient id={idWarmGlow} cx="35%" cy="25%" r="75%">
              <stop offset="0%" stopColor="#611b28" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#611b28" stopOpacity="0" />
            </radialGradient>
            <filter id={idSoftDrop} x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#3d0f16" floodOpacity="0.18" />
            </filter>
            <radialGradient id={idTableFill} cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#8a3040" />
              <stop offset="100%" stopColor="#4a1420" />
            </radialGradient>
          </defs>

          <rect x="0" y="0" width="400" height="320" fill={`url(#${idWarmGlow})`} />

          {/* the whole "home restaurant" composition pulls back and shifts as the tier grows, a
              literal camera move — not just added content — so Start/Prove/Scale read as
              different SPACES, not the same static diagram with more icons switched on. */}
          <g
            transform={stageIndex === 0 ? "translate(44,26.8) scale(0.92)" : stageIndex === 1 ? "" : "translate(18,18.8) scale(0.82)"}
            style={{ transition: "transform 700ms cubic-bezier(0.16,1,0.3,1)" }}
          >
            <rect
              x="90"
              y="60"
              width="220"
              height="200"
              rx="3"
              fill="#fffdf8"
              stroke="#611b28"
              strokeWidth="1.6"
              filter={`url(#${idSoftDrop})`}
            />
            {/* kitchen zone — Prove and up */}
            <rect x="90" y="60" width="70" height="70" rx="2" fill="#611b28" opacity={stageIndex >= 1 ? 0.12 : 0} style={{ transition: "opacity 500ms ease" }} />
            <text x="98" y="80" fontSize="8" fontWeight="600" fill="#7a4550" opacity={stageIndex >= 1 ? 1 : 0} style={{ transition: "opacity 500ms ease" }}>
              KITCHEN
            </text>

            {/* table markers — count grows with stage, warm radial fill + soft shadow for a
                physical, tactile read instead of flat blueprint dots */}
            {[
              [140, 150],
              [200, 150],
              [260, 150],
              [140, 210],
              [200, 210],
              [260, 210],
            ].map(([cx, cy], i) => {
              const on = i < (stageIndex === 0 ? 2 : stageIndex === 1 ? 4 : 6);
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r="8"
                  fill={`url(#${idTableFill})`}
                  opacity={on ? 0.92 : 0}
                  style={{ transition: `opacity 400ms ease ${i * 60}ms, r 400ms ease` }}
                />
              );
            })}

            {/* order ticket marker — Prove and up */}
            <g opacity={stageIndex >= 1 ? 1 : 0} style={{ transition: "opacity 500ms ease 200ms" }}>
              <rect x="222" y="20" width="58" height="28" rx="2" fill="#fffdf8" stroke="#c7a6ab" strokeWidth="1" filter={`url(#${idSoftDrop})`} />
              <text x="228" y="33" fontSize="7" fill="#611b28">
                #1047 · New
              </text>
              <text x="228" y="43" fontSize="6" fill="#8f8570">
                Pickup
              </text>
            </g>

            {/* analytics sparkline — only if the real plan includes business_analytics */}
            <g opacity={hasAnalytics ? 1 : 0} style={{ transition: "opacity 500ms ease 260ms" }}>
              <polyline points="90,290 130,278 170,284 210,266 250,272 310,255" fill="none" stroke="#611b28" strokeWidth="1.6" strokeLinecap="round" />
              <text x="90" y="305" fontSize="7" fill="#7a4550">
                Revenue trending up
              </text>
            </g>

            {/* promotions tag — only if the real plan includes business_promotions */}
            <g opacity={hasPromotions ? 1 : 0} style={{ transition: "opacity 500ms ease 320ms" }}>
              <rect x="20" y="140" width="56" height="20" rx="10" fill="#fffdf8" stroke="#611b28" strokeWidth="1" />
              <text x="30" y="153" fontSize="7" fill="#611b28">
                WELCOME10
              </text>
            </g>

            {/* custom domain tag */}
            <g opacity={hasDomain ? 1 : 0} style={{ transition: "opacity 500ms ease 380ms" }}>
              <text x="90" y="50" fontSize="7" fill="#611b28">
                bellavista.tablecloth.app
              </text>
            </g>
          </g>

          {/* satellite locations — Scale only, count driven by real max_businesses. Each is now a
              small room in the same visual language (outline + a table dot), not a blank tag, and
              its connector carries one travelling light pulse on arrival — the "network coming
              alive" payoff moment, shown once, never looping, and skipped entirely under reduced
              motion (a static connected network is still fully legible without it). */}
          {[0, 1, 2].map((i) => {
            const on = i < satelliteCount && stageIndex >= 2;
            const positions = [
              { x: 336, y: 26, lx1: 296, ly1: 84, lx2: 350, ly2: 50 },
              { x: 18, y: 26, lx1: 116, ly1: 84, lx2: 46, ly2: 50 },
              { x: 336, y: 250, lx1: 296, ly1: 210, lx2: 350, ly2: 270 },
            ];
            const p = positions[i];
            return (
              <g key={i} opacity={on ? 1 : 0} style={{ transition: `opacity 550ms ease ${i * 140 + 120}ms` }}>
                <line x1={p.lx1} y1={p.ly1} x2={p.lx2} y2={p.ly2} stroke="#c7a6ab" strokeWidth="1.2" strokeDasharray="3 3" />
                {on && !reducedMotion && (
                  <circle r="2.4" fill="#611b28">
                    <animateMotion dur="1.1s" begin={`${i * 0.14 + 0.3}s`} fill="freeze" path={`M${p.lx1},${p.ly1} L${p.lx2},${p.ly2}`} />
                    <animate attributeName="opacity" values="0;1;0" dur="1.1s" begin={`${i * 0.14 + 0.3}s`} fill="freeze" />
                  </circle>
                )}
                <rect x={p.x} y={p.y} width="50" height="42" rx="3" fill="#fffdf8" stroke="#611b28" strokeWidth="1.2" filter={`url(#${idSoftDrop})`} />
                <circle cx={p.x + 25} cy={p.y + 24} r="4" fill={`url(#${idTableFill})`} opacity="0.9" />
                <text x={p.x + 7} y={p.y + 14} fontSize="6.5" fontWeight="600" fill="#7a4550">
                  Location {i + 2}
                </text>
              </g>
            );
          })}
          {stageIndex >= 2 && businesses > 4 && (
            <text x="150" y="308" fontSize="7" fill="#8f8570">
              +{businesses - 4} more on Agency scale
            </text>
          )}
        </svg>
      </div>

      {/* the oversized transforming price — the dominant typographic object in the scene */}
      <div className="flex items-end justify-between border-t px-5 py-5" style={{ borderColor: "#d9cdb0" }}>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7a4550]">{plan?.name ?? ""}</p>
          <p className="font-heading text-5xl leading-none text-[#2b2116] sm:text-6xl">
            {plan ? `$${Math.round(t(tweenedCents, price / 100)).toLocaleString()}` : priceLabel}
            <span className="ml-1 text-base font-sans text-[#8f8570]">/mo</span>
          </p>
        </div>
        {plan?.trialDays && (
          <span className="rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#611b28]" style={{ borderColor: "#611b28" }}>
            {plan.trialDays}-day trial
          </span>
        )}
      </div>
    </div>
  );
}

function TierPanel({
  plan,
  index,
  isActive,
  onSelect,
  innerRef,
}: {
  plan: PublicPlan;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  innerRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div ref={innerRef} className="flex flex-col justify-center py-6 lg:min-h-[62vh] lg:py-10">
      <button onClick={onSelect} className="group flex flex-col items-start gap-3 text-left">
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.22em] transition-colors duration-300"
          style={{ color: isActive ? "#611b28" : "#a89a86" }}
        >
          {String(index + 1).padStart(2, "0")} — {STAGE_LABEL[index]}
        </span>
        <h3
          className="font-heading text-3xl transition-all duration-300 sm:text-4xl"
          style={{ color: isActive ? "#2b2116" : "#a89a86", fontStyle: isActive ? "italic" : "normal" }}
        >
          {plan.name}
        </h3>
        <p className="max-w-sm text-sm text-[#5c4f3d]">{STAGE_NARRATIVE[index]}</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {planFeatures(plan).map((f) => (
            <li key={f} className="flex items-center gap-2 text-sm text-[#2b2116]">
              <IconCheck className="h-3.5 w-3.5 shrink-0 text-[#611b28]" />
              {f}
            </li>
          ))}
        </ul>
      </button>
      {isActive && (
        <Link
          to="/start-trial"
          className="mt-6 inline-flex w-fit items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-[#f8f4ea] transition-transform duration-200 hover:-translate-y-0.5"
          style={{ background: "#611b28" }}
        >
          Start Free Trial <IconArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

export function ScaleSelector() {
  const { plans, error } = usePublicPlans();
  const sorted = useMemo(() => [...(plans ?? [])].sort((a, b) => planMonthlyCents(a) - planMonthlyCents(b)), [plans]);

  const ref0 = useRef<HTMLDivElement>(null);
  const ref1 = useRef<HTMLDivElement>(null);
  const ref2 = useRef<HTMLDivElement>(null);
  const refs = useMemo(() => [ref0, ref1, ref2], []);
  const [active, setActive] = useCenterActive(refs);

  const activePlan = sorted[Math.min(active, sorted.length - 1)];

  return (
    <div>
      <div className="mx-auto max-w-2xl text-center">
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7a4550]">Pricing</span>
        <h2 className="mt-3 font-heading text-4xl italic text-[#2b2116] sm:text-5xl">Choose the scale of your restaurant.</h2>
        <p className="mt-4 text-[#5c4f3d]">
          The same system, growing with the business — no per-order commission at any tier.
        </p>
      </div>

      {error && <p className="mt-10 text-center text-sm text-[#7a4550]">Couldn't load pricing right now — please try again shortly.</p>}
      {!plans && !error && <p className="mt-10 text-center text-sm text-[#5c4f3d]">Loading pricing…</p>}

      {sorted.length > 0 && (
        <div className="mt-16 grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          <div>
            {sorted.map((plan, i) => (
              <div key={plan.code}>
                {/* mobile: each tier gets its own compact stage right above it — the desktop
                    sticky/scrollytelling pattern doesn't translate to a single narrow column, so
                    this is a deliberately different, mobile-native way of showing the same
                    transformation (see Stage's own comment for why). */}
                <div className="mb-4 lg:hidden">
                  <Stage plan={plan} stageIndex={i} compact />
                </div>
                <TierPanel plan={plan} index={i} isActive={i === active} onSelect={() => setActive(i)} innerRef={refs[i]} />
              </div>
            ))}
          </div>

          <div className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
            <Stage plan={activePlan} stageIndex={active} />
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-center">
        <Link to="/pricing" className="text-sm font-medium text-[#7a4550] underline-offset-4 hover:underline">
          See full pricing
        </Link>
      </div>
    </div>
  );
}
