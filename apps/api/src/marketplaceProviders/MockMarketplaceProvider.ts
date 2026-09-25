import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import type {
  MarketplaceOrder,
  MarketplaceProvider,
  MarketplaceWebhookEvent,
  PushMenuInput,
  PushMenuResult,
} from "./MarketplaceProvider.js";
import type { MarketplaceProviderCapabilities, MarketplaceProviderName } from "@restaurant/types";

interface MockOrderRecord extends MarketplaceOrder {
  accepted: boolean;
  denied: boolean;
}

/**
 * A deterministic, clearly-fake marketplace provider — the only adapter that actually runs in this
 * codebase today, mirroring payments/MockPaymentProvider.ts's exact shape and reasoning: real
 * webhook signature verification (HMAC-SHA256), real end-to-end order-ingestion behavior, but no
 * network call to any real marketplace ever happens and its in-memory state doesn't survive a
 * restart. Exists to make the marketplace order-ingestion pipeline (webhook -> claim -> job ->
 * createOrderForCustomer -> acceptOrder) genuinely exercisable in tests without real credentials.
 */
export class MockMarketplaceProvider implements MarketplaceProvider {
  readonly name: MarketplaceProviderName;
  readonly signatureHeaderName = "x-mock-marketplace-signature";
  readonly capabilities: MarketplaceProviderCapabilities;

  private readonly secret: string;
  private readonly orders = new Map<string, MockOrderRecord>();

  constructor(name: MarketplaceProviderName, webhookSecret: string) {
    this.name = name;
    this.secret = webhookSecret;
    this.capabilities = {
      menuSync: true,
      itemAvailabilityUpdate: true,
      orderAccept: true,
      orderDeny: true,
      // Phase 78 — mock mode stands in for every provider name (see marketplaceProviders/index.ts's
      // getMarketplaceProvider). For uber_eats specifically, `connect` matches the LIVE adapter's own
      // declaration (oauth_redirect) rather than the manual dev/test backdoor: uberEatsConnect.ts has
      // its own internal mock-mode branch, so the real OAuth connect flow is genuinely exercisable
      // end-to-end here, not just the order-ingestion pipeline. doordash/foodpanda have no real
      // connect flow at all (live mode: not_available/platform_admin_managed) — mock mode gives them
      // the sanctioned manual_store_id backdoor instead, purely so their order-ingestion pipeline
      // stays testable without a connect flow of their own to mock.
      connect: name === "uber_eats" ? { mechanism: "oauth_redirect" } : { mechanism: "manual_store_id" },
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): MarketplaceWebhookEvent | null {
    if (!signatureHeader) return null;
    const expected = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    const providedBuf = Buffer.from(signatureHeader, "hex");
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) return null;

    try {
      const parsed = JSON.parse(rawBody.toString("utf-8"));
      if (!parsed.eventId || !parsed.eventType || !parsed.externalStoreId) return null;
      return { eventId: parsed.eventId, eventType: parsed.eventType, externalStoreId: parsed.externalStoreId, externalOrderId: parsed.externalOrderId, raw: parsed };
    } catch {
      return null;
    }
  }

  async fetchOrder(externalStoreId: string, externalOrderId: string): Promise<MarketplaceOrder> {
    const record = this.orders.get(externalOrderId);
    if (!record || record.externalStoreId !== externalStoreId) throw new Error(`Unknown mock marketplace order: ${externalOrderId}`);
    return record;
  }

  async acceptOrder(externalStoreId: string, externalOrderId: string): Promise<void> {
    const record = this.orders.get(externalOrderId);
    if (!record || record.externalStoreId !== externalStoreId) throw new Error(`Unknown mock marketplace order: ${externalOrderId}`);
    record.accepted = true;
  }

  async denyOrder(externalStoreId: string, externalOrderId: string): Promise<void> {
    const record = this.orders.get(externalOrderId);
    if (!record || record.externalStoreId !== externalStoreId) throw new Error(`Unknown mock marketplace order: ${externalOrderId}`);
    record.denied = true;
  }

  async pushMenu(input: PushMenuInput): Promise<PushMenuResult> {
    return {
      categories: input.categories.map((c) => ({ internalId: c.internalId, externalId: c.externalId ?? `mock_cat_${c.internalId}` })),
      items: input.items.map((i) => ({ internalId: i.internalId, externalId: i.externalId ?? `mock_item_${i.internalId}` })),
      raw: { synced: input.items.length },
    };
  }

  async updateItemAvailability(): Promise<void> {
    // Nothing to record — no test currently asserts on this beyond "it doesn't throw."
  }

  // --- Mock-only driver surface below: not part of MarketplaceProvider, only ever called from
  // tests to simulate an inbound order the way a real provider's webhook would deliver one. ---

  /** Registers a fake order and returns an UNSIGNED webhook payload for the caller to sign via
   *  signPayload and submit through the real POST /webhooks/marketplace/:provider HTTP path —
   *  simulating what a real provider pushes when a customer places an order. */
  simulateInboundOrder(order: Omit<MarketplaceOrder, "raw">): Record<string, unknown> {
    this.orders.set(order.externalOrderId, { ...order, raw: order, accepted: false, denied: false });
    return {
      eventId: `mock_evt_${randomUUID()}`,
      eventType: "orders.notification",
      externalStoreId: order.externalStoreId,
      externalOrderId: order.externalOrderId,
    };
  }

  /** Signs a payload exactly as verifyWebhookSignature expects. */
  signPayload(payload: Record<string, unknown>): { rawBody: Buffer; signatureHeader: string } {
    const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
    const signatureHeader = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    return { rawBody, signatureHeader };
  }

  wasAccepted(externalOrderId: string): boolean {
    return this.orders.get(externalOrderId)?.accepted ?? false;
  }

  wasDenied(externalOrderId: string): boolean {
    return this.orders.get(externalOrderId)?.denied ?? false;
  }
}
