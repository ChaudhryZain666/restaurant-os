import { Link } from "react-router-dom";
import { ProductShowcase } from "../ProductShowcase";
import { Pinned } from "./Pinned";
import { ease, lerp, seg } from "./motion";

/**
 * SCENE 9 — EXPERIENCE IT. A deliberate break in register: two enormous lines, the first struck
 * through by scrolling ("Enough marketing."), the second arriving ("Now see the real thing."), and
 * then the real, running demo restaurant — the existing live-iframe monitor wall, unchanged in
 * behavior (the storefront iframe never remounts).
 */
export function ExperienceIt() {
  return (
    <>
      <Pinned length={1.7} background="#0f0c0d" label="Enough marketing — now see the real thing">
        {(p) => {
          const strike = ease(seg(p, 0.12, 0.42));
          const second = ease(seg(p, 0.42, 0.7));
          return (
            <div className="flex h-full w-full flex-col justify-center px-5 sm:px-10 lg:px-16">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#c9838d]">
                Experience it
              </p>
              <p
                className="relative mt-6 w-fit font-heading text-[14vw] font-semibold leading-[0.95] tracking-tight lg:text-[9vw]"
                style={{ color: `rgba(246,240,226,${lerp(1, 0.28, strike)})` }}
              >
                Enough marketing.
                <span
                  aria-hidden
                  className="absolute left-0 top-[54%] h-[0.06em] bg-[#c9838d]"
                  style={{ width: `${strike * 100}%` }}
                />
              </p>
              <h2
                className="mt-2 font-heading text-[14vw] font-semibold italic leading-[0.95] tracking-tight text-[#f6f0e2] lg:text-[9vw]"
                style={{
                  opacity: second,
                  transform: `translateY(${lerp(40, 0, second)}px)`,
                  // negative insets leave room for the italic's overhangs and descenders
                  clipPath:
                    second >= 1 ? "none" : `inset(-0.2em ${lerp(100, -5, second)}% -0.3em -0.15em)`,
                }}
              >
                Now see the real thing.
              </h2>
            </div>
          );
        }}
      </Pinned>

      <section
        id="demo"
        className="relative scroll-mt-16 px-5 pb-28 pt-8 sm:px-10 lg:px-16"
        style={{ background: "#0f0c0d" }}
      >
        <div className="mx-auto max-w-6xl">
          <ProductShowcase
            eyebrow="Wildwood Kitchen · live"
            title="A real restaurant, running on GarnishTable."
            description="This is our demo restaurant on the real platform — not a video, not a screenshot. Browse the menu, then switch to the dashboard, menu and order queue behind it."
          />
          <div className="mt-10 flex justify-center">
            <Link
              to="/demo"
              className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/55 underline-offset-4 hover:text-white hover:underline"
            >
              Open the full demo →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
