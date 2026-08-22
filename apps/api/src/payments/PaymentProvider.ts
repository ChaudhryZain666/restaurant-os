export interface CreateIntentInput {
  amount: number;
  currency: string;
  orderId: string;
  restaurantId: string;
  metadata?: Record<string, string>;
}

export type ProviderPaymentStatus = "pending" | "requires_action" | "authorized" | "paid" | "failed" | "cancelled";

export interface ProviderIntent {
  providerRef: string;
  status: ProviderPaymentStatus;
  /** Opaque token a real provider's client-side SDK would use to collect payment details. Never
   *  persisted server-side beyond the response that hands it to the frontend. */
  clientSecret?: string;
}

export interface ProviderPaymentSnapshot {
  providerRef: string;
  status: ProviderPaymentStatus;
  amount: number;
  currency: string;
  raw: unknown;
}

export interface ProviderWebhookEvent {
  eventId: string;
  eventType: string;
  providerRef: string;
  status: ProviderPaymentStatus;
  raw: unknown;
}

export interface ProviderRefundResult {
  refundRef: string;
  status: "pending" | "succeeded" | "failed";
}

/**
 * Provider-agnostic capability surface. PaymentService and every controller talk only to this
 * interface, never to a concrete provider SDK — provider-specific code stays isolated inside one
 * adapter file. See docs/payment-provider-decision.md for which real provider this platform's
 * market points to and why no adapter for it exists yet (no credentials, unverified against a
 * real sandbox), and MockPaymentProvider.ts for the only adapter that actually runs today.
 */
export interface PaymentProvider {
  readonly name: string;
  /** The HTTP header a webhook request from this provider carries its signature in — different
   *  providers use different header names, so the webhook controller reads whichever header the
   *  active provider actually expects rather than a single hardcoded name (see
   *  paymentWebhook.controller.ts). */
  readonly signatureHeaderName: string;
  createIntent(input: CreateIntentInput): Promise<ProviderIntent>;
  retrieve(providerRef: string): Promise<ProviderPaymentSnapshot>;
  /** Returns the parsed, verified event, or null if the signature doesn't check out. */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): ProviderWebhookEvent | null;
  refund(providerRef: string, amount: number, reason?: string): Promise<ProviderRefundResult>;
}
