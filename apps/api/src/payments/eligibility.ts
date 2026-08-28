import type { PaymentProviderName } from "./index.js";

export interface EligiblePaymentProvider {
  providerName: PaymentProviderName;
  /** Display-only labels for the payment methods that provider is expected to actually route to
   *  for this country (cards vs. local rails) — informational for the frontend, never used to
   *  decide server-side eligibility itself. */
  methods: string[];
}

// Restaurant.country is free text (no ISO-3166 enum exists or is added this phase — see
// docs/payment-provider-decision.md's Phase 34 addendum), so this normalizes defensively rather
// than assuming clean data. Covers the handful of real values this codebase's own seed data and
// demo fixtures actually use ("USA", "Pakistan") plus the ISO alpha-2/alpha-3 codes a real
// restaurant's own address form might produce, without pretending to be an exhaustive gazetteer.
function normalizeCountry(country: string | null | undefined): string {
  return (country ?? "").trim().toUpperCase();
}

const PAKISTAN_ALIASES = new Set(["PK", "PAK", "PAKISTAN"]);

// Countries Stripe's own public "where you can operate" documentation excludes as of this
// adapter's writing — kept short and explicit rather than an exhaustive allowlist, since Stripe's
// supported-country list changes over time and this codebase has no live way to stay in sync with
// it. Anything NOT in this set (and not Pakistan, routed to Safepay above) is assumed
// Stripe-eligible; this is a deliberate optimistic default for a broad-coverage provider, not a
// verified-per-country claim — StripeProvider itself remains unverified against a live account
// regardless (see StripeProvider.ts's header comment).
const STRIPE_UNSUPPORTED_ALIASES = new Set(["PK", "PAK", "PAKISTAN", "IR", "IRAN", "KP", "NORTH KOREA", "SY", "SYRIA", "CU", "CUBA"]);

/**
 * Phase 34 — the country/currency payment-eligibility engine the brief asked for: given a
 * restaurant's stored country, decides which configured PaymentProvider (if any) its customers
 * should be routed to. Plain table-driven TS config, not a new Mongo model or an admin-editable
 * rules table — this phase's scope is real routing logic, not a runtime-editable rules UI (see
 * docs/payment-provider-decision.md's explicitly-deferred list). Called server-side only, from
 * payment.service.ts's createPaymentForOrder, off the restaurant's own stored `country` field —
 * never influenced by anything in the checkout request itself.
 *
 * Returns null when no configured provider is a good fit — the caller (createPaymentForOrder) must
 * treat that as "online payment isn't available for this restaurant yet," never silently fall back
 * to a provider that doesn't actually serve that market.
 */
export function resolveEligiblePaymentProvider(restaurant: { country?: string | null }): EligiblePaymentProvider | null {
  const country = normalizeCountry(restaurant.country);
  if (!country) return null; // unknown country — never guess

  if (PAKISTAN_ALIASES.has(country)) {
    return { providerName: "safepay", methods: ["card", "raast", "jazzcash", "easypaisa", "bank_transfer"] };
  }
  if (STRIPE_UNSUPPORTED_ALIASES.has(country)) return null;
  return { providerName: "stripe", methods: ["card"] };
}
