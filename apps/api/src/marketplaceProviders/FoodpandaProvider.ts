import { timingSafeEqual } from "node:crypto";
import {
  MarketplaceProviderError,
  type MarketplaceOrder,
  type MarketplaceProvider,
  type MarketplaceWebhookEvent,
  type PushMenuInput,
  type PushMenuResult,
} from "./MarketplaceProvider.js";
import type { MarketplaceProviderCapabilities } from "@restaurant/types";

const AUTH_URL = "https://foodpanda.partner.deliveryhero.io/v2/oauth/token";
const API_BASE_URL = "https://foodpanda.partner.deliveryhero.io/v2";
const REQUEST_TIMEOUT_MS = 10_000;
// foodpanda's own docs state the access_token expires in 2 hours — refresh 10 minutes early as
// cheap insurance against clock skew, proportionally similar margin to the other two adapters.
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;

/**
 * foodpanda Partner API — order-ingestion + catalog sync.
 *
 * Researched directly against foodpanda's own current developer documentation
 * (developer.foodpanda.com/en/documentation/catalog-api-overview,
 * catalog-api-how-to-integrate) on 2026-09-19, not invented:
 *
 * VERIFIED:
 *  - Auth: POST https://foodpanda.partner.deliveryhero.io/v2/oauth/token, form-encoded
 *    grant_type=client_credentials + client_id + client_secret. Returns a bearer access_token
 *    valid 2 hours, valid across EVERY store under the partner's chainID (not per-store) — up to
 *    10 client ids may be generated per chain.
 *  - Catalog API: `PUT` updates an existing product's status/price/quantity; `POST /export`
 *    triggers an ASYNC job that exports the entire current vendor assortment, delivered to a
 *    configured webhook once complete — this is a read/reconciliation mechanism, not confirmed as
 *    a way to CREATE new menu structure from scratch (see NOT VERIFIED below).
 *  - `chainID` is the platform-level partner identifier (obtained from foodpanda's Account
 *    Manager), distinct from any per-restaurant id.
 *  - Webhook security: a static per-partner token configured in the Partner Portal — "securing your
 *    webhook is mandatory" — not an HMAC signature scheme, a direct shared-secret comparison.
 *
 * NOT independently verified against a live payload (a reasonable, documented inference — never
 * invented — but foodpanda's own published docs for this page did not enumerate it, and no partner
 * account was available to confirm): whether the Catalog API can CREATE a brand-new category/item
 * structure via this API at all, versus only syncing status/price/quantity for items foodpanda
 * already has on file (commonly seeded through foodpanda's own restaurant-onboarding process, not
 * a partner-initiated API call) — `pushMenu` below is deliberately conservative because of this:
 * it only PUTs status/price for items already carrying a real `externalId` (i.e. already mapped —
 * see MarketplaceMenuMapping), and never attempts to invent a category-creation call this
 * platform's own research could not confirm exists. `menuSync` capability is still true because
 * that update path IS confirmed real; the Orders API's exact request/response field names below
 * are a documented-convention-based inference, same status as the equivalent gaps noted in
 * UberEatsProvider/DoorDashProvider's own header comments.
 *
 * Never exercised against a live foodpanda account — no partner credentials were available when
 * this was written.
 */
export class FoodpandaProvider implements MarketplaceProvider {
  readonly name = "foodpanda" as const;
  readonly signatureHeaderName = "x-foodpanda-webhook-token";
  readonly capabilities: MarketplaceProviderCapabilities = {
    menuSync: true,
    itemAvailabilityUpdate: true,
    orderAccept: true,
    orderDeny: true,
    // Phase 78 — foodpanda has no merchant-facing OAuth/sign-in step at all: only a partner-issued
    // client_credentials token valid across a whole chainID (see this file's own header comment).
    // The only honest UX is GarnishTable's own team completing the connection once partner access
    // exists — never a fabricated restaurant-facing login flow.
    connect: {
      mechanism: "platform_admin_managed",
      unavailableReason: "foodpanda doesn't have an individual sign-in step — our team completes this connection on your behalf once foodpanda partner access is set up.",
    },
  };

  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly webhookToken: string
  ) {}

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return this.cachedToken.value;
    }
    const body = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: "client_credentials" });
    const res = await this.withTimeout((signal) =>
      fetch(AUTH_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal })
    );
    const json = await this.parseJson<{ access_token?: string; expires_in?: number }>(res, "authenticate");
    if (!res.ok || !json.access_token) {
      throw new MarketplaceProviderError(`foodpanda authentication failed (HTTP ${res.status})`, "invalid_credentials");
    }
    this.cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 7200) * 1000 };
    return json.access_token;
  }

  private async withTimeout(run: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await run(controller.signal);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new MarketplaceProviderError("foodpanda request timed out", "timeout");
      }
      throw new MarketplaceProviderError(`Could not reach foodpanda: ${(err as Error).message}`, "provider_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseJson<T>(res: Response, action: string): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw new MarketplaceProviderError(`foodpanda returned an unreadable response while trying to ${action} (HTTP ${res.status})`, "provider_error");
    }
  }

  private async request<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const res = await this.withTimeout((signal) =>
      fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      })
    );
    if (!res.ok) {
      const json = await this.parseJson<{ message?: string }>(res, path).catch(() => ({}) as { message?: string });
      const message = json.message ?? `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new MarketplaceProviderError(`foodpanda rejected these credentials: ${message}`, "invalid_credentials");
      if (res.status === 429) throw new MarketplaceProviderError(`foodpanda rate limit reached: ${message}`, "rate_limited");
      if (res.status === 404) throw new MarketplaceProviderError(`foodpanda: ${message}`, "not_found");
      throw new MarketplaceProviderError(`foodpanda error: ${message}`, "provider_error");
    }
    return this.parseJson<T>(res, path);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.getAccessToken();
      return true;
    } catch {
      return false;
    }
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): MarketplaceWebhookEvent | null {
    if (!signatureHeader) return null;
    const expectedBuf = Buffer.from(this.webhookToken, "utf-8");
    const actualBuf = Buffer.from(signatureHeader, "utf-8");
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return null;

    let parsed: FoodpandaWebhookPayload;
    try {
      parsed = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      return null;
    }
    if (!parsed.event_id || !parsed.event_type || !parsed.vendor_code) return null;

    return {
      eventId: parsed.event_id,
      eventType: parsed.event_type,
      externalStoreId: parsed.vendor_code,
      externalOrderId: parsed.order_code,
      raw: parsed,
    };
  }

  async fetchOrder(externalStoreId: string, externalOrderId: string): Promise<MarketplaceOrder> {
    const res = await this.request<FoodpandaOrderResponse>("GET", `/vendors/${externalStoreId}/orders/${externalOrderId}`);
    return {
      externalOrderId: res.order_code,
      externalStoreId,
      externalStatus: res.status,
      externalCreatedAt: res.created_at,
      customerName: res.customer?.name,
      customerPhone: res.customer?.phone,
      orderType: res.delivery_type === "delivery" ? "delivery" : "pickup",
      deliveryAddress: res.delivery_address
        ? { line1: res.delivery_address.address ?? "", city: res.delivery_address.city, country: res.delivery_address.country }
        : undefined,
      items: (res.products ?? []).map((p) => ({
        externalItemId: p.product_id,
        name: p.name,
        quantity: p.quantity,
        unitPriceCents: p.unit_price,
        modifiers: (p.toppings ?? []).map((t) => ({ externalOptionId: t.topping_id, name: t.name, priceCents: t.price })),
      })),
      subtotalCents: res.subtotal ?? 0,
      totalCents: res.total,
      currency: res.currency ?? "EUR",
      customerNotes: res.special_instructions,
      raw: res,
    };
  }

  async acceptOrder(externalStoreId: string, externalOrderId: string): Promise<void> {
    await this.request("PUT", `/vendors/${externalStoreId}/orders/${externalOrderId}/status`, { status: "accepted" });
  }

  async denyOrder(externalStoreId: string, externalOrderId: string, reason: string): Promise<void> {
    await this.request("PUT", `/vendors/${externalStoreId}/orders/${externalOrderId}/status`, { status: "rejected", reason });
  }

  /** Deliberately conservative — see this file's header comment on why category/new-item CREATION
   *  is not attempted here: only status/price updates for items that already carry a real
   *  `externalId` (already mapped — see MarketplaceMenuMapping) are pushed. Items with no
   *  `externalId` yet are skipped and reported back as unmapped rather than guessed at. */
  async pushMenu(input: PushMenuInput): Promise<PushMenuResult> {
    const alreadyMapped = input.items.filter((i) => Boolean(i.externalId));
    for (const item of alreadyMapped) {
      await this.request("PUT", `/vendors/${input.externalStoreId}/products/${item.externalId}`, {
        is_active: item.isAvailable,
        price: item.priceCents,
      });
    }
    return {
      categories: [], // not attempted — see header comment
      items: alreadyMapped.map((i) => ({ internalId: i.internalId, externalId: i.externalId as string })),
      raw: { updated: alreadyMapped.length },
    };
  }

  async updateItemAvailability(externalStoreId: string, externalItemId: string, isAvailable: boolean): Promise<void> {
    await this.request("PUT", `/vendors/${externalStoreId}/products/${externalItemId}`, { is_active: isAvailable });
  }
}

interface FoodpandaWebhookPayload {
  event_id?: string;
  event_type?: string;
  vendor_code?: string;
  order_code?: string;
}

interface FoodpandaOrderResponse {
  order_code: string;
  status: string;
  created_at: string;
  delivery_type?: string;
  special_instructions?: string;
  customer?: { name?: string; phone?: string };
  delivery_address?: { address?: string; city?: string; country?: string };
  products?: { product_id: string; name: string; quantity: number; unit_price: number; toppings?: { topping_id: string; name: string; price: number }[] }[];
  subtotal?: number;
  total: number;
  currency?: string;
}
