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

const API_BASE_URL = "https://openapi.doordash.com/marketplace/api/v1";
const REQUEST_TIMEOUT_MS = 10_000;
// DoorDash JWTs are short-lived (their docs recommend minting one per request/short window, not
// caching for long) — 5 minutes is a conservative, safe lifetime this adapter mints fresh each time
// it's needed rather than genuinely caching.
const JWT_LIFETIME_SECONDS = 300;

/**
 * DoorDash Marketplace — order-ingestion, distinct from DoorDash Drive (a separate DoorDash
 * product/API for courier dispatch, not implemented anywhere in this codebase; do not conflate the
 * two, per this platform's own architecture brief).
 *
 * Researched directly against DoorDash's own current developer documentation
 * (developer.doordash.com/en-US/docs/marketplace/...) on 2026-09-19, not invented:
 *
 * VERIFIED:
 *  - Authentication is JWT-based, not OAuth token-exchange: every request carries
 *    `Authorization: Bearer <JWT>` plus a required `auth-version: v2` header. The JWT is signed
 *    HMAC-SHA256 (HS256) using a signing key DoorDash issues per partner.
 *  - The signing key/developer-id/key-id are obtained only through a Technical-Account-Manager-
 *    assisted onboarding process to add a Marketplace integration and configure a sandbox provider
 *    — DoorDash's own docs are explicit that self-serve API access does not exist for this surface,
 *    the same real, documented approval gate this platform's brief already told us to expect.
 *  - The API surface covers three named products: Marketplace (orders), Item Management (menu/
 *    catalog sync), and Reporting — with webhook notifications for order events, menu-processing
 *    status, delivery-status updates, and store-onboarding events.
 *
 * NOT independently verified against a live payload (a reasonable, documented inference — never
 * invented — but this platform has no DoorDash developer-portal access to confirm against): the
 * exact JWT claim set beyond the standard iss/aud/exp/iat pattern their JWT guide describes, the
 * precise REST paths/request-response field names for order-fetch/accept/menu-push, and the exact
 * webhook payload/signature-header shape (DoorDash's JWT-based request auth is documented in
 * detail; their WEBHOOK verification specifically was not independently confirmed — this adapter
 * verifies webhook payloads the same JWT-Bearer way as regular API calls, which is DoorDash's
 * documented auth model, but the header name below is a best-effort default pending real sandbox
 * access, not a confirmed webhook-specific convention).
 *
 * Like UberEatsProvider/FoodpandaProvider, has never been exercised against a live DoorDash
 * account — no credentials exist; this is the one provider whose sandbox access itself requires a
 * DoorDash-side human (a TAM) before any of this can even be tested.
 */
export class DoorDashProvider implements MarketplaceProvider {
  readonly name = "doordash" as const;
  readonly signatureHeaderName = "authorization";
  readonly capabilities: MarketplaceProviderCapabilities = {
    menuSync: true,
    itemAvailabilityUpdate: true,
    orderAccept: true,
    orderDeny: false, // DoorDash's documented order-event model has no explicit "deny" action for this adapter to call — a store simply doesn't confirm within the provider's own SLA.
    // Phase 78 — a real merchant-facing "Self-Serve Integration Onboarding" (SSIO) flow exists for
    // middleware platforms (this deployment's exact shape), but its redirect/callback/token-exchange
    // technical parameters aren't independently confirmable without DoorDash partner access — see this
    // file's own header comment. Honestly "not_available" rather than a guessed OAuth handshake.
    connect: {
      mechanism: "not_available",
      unavailableReason: "DoorDash requires a partner-onboarding step with our team before this can be connected. We'll notify you once it's ready.",
    },
  };

  constructor(
    private readonly developerId: string,
    private readonly keyId: string,
    private readonly signingSecret: string
  ) {}

  private mintJwt(): string {
    const header = { alg: "HS256", typ: "JWT", "dd-ver": "DD-JWT-V1" };
    const now = Math.floor(Date.now() / 1000);
    const payload = { aud: "doordash", iss: this.developerId, kid: this.keyId, exp: now + JWT_LIFETIME_SECONDS, iat: now };
    const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const signingInput = `${encode(header)}.${encode(payload)}`;
    const signature = createHmac("sha256", Buffer.from(this.signingSecret, "base64")).update(signingInput).digest("base64url");
    return `${signingInput}.${signature}`;
  }

  private async withTimeout(run: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await run(controller.signal);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new MarketplaceProviderError("DoorDash request timed out", "timeout");
      }
      throw new MarketplaceProviderError(`Could not reach DoorDash: ${(err as Error).message}`, "provider_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseJson<T>(res: Response, action: string): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw new MarketplaceProviderError(`DoorDash returned an unreadable response while trying to ${action} (HTTP ${res.status})`, "provider_error");
    }
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await this.withTimeout((signal) =>
      fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.mintJwt()}`, "auth-version": "v2" },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      })
    );
    if (!res.ok) {
      const json = await this.parseJson<{ message?: string }>(res, path).catch(() => ({}) as { message?: string });
      const message = json.message ?? `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new MarketplaceProviderError(`DoorDash rejected these credentials: ${message}`, "invalid_credentials");
      if (res.status === 429) throw new MarketplaceProviderError(`DoorDash rate limit reached: ${message}`, "rate_limited");
      if (res.status === 404) throw new MarketplaceProviderError(`DoorDash: ${message}`, "not_found");
      throw new MarketplaceProviderError(`DoorDash error: ${message}`, "provider_error");
    }
    return this.parseJson<T>(res, path);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request("GET", "/stores/health");
      return true;
    } catch {
      return false;
    }
  }

  /** DoorDash's own documented auth model is JWT-Bearer for every request, including webhooks
   *  (see header comment) — this re-verifies the JWT DoorDash itself signs and sends back using the
   *  same signing secret, rather than a separate HMAC-of-body scheme like Uber Eats'. */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): MarketplaceWebhookEvent | null {
    if (!signatureHeader?.startsWith("Bearer ")) return null;
    const token = signatureHeader.slice("Bearer ".length);
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    const expectedSig = createHmac("sha256", Buffer.from(this.signingSecret, "base64")).update(`${headerB64}.${payloadB64}`).digest("base64url");
    const expectedBuf = Buffer.from(expectedSig, "utf-8");
    const actualBuf = Buffer.from(signatureB64, "utf-8");
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return null;

    let parsed: DoorDashWebhookPayload;
    try {
      parsed = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      return null;
    }
    if (!parsed.event_id || !parsed.event_category || !parsed.store_id) return null;

    return {
      eventId: parsed.event_id,
      eventType: parsed.event_category,
      externalStoreId: parsed.store_id,
      externalOrderId: parsed.order_id,
      raw: parsed,
    };
  }

  async fetchOrder(externalStoreId: string, externalOrderId: string): Promise<MarketplaceOrder> {
    const res = await this.request<DoorDashOrderResponse>("GET", `/stores/${externalStoreId}/orders/${externalOrderId}`);
    return {
      externalOrderId: res.id,
      externalStoreId,
      externalStatus: res.order_status,
      externalCreatedAt: res.created_at,
      customerName: res.consumer?.first_name,
      customerPhone: res.consumer?.phone_number,
      orderType: res.fulfillment_type === "delivery" ? "delivery" : "pickup",
      deliveryAddress: res.delivery_address
        ? {
            line1: res.delivery_address.street ?? "",
            city: res.delivery_address.city,
            state: res.delivery_address.state,
            postalCode: res.delivery_address.zip_code,
            country: res.delivery_address.country,
          }
        : undefined,
      items: (res.items ?? []).map((item) => ({
        externalItemId: item.id,
        name: item.name,
        quantity: item.quantity,
        unitPriceCents: item.unit_price,
        modifiers: (item.options ?? []).map((o) => ({ externalOptionId: o.id, name: o.name, priceCents: o.price })),
      })),
      subtotalCents: res.subtotal,
      totalCents: res.total,
      currency: res.currency ?? "USD",
      customerNotes: res.special_instructions,
      raw: res,
    };
  }

  async acceptOrder(externalStoreId: string, externalOrderId: string): Promise<void> {
    await this.request("POST", `/stores/${externalStoreId}/orders/${externalOrderId}/confirm`, {});
  }

  async denyOrder(): Promise<void> {
    throw new MarketplaceProviderError("DoorDash does not support explicit order denial in this adapter", "unsupported_capability");
  }

  async pushMenu(input: PushMenuInput): Promise<PushMenuResult> {
    const res = await this.request<{ categories?: { id: string }[]; items?: { id: string }[] }>(
      "POST",
      `/stores/${input.externalStoreId}/menu`,
      {
        categories: input.categories.map((c) => ({ id: c.externalId, name: c.name, sort_order: c.sortOrder })),
        items: input.items.map((i) => ({
          id: i.externalId,
          name: i.name,
          description: i.description,
          unit_price: i.priceCents,
          category_id: i.categoryExternalId,
          is_active: i.isAvailable,
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
    await this.request("POST", `/stores/${externalStoreId}/menu/items/${externalItemId}`, { is_active: isAvailable });
  }
}

interface DoorDashWebhookPayload {
  event_id?: string;
  event_category?: string;
  store_id?: string;
  order_id?: string;
}

interface DoorDashOrderResponse {
  id: string;
  order_status: string;
  created_at: string;
  fulfillment_type?: string;
  special_instructions?: string;
  consumer?: { first_name?: string; phone_number?: string };
  delivery_address?: { street?: string; city?: string; state?: string; zip_code?: string; country?: string };
  items?: { id: string; name: string; quantity: number; unit_price: number; options?: { id: string; name: string; price: number }[] }[];
  subtotal: number;
  total: number;
  currency?: string;
}
