import { Link } from "react-router-dom";
import { Reveal } from "@restaurant/ui";

const STEPS = [
  {
    title: "Your own branded ordering page",
    copy: "Your name, logo, colours and menu on an ordering page that belongs to your restaurant, not a marketplace listing. Share the link on Google, your website, social media and table QR codes.",
  },
  {
    title: "Customers browse and order",
    copy: "Customers pick items and options such as size or extras, add a note for anything special, and choose pickup, your own delivery or table service. No app to download.",
  },
  {
    title: "Orders arrive in one dashboard",
    copy: "Every order lands in one live list with its items, options and notes. Staff accept it, mark it preparing and ready, and complete it. The kitchen gets its own board.",
  },
  {
    title: "Pickup and your own delivery",
    copy: "Switch pickup and delivery on separately. For delivery, your drivers go out with your fee, minimum order and radius. Customers pay you directly at pickup, on delivery or at the table.",
  },
];

/**
 * The plain-language explainer: what GarnishTable does, in four steps, with links to the pages
 * that go deeper. Placed before The Decision so the film ends on facts a restaurant owner can
 * check. Every claim here is a shipped feature (see lib/content.ts's FAQS).
 */
export function HowOrderingWorks() {
  return (
    <section aria-labelledby="how-ordering-works" className="px-5 py-24 sm:px-10 sm:py-28 lg:px-16" style={{ background: "#f6f0e2" }}>
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#8a3a46]">How it works</p>
          <h2 id="how-ordering-works" className="mt-4 max-w-3xl font-heading text-4xl font-semibold leading-tight tracking-tight text-[#2b2116] sm:text-5xl">
            How restaurant online ordering works with GarnishTable
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-[#4a3d2c]">
            A flat monthly subscription, no commission per order, and a 14-day free trial with no card needed to start.
          </p>
        </Reveal>
        <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.title} index={i} className="flex flex-col gap-3 rounded-2xl border border-[#2b2116]/10 bg-white/60 p-6">
              <span className="font-mono text-xs text-[#8a3a46]">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="font-heading text-xl font-semibold text-[#2b2116]">{s.title}</h3>
              <p className="text-sm leading-relaxed text-[#4a3d2c]">{s.copy}</p>
            </Reveal>
          ))}
        </ol>
        <p className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-[#2b2116]">
          <Link to="/how-it-works" className="underline underline-offset-4 hover:text-[#8a3a46]">See the setup steps</Link>
          <Link to="/product" className="underline underline-offset-4 hover:text-[#8a3a46]">Explore every feature</Link>
          <Link to="/pricing" className="underline underline-offset-4 hover:text-[#8a3a46]">Compare plans and prices</Link>
          <Link to="/guides" className="underline underline-offset-4 hover:text-[#8a3a46]">Read the restaurant guides</Link>
          <Link to="/faq" className="underline underline-offset-4 hover:text-[#8a3a46]">Read the FAQ</Link>
        </p>
      </div>
    </section>
  );
}
