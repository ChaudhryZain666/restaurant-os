import type { BillingInterval } from "./plan.js";

/**
 * Phase 24 — a Subscription attaches to a polymorphic `{ownerType, ownerId}` pair, never directly
 * to Restaurant/Location and never hard-coded to Business either. Today only `"business"` is
 * reachable through any real code path (no Agency collection exists yet — deferred to Phase 25);
 * `"agency"` is a reserved, forward-compatible slot so Phase 25 only needs to add the Agency model
 * and start creating `ownerType: "agency"` subscriptions through this same, unchanged type/service
 * layer. See docs/multi-tenant-storefront-architecture.md's Phase 24 section for the full reasoning.
 */
export type SubscriptionOwnerType = "business" | "agency";

/**
 * All six states serve a distinct purpose — see subscriptionStateMachine.ts for the exact valid
 * transitions. `expired` (trial ended without converting) is kept distinct from `cancelled` (a
 * real subscription was actually cancelled) since they mean different things to an owner and to
 * future analytics. `cancelled`/`expired` are terminal — a new Subscription document is created to
 * resubscribe, never a resurrected old one.
 */
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelling" | "cancelled" | "expired";

/**
 * `"internal"` is not a real billing provider — it marks a platform-granted subscription with no
 * real payment relationship (grandfathered pre-existing businesses migrated before this phase
 * existed; future comps). It exists so that state is always explicit and auditable, never a silent
 * bypass of subscription checks. `"paddle"` (Phase 27) is the real, provider-agnostic-interface
 * adapter — see apps/api/src/billing/PaddleBillingProvider.ts's header comment for exactly what's
 * verified vs. assumed; it has never been exercised against a live Paddle account in this
 * environment, mirroring apps/api/src/payments/SafepayProvider.ts's own honesty precedent.
 */
export type SubscriptionProvider = "mock" | "internal" | "paddle" | "lemonsqueezy" | "manual";

/**
 * `provider: "manual"` — a subscription a platform admin set up directly (no checkout, no billing
 * provider behind it). Unlike "internal" it IS enforced like any other plan: its plan's
 * entitlements apply and it stops being live at `currentPeriodEnd` unless extended. No billing
 * provider is ever called for it and no payment is ever recorded for it.
 *  - "complimentary": free — agreed price 0.
 *  - "offline": paid outside GarnishTable (invoice, bank transfer) at the agreed price, which may be
 *    a custom negotiated one. GarnishTable records the agreement, never a payment.
 */
export type ManualBillingKind = "complimentary" | "offline";

export interface ManualBillingTerms {
  kind: ManualBillingKind;
  /** The agreed price per billing interval, in cents (0 for complimentary). Not a payment. */
  amountCents: number;
  currency: string;
  note?: string;
}

export interface Subscription {
  id: string;
  ownerType: SubscriptionOwnerType;
  ownerId: string;
  planId: string;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialStart?: string;
  trialEnd?: string;
  /** Scheduled cancellation timestamp — set while `status` is `"cancelling"`, effective at
   *  `currentPeriodEnd`. */
  cancelAt?: string;
  /** When cancellation actually took effect (status became `"cancelled"`). */
  cancelledAt?: string;
  provider: SubscriptionProvider;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  /** Present only on provider:"manual" subscriptions. */
  manualBilling?: ManualBillingTerms;
  /** A platform admin suspended this (manual) subscription: not live until unsuspended. */
  suspendedAt?: string;
  suspendedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionWithPlan extends Subscription {
  plan: Pick<import("./plan.js").Plan, "id" | "code" | "name" | "type" | "pricing" | "entitlements">;
}
