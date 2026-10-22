export interface CreateBillingCustomerInput {
  ownerType: "business" | "agency";
  ownerId: string;
  email: string;
  name: string;
}

export interface ProviderBillingCustomer {
  providerCustomerId: string;
  email?: string;
  name?: string;
}

export interface CreateProviderSubscriptionInput {
  providerCustomerId: string;
  planCode: string;
  billingInterval: "monthly" | "yearly";
  /** Absent means no trial — the caller (subscription.service.ts) decides trial length from
   *  configuration, never a value invented in this interface. */
  trialDays?: number;
}

/** Provider-side status vocabulary is deliberately smaller than our own SubscriptionStatus:
 *  "cancelling" (scheduled, not yet effective) and "expired" (a trial that never converted) are
 *  business-side interpretations layered on top of what a provider actually reports, not states a
 *  provider itself needs to track — see subscriptionStateMachine.ts. */
export type ProviderSubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled";

export interface ProviderSubscriptionSnapshot {
  providerSubscriptionId: string;
  status: ProviderSubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEnd?: Date;
}

/**
 * Phase 27 — everything a checkout-launch endpoint needs to hand the frontend, normalized across
 * two real shapes a provider might use: a redirect-based hosted checkout page (`url`), or a
 * client-side overlay widget the provider's own JS SDK renders (`clientToken` + `providerPriceId`,
 * e.g. Paddle.js's `Paddle.Checkout.open(...)`). Exactly one of `url`/`clientToken` is meaningful,
 * selected by `mode` — callers must not assume both are present.
 */
export type ProviderCheckoutMode = "overlay" | "redirect";

export interface CreateCheckoutSessionInput {
  providerCustomerId: string;
  providerPriceId: string;
  /** Opaque data threaded back to us on the eventual webhook (Paddle's "custom data" concept) —
   *  how a checkout-creation event gets matched to the owner that initiated it, since no
   *  providerSubscriptionId exists until the provider creates one on successful payment. */
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
}

export interface ProviderCheckoutSession {
  mode: ProviderCheckoutMode;
  /** Present when mode === "redirect". */
  url?: string;
  /** Present when mode === "overlay" — the provider's own PUBLIC, per-environment client-side
   *  token (e.g. Paddle.js's Paddle.Initialize({token})), never a per-customer or secret value.
   *  Phase 40 — corrected from an earlier bug that returned providerCustomerId here instead. */
  clientToken?: string;
  providerPriceId?: string;
  /** Present when mode === "overlay" — the provider's own customer reference, which the frontend's
   *  SDK needs separately from clientToken to associate the checkout with the right customer
   *  (e.g. Paddle.Checkout.open({customer: {id: providerCustomerId}, ...})). */
  providerCustomerId?: string;
  /** Phase 85A — present when mode === "overlay": which of the provider's environments this
   *  session (and clientToken) belongs to, so the frontend SDK is initialised for the same one
   *  (Paddle.Environment.set). Derived server-side from the API host actually being called — never
   *  defaulted by the frontend. */
  environment?: "sandbox" | "production";
}

export interface ProviderInvoice {
  providerInvoiceId: string;
  status: "paid" | "pending" | "failed";
  amountCents: number;
  currency: string;
  /** The provider's own hosted invoice/receipt page — see docs/commercial-decisions.md's "Invoice
   *  policy" section for why this platform doesn't generate its own PDF invoices when the provider
   *  (a Merchant of Record) already issues a compliant one. */
  hostedUrl?: string;
  issuedAt: Date;
}

/** Phase 89 — a money movement a webhook reports that is NOT a subscription status change: a
 *  renewal charge, a refund, or a chargeback. Recorded in billing history only — never changes a
 *  subscription's status or access (see processBillingProviderEvent). */
export interface ProviderBillingNotice {
  type: "payment_succeeded" | "refunded" | "chargeback" | "chargeback_reversed";
  amountCents?: number;
  currency?: string;
  /** The provider's own reference (e.g. a Paddle transaction or adjustment id). */
  reference?: string;
}

export interface ProviderBillingWebhookEvent {
  eventId: string;
  eventType: string;
  /** Empty when the event isn't about any subscription (acknowledged, nothing to do). */
  providerSubscriptionId: string;
  /** Phase 89 — present ONLY on events that genuinely report a subscription's own status. Absent on
   *  transaction/adjustment events, which never move a subscription's status: a transaction's
   *  "completed" is not a subscription status, and reading it as one marked a paying subscription
   *  past_due. */
  status?: ProviderSubscriptionStatus;
  /** When the provider says this event happened — orders period/plan updates (see
   *  Subscription.lastProviderEventAt). Absent when the provider doesn't say. */
  occurredAt?: Date;
  /** Phase 89 — the subscription's current billing period, when the event carries it (renewals
   *  move it forward). */
  currentPeriod?: { start: Date; end: Date };
  /** Phase 89 — a scheduled cancellation's effective date; null means the event says none is
   *  scheduled; undefined means the event doesn't say. */
  scheduledCancelAt?: Date | null;
  /** Phase 89 — the provider price the subscription is on now, so a plan change made outside this
   *  app (e.g. in the provider's dashboard) is reflected locally. */
  providerPriceId?: string;
  billingNotice?: ProviderBillingNotice;
  /** Phase 89 — true when the provider says this is a test notification from its webhook simulator
   *  rather than something that happened to a real subscription. Set by the adapter only from the
   *  signature-verified payload. Such events are acknowledged and recorded, never applied. */
  simulated?: boolean;
  raw: unknown;
  /**
   * Phase 27 — present ONLY on a checkout-completion event (a brand-new subscription being
   * reported for the very first time, born from createCheckoutSession rather than
   * createSubscription). Carries back exactly the metadata createCheckoutSession's caller passed
   * in, so processBillingProviderEvent can create a new Subscription document for the right owner
   * without ever having to trust anything the frontend claims. Absent on every ordinary
   * status-transition event for an already-existing subscription.
   */
  checkoutMetadata?: {
    ownerType: "business" | "agency";
    ownerId: string;
    planCode: string;
    billingInterval: "monthly" | "yearly";
    providerCustomerId: string;
  };
}

/**
 * Provider-agnostic platform-BILLING capability surface — deliberately separate from
 * apps/api/src/payments/PaymentProvider.ts. Customer order payments and platform subscription
 * billing are different financial domains with different lifecycles, different webhook streams,
 * and different idempotency stores (BillingWebhookEvent vs PaymentWebhookEvent); mixing them would
 * make either one harder to reason about safely. Two adapters implement this today:
 * MockBillingProvider.ts (the only one that actually runs in tests/local dev) and
 * PaddleBillingProvider.ts (Phase 27 — real, network-capable code against Paddle's documented
 * Billing API, but never exercised against a live account; see that file's header comment for
 * exactly what's verified vs. assumed, mirroring apps/api/src/payments/SafepayProvider.ts's own
 * honesty precedent).
 */
export interface BillingProvider {
  readonly name: string;
  readonly signatureHeaderName: string;
  createCustomer(input: CreateBillingCustomerInput): Promise<ProviderBillingCustomer>;
  retrieveCustomer(providerCustomerId: string): Promise<ProviderBillingCustomer>;
  createSubscription(input: CreateProviderSubscriptionInput): Promise<ProviderSubscriptionSnapshot>;
  retrieveSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionSnapshot>;
  cancelSubscription(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<ProviderSubscriptionSnapshot>;
  /** Un-cancels a scheduled (not yet effective) cancellation. */
  reactivateSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionSnapshot>;
  /** Phase 89 — takes the provider's own PRICE id for the new plan and the subscription's billing
   *  interval (Plan.pricing[].providerPriceId), never a local plan code: the provider has no idea
   *  what "owner_growth" means. */
  changePlan(providerSubscriptionId: string, newProviderPriceId: string): Promise<ProviderSubscriptionSnapshot>;
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<ProviderCheckoutSession>;
  /** Null if the provider has no record of this invoice reference. */
  retrieveInvoice(providerInvoiceId: string): Promise<ProviderInvoice | null>;
  /** Phase 85A — a provider-hosted page where the customer updates the card on a subscription
   *  (e.g. after a failed renewal). Short-lived, so it's fetched on demand and never stored. Null
   *  when the provider has no such page for this subscription. */
  getPaymentMethodUpdateUrl(providerSubscriptionId: string): Promise<string | null>;
  /** Returns the parsed, verified event, or null if the signature doesn't check out. */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): ProviderBillingWebhookEvent | null;
}
