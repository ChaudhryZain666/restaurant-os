import { Badge, Reveal } from "@restaurant/ui";
import { IconCheck } from "./icons";

// Phase 80 (content add-on) — the real, current state of each provider connection, confirmed
// directly against packages/types/src/types/marketplace.ts and each provider adapter's own
// declared `capabilities.connect`, not aspirational copy. Never presented as universally
// available self-serve — DoorDash and foodpanda explicitly are not, today.
const PROVIDERS = [
  {
    name: "Stripe",
    status: "available" as const,
    label: "Connect in minutes",
    copy: "A guided, Stripe-hosted setup — no API keys to copy, no technical steps. Your payments run through your own connected account.",
  },
  {
    name: "Uber Eats",
    status: "connect" as const,
    label: "Connect your account",
    copy: "A real account-connection flow — sign in with Uber Eats and authorize the connection, the same way you'd connect any other app.",
  },
  {
    name: "DoorDash",
    status: "soon" as const,
    label: "Coming soon",
    copy: "A self-serve connection is on the way. We'll notify you the moment it's ready for your restaurant.",
  },
  {
    name: "foodpanda",
    status: "managed" as const,
    label: "Set up by our team",
    copy: "foodpanda doesn't offer an individual sign-in step — our team completes this connection on your behalf once it's ready.",
  },
];

const STATUS_TONE: Record<(typeof PROVIDERS)[number]["status"], "success" | "warning" | "info"> = {
  available: "success",
  connect: "success",
  soon: "warning",
  managed: "info",
};

/**
 * Phase 80 (content add-on) — kept deliberately clean and honest per the brief: this is not a
 * "connect anything instantly" claim. Each card states plainly what actually happens today.
 *
 * `-fixed` tokens throughout, same reason as every other new light section on this page (see
 * WhatIsGarnishTable.tsx). `text-success` has no `-fixed` counterpart in index.css's token set —
 * hardcoded to the real `:root` light-mode success green directly, matching this codebase's own
 * established fallback pattern (WhyUseful.tsx's literal muted-brown hex values) for the rare case
 * a token genuinely doesn't have a light-locked variant yet.
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

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {PROVIDERS.map((provider, i) => (
          <Reveal
            key={provider.name}
            index={i}
            className="flex flex-col gap-2 rounded-2xl border p-6"
            style={{ borderColor: "var(--gt-border-fixed)", background: "var(--gt-surface-fixed)" }}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-heading text-lg font-semibold text-[var(--gt-text-fixed)]">{provider.name}</h3>
              <Badge tone={STATUS_TONE[provider.status]}>{provider.label}</Badge>
            </div>
            <p className="text-sm text-[var(--gt-text-muted-fixed)]">{provider.copy}</p>
            {(provider.status === "available" || provider.status === "connect") && (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium" style={{ color: "#15803d" }}>
                <IconCheck className="h-3.5 w-3.5" /> Available from your dashboard
              </p>
            )}
          </Reveal>
        ))}
      </div>
    </div>
  );
}
