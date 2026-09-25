import type { MarketplaceProviderCapabilities, MarketplaceProviderName } from "@restaurant/types";

export interface MarketplaceMenuItemInput {
  externalId?: string; // present on update, absent on first create
  internalId: string;
  name: string;
  description?: string;
  priceCents: number;
  currency: string;
  isAvailable: boolean;
  categoryExternalId: string;
}

export interface MarketplaceMenuCategoryInput {
  externalId?: string;
  internalId: string;
  name: string;
  sortOrder: number;
}

export interface PushMenuInput {
  externalStoreId: string;
  categories: MarketplaceMenuCategoryInput[];
  items: MarketplaceMenuItemInput[];
}

export interface MenuSyncResultEntry {
  internalId: string;
  externalId: string;
}

export interface PushMenuResult {
  categories: MenuSyncResultEntry[];
  items: MenuSyncResultEntry[];
  raw: unknown;
}

export interface MarketplaceOrderLineItem {
  externalItemId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  modifiers: { externalOptionId: string; name: string; priceCents: number }[];
}

export interface MarketplaceOrder {
  externalOrderId: string;
  externalStoreId: string;
  externalStatus: string;
  externalCreatedAt: string;
  customerName?: string;
  customerPhone?: string;
  orderType: "pickup" | "delivery";
  deliveryAddress?: { line1: string; city?: string; state?: string; postalCode?: string; country?: string };
  items: MarketplaceOrderLineItem[];
  subtotalCents: number;
  totalCents: number;
  currency: string;
  customerNotes?: string;
  raw: unknown;
}

/** A verified webhook event, already authenticated — everything downstream trusts this shape. */
export interface MarketplaceWebhookEvent {
  eventId: string;
  eventType: string;
  externalStoreId: string;
  /** Present only for order-related event types. */
  externalOrderId?: string;
  raw: unknown;
}

export class MarketplaceProviderError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "timeout"
      | "rate_limited"
      | "invalid_credentials"
      | "provider_unavailable"
      | "not_configured"
      | "not_found"
      | "unsupported_capability"
      | "provider_error"
  ) {
    super(message);
    this.name = "MarketplaceProviderError";
  }
}

/**
 * Provider-agnostic capability surface for marketplace ORDER-INGESTION — a different concern from
 * deliveryProviders/DeliveryProvider.ts (courier dispatch). Mirrors that interface's own shape
 * deliberately (same class of problem: external network provider, webhook-driven events,
 * credentials that may or may not be configured), applied to a materially different domain.
 *
 * `capabilities` is an explicit declaration, not an aspiration every method must fully realize —
 * providers genuinely differ (e.g. foodpanda's Catalog API has no per-item availability toggle the
 * way Uber Eats does). Callers check it before invoking an optional operation; an adapter throws
 * `MarketplaceProviderError` with code "unsupported_capability" if called anyway, it never silently
 * no-ops.
 */
export interface MarketplaceProvider {
  readonly name: MarketplaceProviderName;
  readonly capabilities: MarketplaceProviderCapabilities;
  /** The HTTP header this provider's webhook request carries its signature/auth token in. */
  readonly signatureHeaderName: string;
  /** A cheap, read-only call proving the platform-level credentials are currently valid — never
   *  throws, resolves false for any failure (including "not configured"). */
  healthCheck(): Promise<boolean>;
  /** Verifies the ONE centralized webhook endpoint's signature/token and returns the normalized,
   *  authenticated event, or null if it doesn't check out. Never trusts the payload before this. */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): MarketplaceWebhookEvent | null;
  /** Fetches the full order referenced by a verified webhook event. */
  fetchOrder(externalStoreId: string, externalOrderId: string): Promise<MarketplaceOrder>;
  acceptOrder(externalStoreId: string, externalOrderId: string): Promise<void>;
  denyOrder(externalStoreId: string, externalOrderId: string, reason: string): Promise<void>;
  pushMenu(input: PushMenuInput): Promise<PushMenuResult>;
  updateItemAvailability(externalStoreId: string, externalItemId: string, isAvailable: boolean): Promise<void>;
}
