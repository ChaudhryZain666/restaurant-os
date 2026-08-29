import { env } from "../config/env.js";

const BASE_URL = "https://api.stripe.com";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Phase 37 — Stripe Connect account management: creating a connected account, generating a
 * hosted-onboarding Account Link, and retrieving an account's current real capability status.
 * Deliberately separate from StripeProvider.ts (payment execution: checkout/retrieve/refund) —
 * different concern, different auth shape (these calls always use the PLATFORM's own
 * STRIPE_SECRET_KEY, never a restaurant's credentials or a Stripe-Account header), and small
 * enough that sharing a base class would cost more clarity than it saves, matching this
 * codebase's existing precedent (see business.controller.ts's createLocationForBusiness comment
 * on the same tradeoff).
 *
 * Architecture chosen after reading Stripe's current official docs directly (docs.stripe.com,
 * fetched live, not recalled from memory) — see the Phase 37 report for citations:
 *  - v1 Standard connected accounts + Direct Charges, NOT the Accounts v2 "Merchant configuration"
 *    API — v2's own current docs pin its onboarding endpoint to a "2026-08-26.preview" API
 *    version; building real financial infrastructure against a preview surface isn't warranted
 *    when v1 Standard accounts are fully GA, stable, and explicitly named by Stripe as the fit for
 *    "SaaS platforms."
 *  - Account Links (`POST /v1/account_links`, `type=account_onboarding`) for hosted onboarding —
 *    NOT the OAuth authorize-redirect flow. OAuth remains available for Standard accounts but
 *    isn't the primary recommended path for a new integration; Account Links achieves the exact
 *    same goal (never touching the restaurant's own secret key) with Stripe-hosted,
 *    auto-updating-for-compliance onboarding.
 *  - Direct Charges: once onboarded, every payment/refund/retrieve call uses the PLATFORM's own
 *    secret key plus a `Stripe-Account: {connectedAccountId}` header (StripeProvider.ts) — the
 *    restaurant's own Stripe secret key is never collected, transmitted to us, or stored, at any
 *    point in this flow.
 */

interface StripeAccount {
  id?: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  requirements?: {
    currently_due?: string[];
    disabled_reason?: string | null;
  };
}

interface StripeAccountLink {
  url?: string;
  expires_at?: number;
}

async function request<T>(method: "GET" | "POST", path: string, form?: Record<string, unknown>): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured on this deployment");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      },
      body: form ? new URLSearchParams(form as Record<string, string>).toString() : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("Stripe request timed out");
    throw new Error(`Could not reach Stripe: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Stripe returned an unreadable response (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const message = (json as { error?: { message?: string } })?.error?.message;
    throw new Error(`Stripe returned HTTP ${res.status}${message ? `: ${message}` : ""}`);
  }
  return json as T;
}

/** Creates a new Standard connected account for a restaurant that has never connected before.
 *  `country` can't be changed after creation — resolved from the restaurant's own stored country,
 *  never trusted from the client request body. */
export async function createConnectedAccount(country: string, email: string): Promise<string> {
  const account = await request<StripeAccount>("POST", "/v1/accounts", { type: "standard", country, email });
  if (!account.id) throw new Error("Stripe did not return an account id");
  return account.id;
}

/** A single-use, ~5-minute-lived hosted-onboarding URL. `refresh_url` and `return_url` must be
 *  real https URLs (even in local dev, per Stripe's own requirement) — the caller resolves both
 *  from env.ADMIN_ORIGIN, never from client input, so an attacker can't redirect a restaurant
 *  owner's Stripe onboarding flow to an arbitrary host. */
export async function createAccountLink(connectedAccountId: string, refreshUrl: string, returnUrl: string): Promise<string> {
  const link = await request<StripeAccountLink>("POST", "/v1/account_links", {
    account: connectedAccountId,
    type: "account_onboarding",
    refresh_url: refreshUrl,
    return_url: returnUrl,
  });
  if (!link.url) throw new Error("Stripe did not return an account link url");
  return link.url;
}

export interface ConnectedAccountStatus {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsDue: string[];
  disabledReason: string | null;
}

/** The real source of truth for whether a connected account can actually process payments —
 *  never inferred from "the owner completed the redirect," which per Stripe's own docs only means
 *  "the flow was entered and exited properly," not that every requirement was satisfied. */
export async function retrieveConnectedAccountStatus(connectedAccountId: string): Promise<ConnectedAccountStatus> {
  const account = await request<StripeAccount>("GET", `/v1/accounts/${connectedAccountId}`);
  return {
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    requirementsDue: account.requirements?.currently_due ?? [],
    disabledReason: account.requirements?.disabled_reason ?? null,
  };
}

/** Interprets `account.updated`'s own event payload the exact same shape retrieveConnectedAccountStatus
 *  parses from a direct GET — shared so the centralized webhook handler (paymentWebhook.controller.ts's
 *  handleStripeConnectWebhook) and the return_url sync endpoint (restaurantPaymentAccount.controller.ts's
 *  syncStripeConnectStatus) never drift into two different interpretations of the same facts. */
export function parseAccountEventObject(raw: unknown): ConnectedAccountStatus {
  const account = (raw ?? {}) as StripeAccount;
  return {
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    requirementsDue: account.requirements?.currently_due ?? [],
    disabledReason: account.requirements?.disabled_reason ?? null,
  };
}

/** The single mapping from Stripe's real facts to this platform's own status enum — "active" only
 *  when charges are genuinely enabled; "invalid" only for an explicit rejection; everything else
 *  (onboarding incomplete, a new requirement appeared) is "action_required", never a bare
 *  "connected" that would overstate readiness. */
export function resolveConnectAccountStatus(status: ConnectedAccountStatus): "active" | "action_required" | "invalid" {
  if (status.chargesEnabled) return "active";
  if (status.disabledReason?.startsWith("rejected")) return "invalid";
  return "action_required";
}
