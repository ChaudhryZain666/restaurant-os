import { useScrollReveal } from "@restaurant/ui";
import { AnimatedNumber } from "./AnimatedNumber";

/**
 * "The main goal" — the thesis, deliberately restrained: mostly typography and stillness, the
 * emotional peak the brief asks for without turning into another animated set-piece. Real demo
 * figures as the closing beat (the same $8,420/47/312 numbers used consistently everywhere else on
 * this page — never a new invented statistic).
 */
export function MainGoal() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="mx-auto max-w-3xl text-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/45">The main goal</span>
      <h2
        className="mt-5 font-heading text-4xl leading-[1.05] text-white transition-all duration-700 sm:text-6xl"
        style={{ opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(10px)" }}
      >
        Every order should build <em className="text-gradient not-italic">your</em> business — not someone else's.
      </h2>
      <p className="mx-auto mt-6 max-w-lg text-white/60">
        That's the whole premise. Ordering, menu, customers, delivery, loyalty and analytics, working together, owned
        by the restaurant that earned them.
      </p>

      <div className="mt-14 flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
        <div>
          <p className="font-heading text-3xl text-white">
            $<AnimatedNumber value={8420} />
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-white/40">Weekly revenue, direct</p>
        </div>
        <div>
          <p className="font-heading text-3xl text-white">
            <AnimatedNumber value={312} />
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-white/40">Orders, no commission</p>
        </div>
        <div>
          <p className="font-heading text-3xl text-white">
            <AnimatedNumber value={0} />%
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-white/40">Cut to a marketplace</p>
        </div>
      </div>
    </div>
  );
}
