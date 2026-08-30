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

export interface ProviderBillingWebhookEvent {
  eventId: string;
  eventType: string;
  providerSubscriptionId: string;
  status: ProviderSubscriptionStatus;
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
  changePlan(providerSubscriptionId: string, newPlanCode: string): Promise<ProviderSubscriptionSnapshot>;
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<ProviderCheckoutSession>;
  /** Null if the provider has no record of this invoice reference. */
  retrieveInvoice(providerInvoiceId: string): Promise<ProviderInvoice | null>;
  /** Returns the parsed, verified event, or null if the signature doesn't check out. */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): ProviderBillingWebhookEvent | null;
}
