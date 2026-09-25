import { createHmac, timingSafeEqual } from "node:crypto";
import {
  MarketplaceProviderError,
  type MarketplaceOrder,
  type MarketplaceProvider,
  type MarketplaceWebhookEvent,
  type PushMenuInput,
  type PushMenuResult,
} from "./MarketplaceProvider.js";
import type { MarketplaceProviderCapabilities } from "@restaurant/types";

const AUTH_URL = "https://auth.uber.com/oauth/v2/token";
const API_BASE_URL = "https://api.uber.com/v1/eats";
const REQUEST_TIMEOUT_MS = 10_000;
// Uber issues a token valid ~30 days per their docs; refreshing a day early is cheap insurance
// against clock-skew/edge-of-expiry races — same margin UberDirectProvider.ts uses for the
// (different) Uber Direct token.
const TOKEN_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

/**
 * Uber Eats Marketplace — order-ingestion, distinct from deliveryProviders/UberDirectProvider.ts
 * (courier dispatch; a different Uber product with a different API entirely, do not conflate).
 *
 * Researched directly against Uber's own current developer documentation
 * (developer.uber.com/docs/eats/introduction, .../guides/authentication, .../guides/webhooks) on
 * 2026-09-19, not invented. What follows is explicit about VERIFIED (read directly from those pages)
 * versus reasonably INFERRED (a documented convention, not independently confirmed against a live
 * payload):
 *
 * VERIFIED:
 *  - Auth: POST https://auth.uber.com/oauth/v2/token, grant_type=client_credentials, form-encoded
 *    client_id/client_secret/scope — server-to-server ops use scopes eats.store/eats.order/
 *    eats.report. Returns a bearer access_token valid ~30 days. "Your app operates on stores you're
 *    already connected to using your app's credentials" — i.e. this one platform-level token
 *    authorizes calls for every store that has separately completed the per-store
 *    `authorization_code` merchant-activation flow (not implemented by this adapter — see
 *    restaurantMarketplaceIntegration.controller.ts's connect flow for where that redirect lives).
 *  - Webhook signature: header `X-Uber-Signature`, a lowercase-hex HMAC-SHA256 of the raw request
 *    body using the app's client secret as the key.
 *  - Webhook event types: `orders.notification` (new order), `orders.cancel`/`orders.failure`
 *    (cancellation), `store.provisioned`/`store.deprovisioned`/`store.status.changed`. The webhook
 *    body carries `resource_href`/`resource_id`, not the full order — the full order is fetched
 *    separately via a GET.
 *  - Timing: the webhook receiver must return HTTP 200 with an empty body IMMEDIATELY on receipt,
 *    then within 11.5 minutes call an accept/deny endpoint or the order auto-cancels. This is why
 *    marketplaceWebhook.controller.ts acknowledges before enqueuing the ingestion job rather than
 *    processing inline, and why that job is enqueued at elevated BullMQ priority.
 *  - "Access to these APIs may require written approval from Uber" — a real commercial/approval
 *    gate this adapter cannot work around, same class of constraint UberDirectProvider.ts already
 *    documents for Uber Direct.
 *
 * NOT independently verified against a live payload (a reasonable, documented inference — never
 * invented — but not exercised against real traffic):
 *  - The exact JSON field names of a fetched order's line items/modifiers/customer/address, and of
 *    the menu-push request/response — Uber's docs describe the general "stores, menus, orders"
 *    surface but this adapter's precise request/response mapping was written against the
 *    documented shape, not confirmed against a real account (none was available).
 *  - The exact accept/deny endpoint paths (`/accept_pos_order`/`/deny_pos_order`, per the docs'
 *    accept/deny-within-11.5-minutes description) and the exact per-item availability-toggle path.
 *
 * Like every payments/delivery adapter in this codebase with the same "researched, never run
 * against a live account" status, this has never been exercised against Uber's own sandbox — no
 * developer-portal credentials were available when it was written.
 */
export class UberEatsProvider implements MarketplaceProvider {
  readonly name = "uber_eats" as const;
  readonly signatureHeaderName = "X-Uber-Signature";
  readonly capabilities: MarketplaceProviderCapabilities = {
    menuSync: true,
    itemAvailabilityUpdate: true,
    orderAccept: true,
    orderDeny: true,
    // Phase 78 — the one provider with a real merchant-facing authorization_code OAuth flow (see
    // marketplaceProviders/uberEatsConnect.ts). Still requires Uber's own written API approval before
    // a restaurant can complete a real connection — see this file's own header comment.
    connect: { mechanism: "oauth_redirect" },
  };

  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string
  ) {}

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return this.cachedToken.value;
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
      scope: "eats.store eats.order eats.report",
    });
    const res = await this.withTimeout((signal) =>
      fetch(AUTH_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal })
    );
    const json = await this.parseJson<{ access_token?: string; expires_in?: number }>(res, "authenticate");
    if (!res.ok || !json.access_token) {
      throw new MarketplaceProviderError(`Uber Eats authentication failed (HTTP ${res.status})`, "invalid_credentials");
    }
    this.cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 2_592_000) * 1000 };
    return json.access_token;
  }

  private async withTimeout(run: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await run(controller.signal);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new MarketplaceProviderError("Uber Eats request timed out", "timeout");
      }
      throw new MarketplaceProviderError(`Could not reach Uber Eats: ${(err as Error).message}`, "provider_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseJson<T>(res: Response, action: string): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw new MarketplaceProviderError(`Uber Eats returned an unreadable response while trying to ${action} (HTTP ${res.status})`, "provider_error");
    }
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
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
      if (res.status === 401 || res.status === 403) throw new MarketplaceProviderError(`Uber Eats rejected these credentials: ${message}`, "invalid_credentials");
      if (res.status === 429) throw new MarketplaceProviderError(`Uber Eats rate limit reached: ${message}`, "rate_limited");
      if (res.status === 404) throw new MarketplaceProviderError(`Uber Eats: ${message}`, "not_found");
      throw new MarketplaceProviderError(`Uber Eats error: ${message}`, "provider_error");
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
    const expected = createHmac("sha256", this.clientSecret).update(rawBody).digest("hex");
    const expectedBuf = Buffer.from(expected, "utf-8");
    const actualBuf = Buffer.from(signatureHeader.toLowerCase(), "utf-8");
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return null;

    let parsed: UberEatsWebhookPayload;
    try {
      parsed = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      return null;
    }
    if (!parsed.event_id || !parsed.event_type || !parsed.store_id) return null;

    return {
      eventId: parsed.event_id,
      eventType: parsed.event_type,
      externalStoreId: parsed.store_id,
      externalOrderId: parsed.resource_id,
      raw: parsed,
    };
  }

  async fetchOrder(externalStoreId: string, externalOrderId: string): Promise<MarketplaceOrder> {
    const res = await this.request<UberEatsOrderResponse>("GET", `/stores/${externalStoreId}/orders/${externalOrderId}`);
    return {
      externalOrderId: res.id,
      externalStoreId,
      externalStatus: res.current_state,
      externalCreatedAt: res.placed_at,
      customerName: res.eater?.first_name,
      customerPhone: res.eater?.phone,
      orderType: res.type === "DELIVERY_BY_UBER" || res.type === "DELIVERY_BY_RESTAURANT" ? "delivery" : "pickup",
      deliveryAddress: res.delivery?.location
        ? {
            line1: res.delivery.location.street_address ?? "",
            city: res.delivery.location.city,
            state: res.delivery.location.state,
            postalCode: res.delivery.location.zip_code,
            country: res.delivery.location.country,
          }
        : undefined,
      items: (res.cart?.items ?? []).map((item) => ({
        externalItemId: item.instance_id,
        name: item.title,
        quantity: item.quantity,
        unitPriceCents: item.price?.unit_price?.amount ?? 0,
        modifiers: (item.selected_modifier_groups ?? []).flatMap((g) =>
          (g.selected_items ?? []).map((m) => ({
            externalOptionId: m.instance_id,
            name: m.title,
            priceCents: m.price?.unit_price?.amount ?? 0,
          }))
        ),
      })),
      subtotalCents: res.payment?.charges?.sub_total?.amount ?? 0,
      totalCents: res.payment?.charges?.total?.amount ?? 0,
      currency: res.payment?.charges?.total?.currency_code ?? "USD",
      customerNotes: res.special_instructions,
      raw: res,
    };
  }

  async acceptOrder(externalStoreId: string, externalOrderId: string): Promise<void> {
    await this.request("POST", `/stores/${externalStoreId}/orders/${externalOrderId}/accept_pos_order`, { reason: "confirmed" });
  }

  async denyOrder(externalStoreId: string, externalOrderId: string, reason: string): Promise<void> {
    await this.request("POST", `/stores/${externalStoreId}/orders/${externalOrderId}/deny_pos_order`, { reason });
  }

  async pushMenu(input: PushMenuInput): Promise<PushMenuResult> {
    const res = await this.request<{ categories?: { id: string }[]; items?: { id: string }[] }>(
      "POST",
      `/stores/${input.externalStoreId}/menu`,
      {
        categories: input.categories.map((c) => ({ id: c.externalId, title: c.name, sort_order: c.sortOrder })),
        items: input.items.map((i) => ({
          id: i.externalId,
          title: i.name,
          description: i.description,
          price: i.priceCents,
          category_id: i.categoryExternalId,
          suspended: !i.isAvailable,
        })),
      }
    );
    return {
      categories: (res.categories ?? []).map((c, idx) => ({ internalId: input.categories[idx]?.internalId ?? "", externalId: c.id })),
      items: (res.items ?? []).map((i, idx) => ({ internalId: input.items[idx]?.internalId ?? "", externalId: i.id })),
      raw: res,
    };
  }

  async updateItemAvailability(externalStoreId: string, externalItemId: string, isAvailable: boolean): Promise<void> {
    await this.request("POST", `/stores/${externalStoreId}/menu/items/${externalItemId}/availability`, { suspended: !isAvailable });
  }
}

interface UberEatsWebhookPayload {
  event_id?: string;
  event_type?: string;
  store_id?: string;
  resource_href?: string;
  resource_id?: string;
}

interface UberEatsOrderResponse {
  id: string;
  current_state: string;
  placed_at: string;
  type?: string;
  special_instructions?: string;
  eater?: { first_name?: string; phone?: string };
  delivery?: { location?: { street_address?: string; city?: string; state?: string; zip_code?: string; country?: string } };
  cart?: {
    items?: {
      instance_id: string;
      title: string;
      quantity: number;
      price?: { unit_price?: { amount?: number } };
      selected_modifier_groups?: { selected_items?: { instance_id: string; title: string; price?: { unit_price?: { amount?: number } } }[] }[];
    }[];
  };
  payment?: { charges?: { sub_total?: { amount?: number }; total?: { amount?: number; currency_code?: string } } };
}
