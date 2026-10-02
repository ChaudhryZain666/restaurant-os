import { useState } from "react";
import { Link } from "react-router-dom";
import { Reveal } from "@restaurant/ui";
import { usePublicPlans, formatPlanPrice, planFeatures, type PublicPlan } from "../../lib/plans";
import { ADMIN_START_URL } from "../../lib/links";

type Interval = "monthly" | "yearly";

/** Course descriptions by plan code; anything unrecognised falls back to the API's own text. */
const COURSE_COPY: Record<string, string> = {
  owner_starter:
    "One restaurant, its own ordering page, and everything to take direct orders from day one.",
  owner_growth:
    "Your own domain, business analytics and promotions — for a restaurant that's found its regulars.",
  agency_growth_v2: "Every client restaurant from one agency login, each on its own storefront.",
};
const ROMAN = ["I", "II", "III", "IV", "V"];

function cents(plan: PublicPlan, interval: Interval) {
  return plan.pricing.find((x) => x.interval === interval)?.amountCents;
}

/**
 * SCENE 10 — CHOOSE YOUR PLAN. Pricing as what a restaurant owner already reads every night: a
 * printed menu. Each plan is a "course" with a dot leader to its price, the recommendation is a
 * stamped "Chef's pick" rather than a floating badge, and a monthly/yearly switch reads both
 * prices from the live plan catalog (GET /public/plans) — nothing here is hardcoded, and the
 * "months free" figure is computed from those two real prices, never typed in.
 */
export function PlanMenu() {
  const { plans, error, retry } = usePublicPlans();
  const [interval, setInterval] = useState<Interval>("monthly");
  const sorted = [...(plans ?? [])].sort(
    (a, b) => (cents(a, "monthly") ?? Infinity) - (cents(b, "monthly") ?? Infinity)
  );
  const trialDays = sorted.find((p) => p.trialDays)?.trialDays;

  return (
    <section
      id="plans"
      aria-labelledby="plans-title"
      className="relative scroll-mt-16 px-5 py-28 sm:px-10 sm:py-36 lg:px-16"
      style={{ background: "#eee7d7" }}
    >
      <div className="mx-auto max-w-5xl">
        <Reveal className="text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#611b28]">
            Choose your plan
          </p>
          <h2
            id="plans-title"
            className="mt-4 font-heading text-[12vw] font-semibold leading-[0.95] tracking-tight text-[#2b2116] lg:text-[5.6vw]"
          >
            A menu, <em>not a maze.</em>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-[#6b5d48]">
            One subscription. 0% platform commission on direct orders — whichever plan, however many
            orders.
          </p>
        </Reveal>

        <div className="mt-12 flex justify-center">
          <div
            role="group"
            aria-label="Billing period"
            className="inline-flex rounded-pill border border-[#2b2116]/20 p-1"
          >
            {(["monthly", "yearly"] as Interval[]).map((iv) => (
              <button
                key={iv}
                type="button"
                aria-pressed={interval === iv}
                onClick={() => setInterval(iv)}
                className="rounded-pill px-5 py-2 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors"
                style={{
                  background: interval === iv ? "#2b2116" : "transparent",
                  color: interval === iv ? "#f6f0e2" : "#6b5d48",
                }}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>

        <Reveal
          className="relative mt-10 rounded-[2px] p-6 sm:p-12"
          style={{ background: "#f6f0e2", boxShadow: "0 50px 100px -50px rgba(43,33,22,0.45)" }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-3 border border-[#2b2116]/15 sm:inset-4"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-[18px] border border-[#611b28]/25 sm:inset-[22px]"
          />

          <p className="relative text-center font-mono text-[10px] uppercase tracking-[0.3em] text-[#6b5d48]">
            Table d'hôte · served with a {trialDays ?? 14}-day trial
          </p>

          {error && (
            <div className="relative mt-10 text-center">
              <p className="text-[#6b5d48]">Plans couldn't load just now.</p>
              <button type="button" onClick={retry} className="mt-3 underline underline-offset-4">
                Try again
              </button>
            </div>
          )}

          {!plans && !error && (
            <ul className="relative m-0 mt-10 list-none p-0" aria-label="Loading plans">
              {[0, 1, 2].map((i) => (
                <li key={i} className="h-24 border-b border-[#2b2116]/10 last:border-b-0">
                  <div className="mt-8 h-4 w-2/3 animate-pulse rounded bg-[#2b2116]/10" />
                </li>
              ))}
            </ul>
          )}

          {plans && (
            <ol className="relative m-0 mt-8 list-none p-0">
              {sorted.map((plan, i) => {
                const pick = plan.code === "owner_growth";
                const price = formatPlanPrice(plan.pricing, interval);
                const m = cents(plan, "monthly");
                const y = cents(plan, "yearly");
                const monthsFree = m && y ? Math.round(12 - y / m) : 0;
                const features = planFeatures(plan).filter((f) => !/free trial/i.test(f));
                const href = plan.type === "AGENCY" ? ADMIN_START_URL : "/start-trial";
                return (
                  <li
                    key={plan.code}
                    className="relative grid gap-4 border-b border-[#2b2116]/15 py-9 last:border-b-0 lg:grid-cols-[1fr_auto] lg:gap-10"
                  >
                    {pick && (
                      <span
                        aria-hidden
                        className="absolute -left-2 top-6 hidden h-16 w-16 -rotate-12 items-center justify-center rounded-full border-2 border-[#87652a] text-center font-mono text-[8px] uppercase leading-tight tracking-wider text-[#87652a] sm:flex"
                      >
                        Chef's
                        <br />
                        pick
                      </span>
                    )}
                    <div className="sm:pl-20">
                      <div className="flex items-baseline gap-3">
                        <span className="font-heading text-sm italic text-[#6b5d48]">
                          {ROMAN[i]}.
                        </span>
                        <h3
                          className="font-heading text-2xl italic sm:text-3xl"
                          style={{ color: pick ? "#611b28" : "#2b2116" }}
                        >
                          {plan.name}
                        </h3>
                        <span
                          aria-hidden
                          className="mb-2 hidden flex-1 border-b border-dotted border-[#2b2116]/35 sm:block"
                        />
                        <span
                          className="ml-auto whitespace-nowrap font-heading text-3xl sm:ml-0 sm:text-4xl"
                          style={{ color: pick ? "#611b28" : "#2b2116" }}
                        >
                          {price ?? "—"}
                          <span className="font-sans text-sm text-[#6b5d48]">
                            {interval === "monthly" ? " /mo" : " /yr"}
                          </span>
                        </span>
                      </div>
                      {pick && (
                        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-[#87652a] sm:hidden">
                          Chef's pick
                        </p>
                      )}
                      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#6b5d48]">
                        {COURSE_COPY[plan.code] ?? plan.description}
                      </p>
                      <p className="mt-3 text-[13px] text-[#2b2116]/80">{features.join("  ·  ")}</p>
                      {interval === "yearly" && monthsFree > 0 && (
                        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#611b28]">
                          Yearly ≈ {monthsFree} months free
                        </p>
                      )}
                    </div>
                    <div className="flex items-end sm:pl-20 lg:pl-0">
                      {plan.type === "AGENCY" ? (
                        <a
                          href={href}
                          className="inline-flex h-11 items-center rounded-pill border border-[#2b2116]/30 px-5 text-sm font-medium text-[#2b2116] transition-colors hover:bg-[#2b2116]/5"
                        >
                          Start an agency
                        </a>
                      ) : (
                        <Link
                          to={href}
                          className="inline-flex h-11 items-center rounded-pill px-5 text-sm font-medium transition-colors"
                          style={
                            pick
                              ? { background: "#611b28", color: "#f6f0e2" }
                              : { border: "1px solid rgba(43,33,22,0.3)", color: "#2b2116" }
                          }
                        >
                          Start your restaurant
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Reveal>

        <p className="mt-8 text-center text-sm text-[#6b5d48]">
          Card payments run on your own Stripe account, so Stripe's standard processing fee applies.{" "}
          <Link to="/pricing" className="underline underline-offset-4 hover:text-[#2b2116]">
            Full pricing details
          </Link>
        </p>
      </div>
    </section>
  );
}
