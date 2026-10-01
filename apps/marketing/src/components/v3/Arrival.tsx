import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Button } from "@restaurant/ui";
import { Pinned } from "./Pinned";
import { ease, lerp, seg, useIsDesktop } from "./motion";
import { AnalyticsPane, OrdersPane, StorefrontPane, Surface, Ticket } from "./Surfaces";

const ANSWERS = [
  {
    k: "What",
    v: "Restaurant operating technology — ordering, operations and growth in one system.",
  },
  { k: "Who", v: "Independent restaurants, and the groups they grow into." },
  { k: "Why", v: "So your direct orders, your customers and your data stay yours." },
];

/**
 * SCENE 1 — ARRIVAL. Opens as a film still: the real Wildwood Kitchen dining room, full-bleed,
 * under an enormous "Your restaurant." Scrolling pulls the camera back — the room recedes into a
 * card on the right while the product unfolds around it (the customer's storefront in front, the
 * kitchen queue and the owner's week behind), and an order ticket travels from the storefront into
 * the kitchen. The restaurant becomes its operating system in front of the visitor.
 *
 * The H1, CTAs and the what/who/why answers are ordinary HTML throughout — the motion is only
 * transforms and opacity on top of real content.
 */
export function Arrival() {
  const desktop = useIsDesktop();
  const panes = useMemo(
    () => ({ store: <StorefrontPane />, orders: <OrdersPane />, analytics: <AnalyticsPane /> }),
    []
  );

  return (
    <>
      <Pinned length={2.8} background="#0f0c0d" label="Your restaurant, running on your terms">
        {(p) => {
          const pull = ease(seg(p, 0.06, 0.5)); // camera pulls back
          const scale = desktop ? lerp(1, 0.4, pull) : lerp(1, 0.84, pull);
          const unfold = ease(seg(p, 0.42, 0.72)); // product surfaces arrive
          const travel = ease(seg(p, 0.66, 0.9)); // ticket moves storefront → kitchen
          const settle = desktop ? lerp(1, 0.74, pull) : 1; // the words make room for the system
          const answers = ease(seg(p, 0.74, 0.92));
          const cue = 1 - seg(p, 0, 0.06);

          return (
            <div className="relative h-full w-full">
              {/* the room */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{
                  transformOrigin: desktop ? "79% 50%" : "50% 46%",
                  transform: `scale(${scale})`,
                  borderRadius: `${(pull * 16) / scale}px`,
                  boxShadow:
                    pull > 0.05 ? `0 ${80 * pull}px ${160 * pull}px -40px rgba(0,0,0,0.8)` : "none",
                }}
              >
                <img
                  src="/v3/demo-restaurant-cover.jpg"
                  alt="The dining room at Wildwood Kitchen, GarnishTable's demo restaurant"
                  className="h-full w-full object-cover"
                  style={{ filter: `brightness(${lerp(0.5, 0.9, pull)}) saturate(1.05)` }}
                  fetchPriority="high"
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(90deg, rgba(15,12,13,0.92) 0%, rgba(15,12,13,0.55) 42%, rgba(15,12,13,0.1) 75%), linear-gradient(0deg, rgba(15,12,13,0.85) 0%, transparent 40%)",
                    opacity: 1 - pull * 0.85,
                  }}
                />
              </div>

              {/* the system unfolding around it — desktop composition */}
              {desktop && (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ perspective: "1800px" }}
                >
                  <div
                    className="absolute"
                    style={{
                      left: "56%",
                      top: "8%",
                      width: 300,
                      opacity: unfold,
                      transform: `translate3d(${lerp(80, 0, unfold)}px, ${lerp(-40, 0, unfold)}px, -120px) rotateY(-10deg)`,
                    }}
                  >
                    <Surface label="Kitchen · Orders">{panes.orders}</Surface>
                  </div>
                  <div
                    className="absolute"
                    style={{
                      left: "79%",
                      top: "58%",
                      width: 280,
                      opacity: unfold,
                      transform: `translate3d(${lerp(120, 0, unfold)}px, ${lerp(60, 0, unfold)}px, -60px) rotateY(-12deg)`,
                    }}
                  >
                    <Surface label="Owner · This week">{panes.analytics}</Surface>
                  </div>
                  <div
                    className="absolute"
                    style={{
                      left: "50%",
                      top: "46%",
                      width: 290,
                      opacity: unfold,
                      transform: `translate3d(${lerp(-60, 0, unfold)}px, ${lerp(120, 0, unfold)}px, 60px) rotateY(8deg)`,
                    }}
                  >
                    <Surface label="Customer · Storefront">{panes.store}</Surface>
                  </div>
                  <Ticket
                    className="absolute"
                    style={{
                      left: `${lerp(58, 64, travel)}%`,
                      top: `${lerp(56, 20, travel)}%`,
                      opacity: seg(p, 0.64, 0.7) * (1 - seg(p, 0.95, 1) * 0.4),
                      transform: `rotate(${lerp(-8, 4, travel)}deg) scale(${lerp(0.9, 1, travel)})`,
                    }}
                  />
                </div>
              )}

              {/* mobile composition: the storefront rises over the receding room */}
              {!desktop && (
                <div
                  className="pointer-events-none absolute left-1/2 w-[78vw] max-w-[330px]"
                  style={{
                    bottom: "7%",
                    opacity: unfold,
                    transform: `translate(-50%, ${lerp(80, 0, unfold)}px)`,
                  }}
                >
                  <Surface label="Customer · Storefront">{panes.store}</Surface>
                </div>
              )}

              {/* the words */}
              <div
                className="absolute inset-x-0 px-5 sm:px-10 lg:px-16"
                style={{ top: desktop ? "auto" : "13%", bottom: desktop ? "14%" : "auto" }}
              >
                <div
                  className="max-w-[46rem]"
                  style={{ transform: `scale(${settle})`, transformOrigin: "0% 100%" }}
                >
                  <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#e3aab2]">
                    Built for independent restaurants
                  </p>
                  <h1 className="mt-5 font-heading font-semibold leading-[0.9] tracking-[-0.02em] text-[#f6f0e2]">
                    <span className="block text-[17vw] sm:text-[12vw] lg:text-[8.2vw] xl:text-[7.6rem]">
                      Your restaurant.
                    </span>
                    <span className="block pb-[0.08em] text-[11vw] italic text-[#f6f0e2]/85 sm:text-[8vw] lg:text-[4.6vw] xl:text-[4.4rem]">
                      Running on your terms.
                    </span>
                  </h1>
                  <p
                    className="mt-5 max-w-[34rem] text-[15px] leading-relaxed text-white/70 sm:text-base"
                    style={{ opacity: desktop ? 1 : 1 - seg(p, 0.28, 0.44) }}
                  >
                    Online ordering, kitchen, POS, loyalty and analytics in one system — so your
                    direct orders, customers and data stay yours.
                  </p>
                  <div
                    className="mt-7 flex flex-wrap items-center gap-3"
                    style={{ opacity: desktop ? 1 : 1 - seg(p, 0.28, 0.44) }}
                  >
                    <Link to="/start-trial">
                      <Button size="lg">Start your restaurant</Button>
                    </Link>
                    <a
                      href="#demo"
                      className="inline-flex h-12 items-center rounded-pill border border-white/35 px-6 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/10"
                    >
                      Explore the demo
                    </a>
                  </div>
                </div>
              </div>

              {/* what / who / why — the first two screens answer the three questions */}
              {desktop && (
                <dl
                  className="absolute bottom-0 left-0 right-0 m-0 grid grid-cols-3 border-t border-white/10 bg-[#0f0c0d]/80 px-16 py-5 backdrop-blur"
                  style={{ opacity: answers, transform: `translateY(${lerp(30, 0, answers)}px)` }}
                >
                  {ANSWERS.map((a) => (
                    <div key={a.k} className="pr-8">
                      <dt className="font-mono text-[10px] uppercase tracking-[0.26em] text-[#c9838d]">
                        {a.k}
                      </dt>
                      <dd className="m-0 mt-1.5 text-sm leading-snug text-white/70">{a.v}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <div
                aria-hidden
                className="absolute bottom-6 right-6 font-mono text-[10px] uppercase tracking-[0.3em] text-white/50 sm:right-10"
                style={{ opacity: cue }}
              >
                Scroll — the restaurant comes alive ↓
              </div>
            </div>
          );
        }}
      </Pinned>

      {/* mobile: the three answers, as their own beat right after the opening */}
      {!desktop && (
        <dl className="m-0 grid gap-5 bg-[#0f0c0d] px-5 pb-16 pt-4">
          {ANSWERS.map((a) => (
            <div key={a.k} className="border-t border-white/10 pt-4">
              <dt className="font-mono text-[10px] uppercase tracking-[0.26em] text-[#c9838d]">
                {a.k}
              </dt>
              <dd className="m-0 mt-1.5 text-[15px] leading-snug text-white/70">{a.v}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
