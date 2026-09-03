import { useScrollReveal, useReducedMotion } from "@restaurant/ui";
import { AnimatedNumber } from "./AnimatedNumber";
import { BENEFITS } from "../lib/content";

/**
 * "Why we are useful" — the real Benefits content (unchanged, all 6 statements), presented as a
 * transformation instead of a static card grid: one small "restaurant status" scene morphs from a
 * vague, fragmented Before into a clear, owned After as it scrolls into view. The 6 real benefits
 * sit below as the reasons the transformation happened, each still traceable to the same copy the
 * old section used — content preserved, presentation replaced.
 */

function TransformScene() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  const reducedMotion = useReducedMotion();
  const after = reducedMotion || visible;

  return (
    <div ref={ref} className="relative mx-auto max-w-lg overflow-hidden rounded-sm border" style={{ borderColor: "#d9cdb0", background: "#fdfbf5" }}>
      <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "#d9cdb0" }}>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: after ? "#15803d" : "#8f8570" }}>
          {after ? "Direct — owned" : "Marketplace — rented"}
        </span>
        <span
          className="h-1.5 w-1.5 rounded-full transition-colors duration-700"
          style={{ background: after ? "#15803d" : "#a89a86" }}
        />
      </div>
      <div className="grid grid-cols-2 gap-px" style={{ background: "#d9cdb0" }}>
        <div className="bg-[#fdfbf5] p-5">
          <p className="text-[10px] uppercase tracking-wide" style={{ color: "#8f8570" }}>
            Customer
          </p>
          <p className="mt-1 font-heading text-lg transition-all duration-700" style={{ color: after ? "#2b2116" : "#a89a86", filter: after ? "none" : "blur(2px)" }}>
            {after ? "Jordan Lee" : "Unknown"}
          </p>
        </div>
        <div className="bg-[#fdfbf5] p-5">
          <p className="text-[10px] uppercase tracking-wide" style={{ color: "#8f8570" }}>
            Orders today
          </p>
          <p className="font-heading text-lg" style={{ color: after ? "#2b2116" : "#a89a86" }}>
            {after ? <AnimatedNumber value={47} /> : "?"}
          </p>
        </div>
        <div className="bg-[#fdfbf5] p-5">
          <p className="text-[10px] uppercase tracking-wide" style={{ color: "#8f8570" }}>
            Repeat rate
          </p>
          <p className="font-heading text-lg" style={{ color: after ? "#2b2116" : "#a89a86" }}>
            {after ? "38%" : "—"}
          </p>
        </div>
        <div className="bg-[#fdfbf5] p-5">
          <p className="text-[10px] uppercase tracking-wide" style={{ color: "#8f8570" }}>
            Who owns this data
          </p>
          <p className="font-heading text-lg" style={{ color: after ? "#611b28" : "#a89a86" }}>
            {after ? "You" : "The marketplace"}
          </p>
        </div>
      </div>
    </div>
  );
}

export function WhyUseful() {
  return (
    <div>
      <div className="mx-auto max-w-2xl text-center">
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7a4550]">Why it's useful</span>
        <h2 className="mt-3 font-heading text-4xl italic text-[#2b2116] sm:text-5xl">More than another ordering form.</h2>
        <p className="mt-4 text-[#5c4f3d]">Not a feature list — what actually changes when the data is yours.</p>
      </div>

      <div className="mt-14">
        <TransformScene />
      </div>

      <div className="mx-auto mt-16 grid max-w-4xl grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2">
        {BENEFITS.map((benefit) => (
          <div key={benefit.title} className="border-t pt-4" style={{ borderColor: "#d9cdb0" }}>
            <h3 className="font-heading text-lg text-[#2b2116]">{benefit.title}</h3>
            <p className="mt-1.5 text-sm text-[#5c4f3d]">{benefit.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
