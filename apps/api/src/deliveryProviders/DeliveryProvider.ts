import type { DeliveryProviderName, DeliveryStatus } from "@restaurant/types";

export interface DeliveryContact {
  name: string;
  phone: string;
  address: string;
  latitude: number;
  longitude: number;
  notes?: string;
}

export interface ManifestItem {
  name: string;
  quantity: number;
}

export interface DeliveryQuoteInput {
  pickup: Pick<DeliveryContact, "address" | "latitude" | "longitude">;
  dropoff: Pick<DeliveryContact, "address" | "latitude" | "longitude">;
  /** The restaurant's configured currency — a hint a real provider's quote should normally already
   *  match (most quote APIs infer currency from pickup location); "manual" has no real quote to
   *  make and simply echoes this back. */
  currency: string;
}

export interface DeliveryQuoteResult {
  /** Absent for a provider with no separate quote step (e.g. "manual", which has no per-run
   *  provider fee to quote at all). */
  quoteId?: string;
  fee: number;
  currency: string;
  estimatedDurationMinutes?: number;
  raw: unknown;
}

export interface CreateDeliveryInput {
  orderId: string;
  restaurantId: string;
  quoteId?: string;
  pickup: DeliveryContact;
  dropoff: DeliveryContact;
  manifestItems: ManifestItem[];
  /** Stable per order (see deliveryDispatch.service.ts) — passed through to providers whose API
   *  supports request-level idempotency; adapters without that capability simply ignore it, since
   *  the caller's own Delivery.idempotencyKey unique index is the backstop either way. */
  idempotencyKey: string;
}

export interface ProviderDeliveryResult {
  providerDeliveryId: string;
  status: DeliveryStatus;
  trackingUrl?: string;
  fee?: number;
  currency?: string;
  raw: unknown;
}

export interface ProviderDeliverySnapshot extends ProviderDeliveryResult {
  courierName?: string;
  courierPhone?: string;
  pickupEta?: string;
  dropoffEta?: string;
}

export interface ProviderDeliveryWebhookEvent {
  eventId: string;
  eventType: string;
  providerDeliveryId: string;
  status: DeliveryStatus;
  courierName?: string;
  courierPhone?: string;
  trackingUrl?: string;
  cancelReason?: string;
  raw: unknown;
}

export class DeliveryProviderError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "timeout"
      | "rate_limited"
      | "invalid_credentials"
      | "provider_unavailable"
      | "invalid_address"
      | "outside_service_area"
      | "quote_unavailable"
      | "not_found"
      | "provider_error"
  ) {
    super(message);
    this.name = "DeliveryProviderError";
  }
}

/**
 * Provider-agnostic capability surface — deliveryDispatch.service.ts and every controller talk
 * only to this interface, never to a concrete courier SDK/API. Mirrors payments/PaymentProvider.ts
 * deliberately: same shape of problem (external network provider, webhook-driven status,
 * credentials that may or may not be configured), same solution. Provider-specific request/response
 * shapes, authentication, and status-string mapping stay isolated inside one adapter file per
 * provider — see UberDirectProvider.ts's header comment for exactly what's verified-from-real-docs
 * versus not, and ManualDispatchProvider.ts for the always-available, zero-config first provider.
 */
export interface DeliveryProvider {
  readonly name: DeliveryProviderName;
  /** The HTTP header this provider's webhook request carries its signature in — undefined for a
   *  provider with no webhooks at all (e.g. "manual", which never receives external callbacks). */
  readonly signatureHeaderName?: string;
  /** A cheap, read-only, zero-side-effect call proving this provider is currently reachable and
   *  (where credentials are involved) that they authenticate — never throws, resolves false for
   *  any failure. */
  healthCheck(): Promise<boolean>;
  getQuote(input: DeliveryQuoteInput): Promise<DeliveryQuoteResult>;
  createDelivery(input: CreateDeliveryInput): Promise<ProviderDeliveryResult>;
  getDelivery(providerDeliveryId: string): Promise<ProviderDeliverySnapshot>;
  cancelDelivery(providerDeliveryId: string, reason?: string): Promise<{ cancelled: boolean }>;
  /** Returns the parsed, verified event, or null if the signature doesn't check out. Providers
   *  with no webhooks (manual) always return null. */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): ProviderDeliveryWebhookEvent | null;
}
