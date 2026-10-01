import { Pinned } from "./Pinned";
import { ease, lerp, seg, useIsDesktop } from "./motion";

const FACTS_MARKET = [
  "A share of every order",
  "Their app, their brand",
  "The customer stays with them",
];
const FACTS_DIRECT = [
  "0% platform commission",
  "Your storefront, your domain",
  "Every customer, every order — yours",
];

/**
 * SCENE 3 — THE ORDER. The direct-ordering argument as one physical event instead of a table:
 * customer → marketplace → restaurant, under a ghosted "Theirs." Scrolling knocks the marketplace
 * out of the chain, the restaurant moves in close, a return line forms back to the customer (the
 * relationship the restaurant now keeps), and "Theirs." becomes "Yours." Both versions of the
 * facts exist as real text; only one is visible at a time.
 *
 * No marketplace is named and no commission rate is claimed — "a share of every order" is true
 * of the category.
 */
export function DirectOrdering() {
  const desktop = useIsDesktop();

  return (
    <Pinned length={2.4} background="#eee7d7" label="Direct ordering versus a marketplace">
      {(p) => {
        const cut = ease(seg(p, 0.34, 0.6)); // marketplace leaves
        const close = ease(seg(p, 0.46, 0.7)); // restaurant moves in
        const bond = ease(seg(p, 0.62, 0.84)); // the return line forms
        const swap = ease(seg(p, 0.44, 0.62));

        const custX = desktop ? 16 : 18;
        const restX = lerp(desktop ? 82 : 82, desktop ? 64 : 70, close);
        const nodeY = desktop ? 50 : 46;
        const restScale = lerp(1, 1.28, close);

        return (
          <div className="relative h-full w-full text-[#2b2116]">
            {/* the ghost word */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
            >
              <span
                className="absolute font-heading text-[30vw] font-semibold italic leading-none tracking-tight lg:text-[22vw]"
                style={{
                  color: "rgba(43,33,22,0.07)",
                  opacity: 1 - swap,
                  transform: `translateY(${lerp(0, -40, swap)}px)`,
                }}
              >
                Theirs.
              </span>
              <span
                className="absolute font-heading text-[30vw] font-semibold italic leading-none tracking-tight lg:text-[22vw]"
                style={{
                  color: "rgba(97,27,40,0.12)",
                  opacity: swap,
                  transform: `translateY(${lerp(40, 0, swap)}px)`,
                }}
              >
                Yours.
              </span>
            </div>

            <div className="absolute inset-x-5 top-[12%] sm:left-10 lg:left-16 lg:right-auto lg:max-w-[40rem]">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#611b28]">
                The order
              </p>
              <h2 className="mt-4 font-heading text-[9vw] font-semibold leading-[0.98] tracking-tight text-[#2b2116] lg:text-[3.6vw]">
                Every order goes somewhere. <em>The question is whose.</em>
              </h2>
            </div>

            {/* the chain */}
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
              aria-hidden
            >
              <line
                x1={custX}
                y1={nodeY}
                x2={lerp(46, restX, cut)}
                y2={nodeY}
                stroke="#2b2116"
                strokeOpacity={0.35}
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
                strokeDasharray="4 5"
              />
              <line
                x1={46}
                y1={nodeY}
                x2={restX}
                y2={nodeY}
                stroke="#2b2116"
                strokeOpacity={0.35 * (1 - cut)}
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
                strokeDasharray="4 5"
              />
              {/* revealed by a clip that grows from the restaurant back to the customer —
                  pathLength dashing breaks under non-scaling-stroke */}
              <clipPath id="v3-return-reveal">
                <rect
                  x={lerp(restX, custX - 2, bond)}
                  y={0}
                  width={Math.max(0, restX + 2 - lerp(restX, custX - 2, bond))}
                  height={100}
                />
              </clipPath>
              <path
                d={`M ${restX} ${nodeY + 13} Q ${(restX + custX) / 2} ${nodeY + 34} ${custX} ${nodeY + 10}`}
                fill="none"
                stroke="#611b28"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                clipPath="url(#v3-return-reveal)"
                opacity={bond > 0 ? 1 : 0}
              />
            </svg>

            {/* customer */}
            <figure
              className="absolute m-0 flex flex-col items-center"
              style={{ left: `${custX}%`, top: `${nodeY}%`, transform: "translate(-50%, -50%)" }}
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#2b2116]/20 bg-[#f6f0e2] font-heading text-2xl lg:h-20 lg:w-20">
                J
              </span>
              <figcaption className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-[#6b5d48]">
                Jordan Lee
              </figcaption>
            </figure>

            {/* marketplace — leaves the chain */}
            <figure
              className="absolute m-0 flex flex-col items-center"
              style={{
                left: "46%",
                top: `${nodeY}%`,
                opacity: 1 - cut,
                transform: `translate(-50%, calc(-50% + ${cut * 120}px)) rotate(${cut * 14}deg) scale(${lerp(1, 0.8, cut)})`,
              }}
            >
              <span className="flex h-16 w-24 flex-col items-center justify-center rounded-lg border border-dashed border-[#2b2116]/35 bg-[#e3dac5] lg:h-20 lg:w-32">
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#6b5d48]">
                  Marketplace
                </span>
                <span className="mt-1 font-heading text-lg text-[#2b2116]">− %</span>
              </span>
              <figcaption className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#6b5d48]">
                Takes a cut
              </figcaption>
            </figure>

            {/* the restaurant */}
            <figure
              className="absolute m-0 flex flex-col items-center"
              style={{
                left: `${restX}%`,
                top: `${nodeY}%`,
                transform: `translate(-50%, -50%) scale(${restScale})`,
              }}
            >
              <span className="block h-20 w-20 overflow-hidden rounded-full border-2 border-[#611b28]/60 shadow-[0_20px_40px_-15px_rgba(97,27,40,0.5)] lg:h-24 lg:w-24">
                <img
                  src="/v3/demo-restaurant-cover.jpg"
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </span>
              <figcaption className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#611b28]">
                Your restaurant
              </figcaption>
            </figure>

            {/* the facts, before and after */}
            <div className="absolute inset-x-5 bottom-[9%] sm:left-10 sm:right-10 lg:left-16 lg:right-16">
              <div className="relative">
                <dl
                  className="m-0 grid gap-x-10 gap-y-2 lg:grid-cols-[auto_1fr_1fr_1fr]"
                  style={{ opacity: 1 - swap }}
                  aria-hidden={swap > 0.5}
                >
                  <dt className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#6b5d48]">
                    Through a marketplace
                  </dt>
                  {FACTS_MARKET.map((f) => (
                    <dd
                      key={f}
                      className="m-0 border-t border-[#2b2116]/15 pt-2 text-[15px] text-[#6b5d48]"
                    >
                      {f}
                    </dd>
                  ))}
                </dl>
                <dl
                  className="absolute inset-0 m-0 grid gap-x-10 gap-y-2 lg:grid-cols-[auto_1fr_1fr_1fr]"
                  style={{ opacity: swap }}
                  aria-hidden={swap <= 0.5}
                >
                  <dt className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#611b28]">
                    Direct, with GarnishTable
                  </dt>
                  {FACTS_DIRECT.map((f) => (
                    <dd
                      key={f}
                      className="m-0 border-t border-[#611b28]/30 pt-2 text-[15px] font-medium text-[#2b2116]"
                    >
                      {f}
                    </dd>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        );
      }}
    </Pinned>
  );
}
