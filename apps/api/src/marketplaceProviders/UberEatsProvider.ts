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
import { UBER_EATS_HOSTS, type UberEatsHosts } from "./uberEatsHosts.js";

const REQUEST_TIMEOUT_MS = 10_000;
// Uber issues a token valid ~30 days per their docs; refreshing a day early is cheap insurance
// against clock-skew/edge-of-expiry races — same margin UberDirectProvider.ts uses for the
// (different) Uber Direct token.
const TOKEN_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;
// Only the scopes this adapter's calls need: eats.store (menu upload, item update) and eats.order
// (order details, accept, deny). Asking for a scope the app hasn't been granted fails the whole
// token request, so unused scopes (eats.report) are deliberately not requested.
const CLIENT_CREDENTIALS_SCOPE = "eats.store eats.order";
// Uber's documented example of an open-ended item suspension (Update Menu Item reference).
const SUSPEND_INDEFINITELY_UNTIL = 8_640_000_000;
// MultiLanguageText takes exactly one translation; Uber's own examples use en_us.
const MENU_LOCALE = "en_us";
const NEW_ORDER_EVENT_TYPES = new Set(["orders.notification", "orders.scheduled.notification"]);
const UBER_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Uber Eats Marketplace — order-ingestion, distinct from deliveryProviders/UberDirectProvider.ts
 * (courier dispatch; a different Uber product with a different API entirely, do not conflate).
 *
 * Every path and field below was checked on 2026-10-25 against Uber's API reference
 * (developer.uber.com/docs/eats/references/api/...) and the sandbox, authentication and webhooks
 * guides:
 *  - Auth: POST {auth}/oauth/v2/token, grant_type=client_credentials, scopes eats.store + eats.order.
 *    Tokens last 30 days and token creation is limited to 100/hour, so the token is cached.
 *  - Orders: GET /v2/eats/order/{order_id}; POST /v1/eats/orders/{order_id}/accept_pos_order
 *    ({reason}); POST /v1/eats/orders/{order_id}/deny_pos_order ({reason: {explanation, code}}).
 *    Accept/deny return 204 with an empty body and require this app to be the store's order manager.
 *  - Menu: PUT /v2/eats/stores/{store_id}/menus (MenuConfiguration, 204); item availability via
 *    POST /v2/eats/stores/{store_id}/menus/items/{item_id} with suspension_info (204). Menu ids are
 *    chosen by us, so an uploaded item's id is what comes back as cart.items[].id on an order.
 *  - Webhooks: X-Uber-Signature = lowercase-hex HMAC-SHA256 of the raw body, keyed with the Primary
 *    Webhook URL's signing key (dashboard, BASIC_HMAC) or the client secret; the store is
 *    meta.user_id and the order is meta.resource_id.
 *
 * Still unproven against a real sandbox account (no TESTING app credentials yet): whether an empty
 * tax_info object is accepted on menu items, and the exact accepted fields of the pos_data
 * activation call (see uberEatsConnect.ts). scripts/uberEatsSandboxCheck.ts exercises both.
 */
export class UberEatsProvider implements MarketplaceProvider {
  readonly name = "uber_eats" as const;
  readonly signatureHeaderName = "X-Uber-Signature";
  readonly capabilities: MarketplaceProviderCapabilities;

  private cachedToken: { value: string; expiresAt: number } | null = null;
  private readonly webhookSigningKeys: string[];

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    // Sandbox unless a caller explicitly passes production hosts (see uberEatsHosts.ts).
    private readonly hosts: UberEatsHosts = UBER_EATS_HOSTS.sandbox,
    options: { connectionsOpen?: boolean; webhookSigningKey?: string } = {}
  ) {
    // X-Uber-Signature keys: the webhook signing key set for the app's Primary Webhook URL in Uber's
    // dashboard (BASIC_HMAC) when configured, and the client secret, which Uber's Eats webhooks guide
    // documents. Both are this app's own secrets, so accepting either never widens who can sign.
    this.webhookSigningKeys = [options.webhookSigningKey, clientSecret].filter((k): k is string => Boolean(k));
    this.capabilities = {
      menuSync: true,
      itemAvailabilityUpdate: true,
      orderAccept: true,
      orderDeny: true,
      // Phase 78 — the one provider with a real merchant-facing authorization_code OAuth flow (see
      // marketplaceProviders/uberEatsConnect.ts). Closed (not_available) while a production
      // deployment runs this adapter against Uber's sandbox — see providerMode.ts.
      connect: options.connectionsOpen === false ? { mechanism: "not_available" } : { mechanism: "oauth_redirect" },
    };
  }

  get environment() {
    return this.hosts.environment;
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return this.cachedToken.value;
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
      scope: CLIENT_CREDENTIALS_SCOPE,
    });
    const res = await this.withTimeout((signal) =>
      fetch(`${this.hosts.authBaseUrl}/oauth/v2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal })
    );
    if (res.status === 429) {
      throw new MarketplaceProviderError("Uber Eats token rate limit reached (100 tokens/hour)", "rate_limited");
    }
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

  /** `expectBody: false` is for Uber's 204 No Content endpoints (accept, deny, menu upload, item
   *  update) — their success has no JSON to parse. A 401 drops the cached token and retries once
   *  with a fresh one, in case the cached token was revoked or invalidated early. */
  private async request<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown, expectBody = true, retried = false): Promise<T> {
    const token = await this.getAccessToken();
    const res = await this.withTimeout((signal) =>
      fetch(`${this.hosts.apiBaseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      })
    );
    if (res.status === 401 && !retried) {
      this.cachedToken = null;
      return this.request<T>(method, path, body, expectBody, true);
    }
    if (!res.ok) {
      const json = await this.parseJson<{ message?: string }>(res, path).catch(() => ({}) as { message?: string });
      const message = json.message ?? `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new MarketplaceProviderError(`Uber Eats rejected these credentials: ${message}`, "invalid_credentials");
      if (res.status === 429) throw new MarketplaceProviderError(`Uber Eats rate limit reached: ${message}`, "rate_limited");
      if (res.status === 404) throw new MarketplaceProviderError(`Uber Eats: ${message}`, "not_found");
      throw new MarketplaceProviderError(`Uber Eats error: ${message}`, "provider_error");
    }
    if (!expectBody) return undefined as T;
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

  /** GET /v1/eats/stores with the app's client_credentials token — the stores provisioned to this
   *  app (eats.store). Read-only; used by the sandbox check to list the test stores. */
  async listStores(): Promise<{ storeId: string; name?: string }[]> {
    const res = await this.request<{ stores?: { store_id?: string; name?: string }[] }>("GET", "/v1/eats/stores");
    return (res?.stores ?? []).filter((s) => typeof s.store_id === "string").map((s) => ({ storeId: s.store_id!, name: s.name }));
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): MarketplaceWebhookEvent | null {
    if (!signatureHeader) return null;
    const actualBuf = Buffer.from(signatureHeader.trim().toLowerCase(), "utf-8");
    const signedByUs = this.webhookSigningKeys.some((key) => {
      const expectedBuf = Buffer.from(createHmac("sha256", key).update(rawBody).digest("hex"), "utf-8");
      return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
    });
    if (!signedByUs) return null;

    let parsed: UberEatsWebhookPayload;
    try {
      parsed = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      return null;
    }
    const storeId = parsed?.meta?.user_id;
    if (typeof parsed?.event_id !== "string" || typeof parsed.event_type !== "string" || typeof storeId !== "string" || !storeId) return null;

    // Only a new order is ingested. Cancellations, store provisioning and status changes are
    // acknowledged without an order id, so they are never mistaken for an order to create/accept.
    const resourceId = parsed.meta?.resource_id;
    const isNewOrder = NEW_ORDER_EVENT_TYPES.has(parsed.event_type) && typeof resourceId === "string" && resourceId.length > 0;

    return {
      eventId: parsed.event_id,
      eventType: parsed.event_type,
      externalStoreId: storeId,
      externalOrderId: isNewOrder ? resourceId : undefined,
      raw: parsed,
    };
  }

  async fetchOrder(externalStoreId: string, externalOrderId: string): Promise<MarketplaceOrder> {
    const res = await this.request<UberEatsOrderResponse>("GET", `/v2/eats/order/${encodeURIComponent(externalOrderId)}`);
    if (!res || typeof res.id !== "string" || !Array.isArray(res.cart?.items)) {
      throw new MarketplaceProviderError("Uber Eats returned an order without an id or cart items", "provider_error");
    }
    // Tenant isolation: the order must belong to the store this integration is connected to.
    if (res.store?.id && res.store.id !== externalStoreId) {
      throw new MarketplaceProviderError("Uber Eats order belongs to a different store than this integration", "provider_error");
    }
    const location = res.eater?.delivery?.location;
    return {
      externalOrderId: res.id,
      externalStoreId,
      externalStatus: res.current_state ?? "UNKNOWN",
      externalCreatedAt: res.placed_at ?? "",
      customerName: res.eater?.first_name,
      customerPhone: res.eater?.phone,
      orderType: res.type === "DELIVERY_BY_UBER" || res.type === "DELIVERY_BY_RESTAURANT" ? "delivery" : "pickup",
      deliveryAddress: location?.street_address ? { line1: location.street_address } : undefined,
      items: res.cart.items.map((item) => ({
        // `id` is the menu item id we uploaded (instance_id is per-cart), so it's what maps back.
        externalItemId: item.id,
        name: item.title,
        quantity: item.quantity,
        unitPriceCents: item.price?.unit_price?.amount ?? 0,
        modifiers: (item.selected_modifier_groups ?? []).flatMap((g) =>
          (g.selected_items ?? []).map((m) => ({
            externalOptionId: m.id,
            name: m.title,
            priceCents: m.price?.unit_price?.amount ?? 0,
          }))
        ),
      })),
      subtotalCents: res.payment?.charges?.sub_total?.amount ?? 0,
      totalCents: res.payment?.charges?.total?.amount ?? 0,
      currency: res.payment?.charges?.total?.currency_code ?? "USD",
      customerNotes: res.cart.special_instructions,
      raw: res,
    };
  }

  async acceptOrder(_externalStoreId: string, externalOrderId: string): Promise<void> {
    await this.request("POST", `/v1/eats/orders/${encodeURIComponent(externalOrderId)}/accept_pos_order`, { reason: "Accepted by GarnishTable" }, false);
  }

  async denyOrder(_externalStoreId: string, externalOrderId: string, reason: string): Promise<void> {
    await this.request(
      "POST",
      `/v1/eats/orders/${encodeURIComponent(externalOrderId)}/deny_pos_order`,
      { reason: { explanation: reason, code: "OTHER" } },
      false
    );
  }

  async pushMenu(input: PushMenuInput): Promise<PushMenuResult> {
    const categories = input.categories.map((c) => ({ internalId: c.internalId, externalId: c.externalId || c.internalId, name: c.name }));
    const categoryIdByInternal = new Map(categories.map((c) => [c.internalId, c.externalId]));
    const items = input.items.map((i) => ({
      ...i,
      externalId: i.externalId || i.internalId,
      categoryId: i.categoryExternalId || (i.categoryInternalId ? categoryIdByInternal.get(i.categoryInternalId) : undefined),
    }));

    const text = (value: string) => ({ translations: { [MENU_LOCALE]: value } });
    const body = {
      menus: [
        {
          id: "garnishtable-menu",
          title: text("Menu"),
          service_availability: toServiceAvailability(input.serviceHours),
          category_ids: categories.map((c) => c.externalId),
        },
      ],
      categories: categories.map((c) => ({
        id: c.externalId,
        title: text(c.name),
        entities: items.filter((i) => i.categoryId === c.externalId).map((i) => ({ id: i.externalId, type: "ITEM" })),
      })),
      items: items.map((i) => ({
        id: i.externalId,
        title: text(i.name),
        ...(i.description ? { description: text(i.description) } : {}),
        price_info: { price: i.priceCents },
        tax_info: {},
        ...(i.isAvailable ? {} : { suspension_info: { suspension: { suspend_until: SUSPEND_INDEFINITELY_UNTIL } } }),
      })),
    };

    await this.request("PUT", `/v2/eats/stores/${encodeURIComponent(input.externalStoreId)}/menus`, body, false);
    return {
      categories: categories.map((c) => ({ internalId: c.internalId, externalId: c.externalId })),
      items: items.map((i) => ({ internalId: i.internalId, externalId: i.externalId })),
      raw: null,
    };
  }

  async updateItemAvailability(externalStoreId: string, externalItemId: string, isAvailable: boolean): Promise<void> {
    await this.request(
      "POST",
      `/v2/eats/stores/${encodeURIComponent(externalStoreId)}/menus/items/${encodeURIComponent(externalItemId)}`,
      { suspension_info: { suspension: isAvailable ? null : { suspend_until: SUSPEND_INDEFINITELY_UNTIL } } },
      false
    );
  }
}

/** Restaurant weekly hours → Uber ServiceAvailability ("HH:MM", each period within one day). An
 *  overnight span (close earlier than open) is split at midnight. No hours configured means always
 *  available, matching how GarnishTable itself treats a restaurant without hours. */
export function toServiceAvailability(hours: PushMenuInput["serviceHours"]) {
  const periods = new Map<string, { start_time: string; end_time: string }[]>();
  const add = (day: string, start: string, end: string) => periods.set(day, [...(periods.get(day) ?? []), { start_time: start, end_time: end }]);

  if (!hours || hours.length === 0) {
    for (const day of UBER_WEEKDAYS) add(day, "00:00", "23:59");
  } else {
    for (const d of hours) {
      const dayIdx = UBER_WEEKDAYS.indexOf(d.day as (typeof UBER_WEEKDAYS)[number]);
      if (d.isClosed || dayIdx < 0 || !d.open || !d.close || !HHMM.test(d.open) || !HHMM.test(d.close)) continue;
      if (d.close > d.open) {
        add(d.day, d.open, d.close);
      } else {
        add(d.day, d.open, "23:59");
        if (d.close !== "00:00") add(UBER_WEEKDAYS[(dayIdx + 1) % 7]!, "00:00", d.close);
      }
    }
  }
  return UBER_WEEKDAYS.filter((day) => periods.has(day)).map((day) => ({ day_of_week: day, time_periods: periods.get(day)! }));
}

interface UberEatsWebhookPayload {
  event_id?: unknown;
  event_type?: unknown;
  event_time?: number;
  meta?: { resource_id?: unknown; status?: string; user_id?: unknown };
  resource_href?: string;
}

interface UberEatsOrderResponse {
  id: string;
  current_state?: string;
  placed_at?: string;
  type?: string;
  store?: { id?: string };
  eater?: { first_name?: string; phone?: string; delivery?: { location?: { street_address?: string } } };
  cart: {
    special_instructions?: string;
    items: {
      id: string;
      instance_id?: string;
      title: string;
      quantity: number;
      price?: { unit_price?: { amount?: number } };
      selected_modifier_groups?: { selected_items?: { id: string; title: string; price?: { unit_price?: { amount?: number } } }[] }[];
    }[];
  };
  payment?: { charges?: { sub_total?: { amount?: number }; total?: { amount?: number; currency_code?: string } } };
}
