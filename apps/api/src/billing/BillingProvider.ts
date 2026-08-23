export interface CreateBillingCustomerInput {
  ownerType: "business" | "agency";
  ownerId: string;
  email: string;
  name: string;
}

export interface ProviderBillingCustomer {
  providerCustomerId: string;
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

export interface ProviderBillingWebhookEvent {
  eventId: string;
  eventType: string;
  providerSubscriptionId: string;
  status: ProviderSubscriptionStatus;
  raw: unknown;
}

/**
 * Provider-agnostic platform-BILLING capability surface — deliberately separate from
 * apps/api/src/payments/PaymentProvider.ts. Customer order payments and platform subscription
 * billing are different financial domains with different lifecycles, different webhook streams,
 * and different idempotency stores (BillingWebhookEvent vs PaymentWebhookEvent); mixing them would
 * make either one harder to reason about safely. Only the operations this phase's lifecycle
 * actually needs are here — no real provider is integrated (see MockBillingProvider.ts, the only
 * adapter that runs today). A real adapter would implement this same interface; see
 * apps/api/src/payments/SafepayProvider.ts's header comment for the level of verification a real
 * financial adapter needs before it can be trusted, as the precedent for what NOT to skip.
 */
export interface BillingProvider {
  readonly name: string;
  readonly signatureHeaderName: string;
  createCustomer(input: CreateBillingCustomerInput): Promise<ProviderBillingCustomer>;
  createSubscription(input: CreateProviderSubscriptionInput): Promise<ProviderSubscriptionSnapshot>;
  retrieveSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionSnapshot>;
  cancelSubscription(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<ProviderSubscriptionSnapshot>;
  changePlan(providerSubscriptionId: string, newPlanCode: string): Promise<ProviderSubscriptionSnapshot>;
  /** Returns the parsed, verified event, or null if the signature doesn't check out. */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): ProviderBillingWebhookEvent | null;
}
