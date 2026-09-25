import { Link } from "react-router-dom";
import { Reveal } from "@restaurant/ui";
import { IconArrowRight, IconMapPin, IconStore, IconUsers } from "./icons";
import { ADMIN_START_URL } from "../lib/links";

// Phase 80 note: the shared <Button variant="outline"> reaches for `border-border`/`text-foreground`
// internally (packages/ui/src/Button.tsx) — theme-relative classes that break the same way inside
// this section's `.theme-obsidian`-nested light ground. None of the pre-existing light chapters
// (ScaleSelector/WhyUseful/WhatWeReplace) use the shared Button for this exact reason; this matches
// that established precedent instead of fighting the shared component's className precedence.
const fixedOutlineButtonClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-pill border px-5 py-2.5 text-sm font-medium transition-colors duration-150 sm:w-auto";

const PATHS = [
  {
    icon: IconStore,
    eyebrow: "For restaurant owners",
    title: "Run one restaurant, your way",
    copy: "Launch your own branded ordering page, take direct orders, and manage the day-to-day from one dashboard — no marketplace listing in between you and your customers.",
    cta: "Start your restaurant",
    to: "/start-trial",
    external: false,
  },
  {
    icon: IconMapPin,
    eyebrow: "For growing restaurant groups",
    title: "Scale without losing your identity",
    copy: "Add locations under one account without turning every location into a copy of the others — centralized control, with each location's own menu, hours and settings.",
    cta: "See multi-location",
    to: "/solutions#growing",
    external: false,
  },
  {
    icon: IconUsers,
    eyebrow: "For agencies",
    title: "One login, every client's business",
    copy: "Manage every restaurant client you work with from a single agency account — each with its own storefront, staff and owner, under consolidated billing.",
    cta: "Explore for agencies",
    to: ADMIN_START_URL,
    external: true,
  },
];

/**
 * Phase 80 (content add-on) — a dedicated "who is this for" moment, replacing the previous
 * pattern of leaving agency/multi-location context scattered across the Solutions dropdown, the
 * FAQ, and the Start Trial page's own owner/agency fork. All three destinations here are real,
 * existing routes/CTAs (Solutions#growing and #agencies already exist and are already linked from
 * Nav.tsx; ADMIN_START_URL is the same real agency-signup destination StartTrialPage.tsx's own
 * "Running an agency?" CTA already uses) — nothing here routes anywhere invented.
 *
 * Uses the `-fixed` token set throughout — see WhatIsGarnishTable.tsx's comment for why: this
 * section's own parchment ground sits inside the page's one outer `.theme-obsidian` wrapper, so
 * the theme-relative `text-foreground`/`text-muted`/`text-primary`/`bg-surface`/`border-border`
 * classes would silently resolve to their dark-canvas meaning here.
 */
export function WhoIsItFor() {
  return (
    <div className="mx-auto max-w-6xl">
      <Reveal className="mx-auto max-w-2xl text-center">
        <span className="text-sm font-semibold uppercase tracking-wide text-[var(--gt-brand-fixed)]">Who it's for</span>
        <h2 className="mt-3 font-heading text-3xl font-semibold text-[var(--gt-text-fixed)] sm:text-4xl">
          Built for how you actually run restaurants
        </h2>
        <p className="mt-4 text-[var(--gt-text-muted-fixed)]">
          Whether you run one restaurant, a growing group of locations, or manage restaurant clients for a living,
          GarnishTable is built around that shape of business — not retrofitted onto it.
        </p>
      </Reveal>

      <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {PATHS.map((path, i) => (
          <Reveal
            key={path.title}
            index={i}
            className="flex flex-col gap-4 rounded-2xl border p-7"
            style={{ borderColor: "var(--gt-border-fixed)", background: "var(--gt-surface-fixed)" }}
          >
            <span
              className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--gt-brand-fixed)]"
              style={{ backgroundColor: "color-mix(in srgb, var(--gt-brand-fixed) 10%, transparent)" }}
            >
              <path.icon className="h-5 w-5" />
            </span>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--gt-text-muted-fixed)]">{path.eyebrow}</span>
              <h3 className="mt-1.5 font-heading text-xl font-semibold text-[var(--gt-text-fixed)]">{path.title}</h3>
              <p className="mt-2 text-sm text-[var(--gt-text-muted-fixed)]">{path.copy}</p>
            </div>
            <div className="mt-auto pt-2">
              {path.external ? (
                <a
                  href={path.to}
                  className={fixedOutlineButtonClass}
                  style={{ borderColor: "var(--gt-border-fixed)", color: "var(--gt-text-fixed)" }}
                >
                  {path.cta} <IconArrowRight className="h-4 w-4" />
                </a>
              ) : (
                <Link
                  to={path.to}
                  className={fixedOutlineButtonClass}
                  style={{ borderColor: "var(--gt-border-fixed)", color: "var(--gt-text-fixed)" }}
                >
                  {path.cta} <IconArrowRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
