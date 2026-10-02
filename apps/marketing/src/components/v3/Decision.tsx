import { Link } from "react-router-dom";
import { Reveal } from "@restaurant/ui";
import { FaqItem } from "../FaqItem";
import { BUYER_FAQS } from "../v2/faqs";

const FOR = [
  {
    who: "Independent restaurants.",
    why: "One location, a loyal following, a menu worth ordering direct.",
  },
  { who: "Growing restaurant groups.", why: "A second location shouldn't mean a second system." },
  {
    who: "Multi-location restaurants.",
    why: "Each location's own menu, hours and staff — one view of the business.",
  },
  {
    who: "Restaurants going direct.",
    why: "On the marketplaces today, building a direct channel for regulars.",
  },
  {
    who: "Agencies with restaurant clients.",
    why: "Every client from one login, each on its own brand.",
  },
];

const WHY = [
  {
    title: "Own the relationship.",
    copy: "Your storefront, your domain, your customer list. A direct order never passes through anyone else's brand.",
  },
  {
    title: "Run the operation.",
    copy: "Storefront, kitchen, counter and delivery work from one order record — nothing re-typed, nothing reconciled.",
  },
  {
    title: "Build the customer.",
    copy: "Loyalty points, promo codes and order history give regulars a reason to come back direct.",
  },
  {
    title: "See the business.",
    copy: "Revenue, order volume and top sellers — updated with every order, not at the end of the month.",
  },
  {
    title: "Grow without starting over.",
    copy: "Add locations, or run client restaurants as an agency. Same platform, same login.",
  },
];

/**
 * SCENE 11 — THE DECISION. Positioning as enormous typographic lines (who it's for, with an honest
 * "not the right fit" note), five plain-spoken reasons (no "powerful", no "next-generation"), and
 * the buyer FAQ — the calm, readable stretch before the ending. Scrolls normally; no pinning here.
 */
export function Decision() {
  return (
    <>
      <section
        aria-labelledby="for-title"
        className="px-5 py-28 sm:px-10 sm:py-36 lg:px-16"
        style={{ background: "#eee7d7" }}
      >
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#611b28]">
              Who it's for
            </p>
            <h2 id="for-title" className="sr-only">
              Who GarnishTable is for
            </h2>
          </Reveal>
          <ul className="m-0 mt-8 list-none p-0">
            {FOR.map((f, i) => (
              <Reveal
                as="li"
                key={f.who}
                index={i}
                variant="mask"
                className="border-t border-[#2b2116]/15 py-6"
              >
                <div className="grid items-end gap-2 lg:grid-cols-[1.5fr_1fr] lg:gap-12">
                  <span className="block pb-[0.08em] font-heading text-[9vw] font-semibold leading-[1] tracking-tight text-[#2b2116] lg:text-[4.2vw]">
                    {f.who}
                  </span>
                  <span className="block pb-1 text-[15px] leading-relaxed text-[#6b5d48] lg:text-base">
                    {f.why}
                  </span>
                </div>
              </Reveal>
            ))}
          </ul>
          <p className="mt-10 max-w-2xl border-t border-[#2b2116]/15 pt-6 text-sm leading-relaxed text-[#6b5d48]">
            <span className="font-semibold text-[#2b2116]">Probably not the right fit</span> if you
            only want a marketplace listing and won't share your own ordering link — GarnishTable
            earns its keep when customers order from you directly.
          </p>
        </div>
      </section>

      <section
        aria-labelledby="why-title"
        className="px-5 py-28 sm:px-10 sm:py-36 lg:px-16"
        style={{ background: "#0f0c0d" }}
      >
        <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#c9838d]">
              Why GarnishTable
            </p>
            <h2
              id="why-title"
              className="mt-4 font-heading text-[10vw] font-semibold leading-[0.98] tracking-tight text-[#f6f0e2] lg:text-[4vw]"
            >
              The restaurant stays <em>at the center.</em>
            </h2>
          </div>
          <ul className="m-0 list-none p-0">
            {WHY.map((w, i) => (
              <Reveal
                as="li"
                key={w.title}
                index={i}
                className="border-t border-white/10 py-9 first:border-t-0 first:pt-0"
              >
                <h3 className="font-heading text-3xl text-[#f6f0e2] sm:text-4xl">{w.title}</h3>
                <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-white/60">{w.copy}</p>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      <section
        aria-labelledby="faq-title"
        className="px-5 pb-32 sm:px-10 lg:px-16"
        style={{ background: "#0f0c0d" }}
      >
        <div className="mx-auto grid max-w-7xl gap-12 border-t border-white/10 pt-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#c9838d]">
              Questions
            </p>
            <h2
              id="faq-title"
              className="mt-4 font-heading text-[10vw] font-semibold leading-[0.98] tracking-tight text-[#f6f0e2] lg:text-[4vw]"
            >
              Before you decide.
            </h2>
            <Link
              to="/faq"
              className="mt-6 inline-block font-mono text-[11px] uppercase tracking-[0.22em] text-white/55 underline-offset-4 hover:text-white hover:underline"
            >
              All questions →
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {BUYER_FAQS.map((item, i) => (
              <FaqItem key={item.q} q={item.q} a={item.a} index={i} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
