import { Reveal } from "@restaurant/ui";

// Phase 80 (content add-on) — the real, current state of each provider connection, confirmed
// directly against packages/types/src/types/marketplace.ts and each provider adapter's own
// declared `capabilities.connect`, not aspirational copy. Never presented as universally
// available self-serve — DoorDash and foodpanda explicitly are not, today.
const PROVIDERS = [
  {
    name: "Stripe",
    live: true,
    label: "Connect in minutes",
    copy: "A guided, Stripe-hosted setup — no API keys to copy, no technical steps. Your payments run through your own connected account.",
  },
  {
    name: "Uber Eats",
    live: true,
    label: "Connect your account",
    copy: "A real account-connection flow — sign in with Uber Eats and authorize the connection, the same way you'd connect any other app.",
  },
  {
    name: "DoorDash",
    live: false,
    label: "Coming soon",
    copy: "A self-serve connection is on the way. We'll notify you the moment it's ready for your restaurant.",
  },
  {
    name: "foodpanda",
    live: false,
    label: "Set up by our team",
    copy: "foodpanda doesn't offer an individual sign-in step — our team completes this connection on your behalf once it's ready.",
  },
];

/**
 * Phase 80 (content add-on) — kept deliberately clean and honest per the brief: this is not a
 * "connect anything instantly" claim. Each card states plainly what actually happens today. The
 * distinction between what's live and what isn't is now carried by the cards' own visual weight
 * (solid vs. dashed, a status dot rather than a stock colored badge) rather than a generic
 * green/yellow/blue pill, so it reads as a deliberate, editorial status report, not a UI kit demo.
 *
 * `-fixed` tokens throughout, same reason as every other new light section on this page (see
 * WhatIsGarnishTable.tsx).
 */
export function IntegrationsSection() {
  return (
    <div id="integrations" className="mx-auto max-w-5xl scroll-mt-24">
      <Reveal className="mx-auto max-w-2xl text-center">
        <span className="text-sm font-semibold uppercase tracking-wide text-[var(--gt-brand-fixed)]">Integrations</span>
        <h2 className="mt-3 font-heading text-3xl font-semibold text-[var(--gt-text-fixed)] sm:text-4xl">
          Connect the tools your restaurant already uses
        </h2>
        <p className="mt-4 text-[var(--gt-text-muted-fixed)]">
          Payments and delivery marketplaces, connected through the setup each provider actually supports —
          nothing here is faked as instant when it isn't.
        </p>
      </Reveal>

      <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {PROVIDERS.map((provider, i) => (
          <Reveal
            key={provider.name}
            index={i}
            className="flex flex-col gap-3 rounded-2xl p-7"
            style={{
              border: provider.live ? "1px solid var(--gt-border-fixed)" : "1px dashed var(--gt-border-fixed)",
              background: provider.live ? "var(--gt-surface-fixed)" : "transparent",
              boxShadow: provider.live ? "0 12px 32px -20px rgba(43,33,22,0.35)" : "none",
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-heading text-xl font-semibold text-[var(--gt-text-fixed)]">{provider.name}</h3>
              <span
                className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide"
                style={{ color: provider.live ? "#15803d" : "var(--gt-text-muted-fixed)" }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: provider.live ? "#15803d" : "var(--gt-text-muted-fixed)" }}
                  aria-hidden
                />
                {provider.label}
              </span>
            </div>
            <p className="text-sm text-[var(--gt-text-muted-fixed)]">{provider.copy}</p>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
