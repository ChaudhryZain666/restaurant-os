import { Link } from "react-router-dom";

import { COVER } from "./media";
import { Pinned } from "./Pinned";
import { ease, lerp, seg } from "./motion";
import { ButtonLink } from "../ButtonLink";

/**
 * SCENE 12 — DEPARTURE. The bookend: the same dining room the page opened on returns full-bleed,
 * and where the opening pulled the camera back, the ending pushes it in. The two lines land, then
 * the one action. The final frame of the film — not a CTA card.
 */
export function Departure() {
  return (
    <Pinned length={1.9} background="#0f0c0d" label="Start your restaurant on GarnishTable">
      {(p) => {
        const push = ease(seg(p, 0, 0.9));
        const l1 = ease(seg(p, 0.12, 0.34));
        const l2 = ease(seg(p, 0.3, 0.52));
        const act = ease(seg(p, 0.5, 0.7));

        return (
          <div className="relative h-full w-full">
            <img
              src={COVER.src}
              srcSet={COVER.srcSet}
              sizes="100vw"
              width={1800}
              height={1200}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                transform: `scale(${lerp(1, 1.18, push)})`,
                filter: `brightness(${lerp(0.62, 0.36, push)})`,
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse 70% 60% at 50% 50%, transparent, rgba(15,12,13,0.85))",
              }}
            />

            <div className="relative flex h-full flex-col items-center justify-center px-5 text-center">
              <h2 className="font-heading font-semibold leading-[0.9] tracking-[-0.02em] text-[#f6f0e2]">
                <span
                  className="block text-[16vw] lg:text-[9.5vw]"
                  style={{
                    opacity: l1,
                    transform: `translateY(${lerp(40, 0, l1)}px)`,
                    filter: `blur(${lerp(8, 0, l1)}px)`,
                  }}
                >
                  Your restaurant.
                </span>
                <span
                  className="mt-2 block text-[10vw] italic text-[#f6f0e2]/85 lg:text-[5.6vw]"
                  style={{
                    opacity: l2,
                    transform: `translateY(${lerp(30, 0, l2)}px)`,
                    filter: `blur(${lerp(8, 0, l2)}px)`,
                  }}
                >
                  Running on your terms.
                </span>
              </h2>

              <div style={{ opacity: act, transform: `translateY(${lerp(20, 0, act)}px)` }}>
                <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-white/75">
                  You already have the brand, the food and the customers. GarnishTable gives you the
                  system to run it.
                </p>
                <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                  <ButtonLink to="/start-trial" size="lg">
                    Start your restaurant
                  </ButtonLink>
                  <Link
                    to="/demo"
                    className="inline-flex h-12 items-center rounded-pill border border-white/35 px-6 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/10"
                  >
                    See GarnishTable in action
                  </Link>
                </div>
                <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.24em] text-white/55">
                  0% platform commission on direct orders · 14-day trial, no card required
                </p>
              </div>
            </div>
          </div>
        );
      }}
    </Pinned>
  );
}
