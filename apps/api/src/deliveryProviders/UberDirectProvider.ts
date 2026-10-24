import { createHmac, timingSafeEqual } from "node:crypto";
import { DeliveryProviderError, type CreateDeliveryInput, type DeliveryContact, type DeliveryProvider, type DeliveryQuoteInput, type DeliveryQuoteResult, type ProviderDeliveryResult, type ProviderDeliverySnapshot, type ProviderDeliveryWebhookEvent } from "./DeliveryProvider.js";
import type { DeliveryStatus } from "@restaurant/types";
import { evictUberDirectToken, getUberDirectToken, type UberDirectTokenRequest } from "./uberDirectTokenCache.js";

const AUTH_URL = "https://auth.uber.com/oauth/v2/token";
const API_BASE_URL = "https://api.uber.com/v1";
const REQUEST_TIMEOUT_MS = 10_000;
// Uber issues a token valid for 30 days (2,592,000s per their docs). Phase 89 — tokens are cached
// across adapter instances, per account and credentials, in uberDirectTokenCache.ts (which also
// owns the refresh margin), instead of on each short-lived instance.
const DEFAULT_TOKEN_LIFETIME_SECONDS = 2_592_000;

/**
 * The first real third-party courier provider selected for this phase — chosen per the mission's
 * own criteria: a direct merchant-dispatch API (not a marketplace/ordering integration like
 * foodpanda's Partner API), broad documentation quality, and an architecture (OAuth2 client
 * credentials, a normal REST quote→create→track→cancel lifecycle, HMAC webhooks) that generalizes
 * well to the other priority providers named for this platform's markets (Careem's Delivery APIs
 * follow a materially similar shape) — see docs/delivery-integrations.md for the full comparison.
 *
 * Researched directly against Uber's own current documentation
 * (developer.uber.com/docs/deliveries) and Uber's own official SDK source
 * (github.com/uber/uber-direct-sdk), not invented. What follows is deliberately explicit about
 * which parts are VERIFIED against those two independent real sources versus reasonably inferred:
 *
 * VERIFIED (from Uber's own docs + the official SDK, cross-checked against each other):
 *  - Auth: POST https://auth.uber.com/oauth/v2/token, grant_type=client_credentials,
 *    scope=eats.deliveries, form-encoded body with client_id/client_secret — returns a bearer
 *    access_token valid ~2,592,000 seconds.
 *  - Base URL: https://api.uber.com/v1/customers/{customer_id} — every delivery operation is
 *    scoped under the merchant's own Uber-issued customer_id.
 *  - POST /delivery_quotes — pickup_address/dropoff_address in, quote id + fee + currency +
 *    duration estimate out. "Access to this API may require written approval from Uber" per
 *    Uber's own docs — a real commercial/approval gate, not a technical one this adapter can work
 *    around.
 *  - POST /deliveries — quote_id, pickup_name/pickup_address/pickup_phone_number,
 *    dropoff_name/dropoff_address/dropoff_phone_number, manifest_items[] (name/quantity/size) in;
 *    id/status/tracking_url out.
 *  - GET /deliveries/{delivery_id} — full current delivery snapshot.
 *  - POST /deliveries/{delivery_id}/cancel.
 *  - Webhook: header `x-uber-signature`, a lowercase-hex HMAC-SHA256 of the raw request body using
 *    the webhook's own signing secret (issued per-webhook in Uber's dashboard, separate from the
 *    OAuth client secret). Event envelope: `kind: "event.delivery_status"`, with `delivery_id`,
 *    `status`, and a nested `data` object. Status enum (Uber's own webhook reference page):
 *    pending, pickup, pickup_complete, dropoff, delivered, canceled, returned,
 *    (shopping_completed — grocery/retail use case, not applicable to a restaurant menu order).
 *
 * NOT independently verified against a live payload (reasonable, documented inference — never
 * invented — but not exercised against real traffic):
 *  - `pickup_address`/`dropoff_address` are accepted as a JSON-encoded string of a structured
 *    address (street_address/city/state/zip_code/country) per Uber's documented address format —
 *    the exact field-by-field shape of that structure was not independently confirmed against a
 *    live response, only against the documented convention.
 *  - The precise shape of `data.courier` (name/phone) inside a webhook payload — present per the
 *    field list Uber's own webhook reference documents, but this adapter's mapping of it
 *    (courierName/courierPhone) was not confirmed against a real payload.
 *
 * Like StripeProvider/SafepayProvider in this codebase, this adapter has never been run against a
 * live Uber Direct account — no credentials were available when it was written (Uber's own docs
 * note delivery_quotes access "may require written approval"). See docs/delivery-integrations.md
 * for exactly what this means for verification status: IMPLEMENTED, MOCK VERIFIED (a fully unit-
 * tested double simulating Uber's documented responses), NOT sandbox/live verified.
 */
export class UberDirectProvider implements DeliveryProvider {
  readonly name = "uber_direct";
  readonly signatureHeaderName = "x-uber-signature";

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly customerId: string,
    private readonly webhookSigningSecret: string,
    /** Phase 89 — TEST MODE ONLY (scripts/uberDirectSandboxCheck.ts): ask Uber for its simulated
     *  "robo courier" (test_specifications), so a test-mode delivery runs its full lifecycle with no
     *  real courier. Never set by restaurantDeliveryProvider.ts — production deliveries never send it. */
    private readonly options: {
      testRoboCourier?: boolean;
      /** Phase 89 — token-cache isolation scope: the delivery-provider account id (set by
       *  restaurantDeliveryProvider.ts). Tokens are only ever shared between instances with the
       *  same scope AND the same client id/secret. */
      tokenScope?: string;
    } = {}
  ) {}

  private get tokenRequest(): UberDirectTokenRequest {
    return { scope: this.options.tokenScope ?? "unscoped", clientId: this.clientId, clientSecret: this.clientSecret };
  }

  private getAccessToken(): Promise<string> {
    return getUberDirectToken(this.tokenRequest, () => this.requestNewToken());
  }

  private async requestNewToken(): Promise<{ value: string; expiresInSeconds: number }> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
      scope: "eats.deliveries",
    });
    const res = await this.withTimeout((signal) =>
      fetch(AUTH_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal })
    );
    const json = await this.parseJson<{ access_token?: string; expires_in?: number }>(res, "authenticate");
    if (!res.ok || typeof json.access_token !== "string" || !json.access_token) {
      throw new DeliveryProviderError(`Uber Direct authentication failed (HTTP ${res.status})`, "invalid_credentials");
    }
    return { value: json.access_token, expiresInSeconds: json.expires_in ?? DEFAULT_TOKEN_LIFETIME_SECONDS };
  }

  private async withTimeout(run: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await run(controller.signal);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new DeliveryProviderError("Uber Direct request timed out", "timeout");
      }
      throw new DeliveryProviderError(`Could not reach Uber Direct: ${(err as Error).message}`, "provider_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseJson<T>(res: Response, action: string): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw new DeliveryProviderError(`Uber Direct returned an unreadable response while trying to ${action} (HTTP ${res.status})`, "provider_error");
    }
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const res = await this.withTimeout((signal) =>
      fetch(`${API_BASE_URL}/customers/${this.customerId}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      })
    );
    // A token Uber no longer accepts (revoked, rotated credentials) must not stay cached for the
    // rest of its 30 days; the next call fetches a new one.
    if (res.status === 401) evictUberDirectToken(this.tokenRequest, token);
    const json = await this.parseJson<T & { code?: string; message?: string }>(res, path);
    if (!res.ok) throw uberError(res.status, json as { code?: string; message?: string });
    return json;
  }

  /** Uber's documented address format: a JSON-encoded string of a structured address
   *  (street_address[], city, state, zip_code, country). Phase 89 — built from the real address
   *  fields; the old version put the whole one-line address into street_address, leaving Uber to
   *  guess the city/postcode/country. Falls back to that single line only when no parts exist. */
  private formatAddress(contact: Pick<DeliveryContact, "address" | "addressParts">): string {
    const parts = contact.addressParts;
    if (!parts || !parts.street.length) return JSON.stringify({ street_address: [contact.address] });
    return JSON.stringify({
      street_address: parts.street,
      ...(parts.city ? { city: parts.city } : {}),
      ...(parts.state ? { state: parts.state } : {}),
      ...(parts.postalCode ? { zip_code: parts.postalCode } : {}),
      ...(parts.country ? { country: parts.country } : {}),
    });
  }

  /** Phase 89 — exact coordinates, so Uber never has to geocode an address we already resolved. */
  private coordinates(prefix: "pickup" | "dropoff", contact: Pick<DeliveryContact, "latitude" | "longitude">): Record<string, number> {
    return Number.isFinite(contact.latitude) && Number.isFinite(contact.longitude)
      ? { [`${prefix}_latitude`]: contact.latitude, [`${prefix}_longitude`]: contact.longitude }
      : {};
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.getAccessToken();
      return true;
    } catch {
      return false;
    }
  }

  async getQuote(input: DeliveryQuoteInput): Promise<DeliveryQuoteResult> {
    const res = await this.request<{ id: string; fee: number; currency: string; duration?: number }>("POST", "/delivery_quotes", {
      pickup_address: this.formatAddress(input.pickup),
      dropoff_address: this.formatAddress(input.dropoff),
      ...this.coordinates("pickup", input.pickup),
      ...this.coordinates("dropoff", input.dropoff),
      ...(input.pickup.phone ? { pickup_phone_number: input.pickup.phone } : {}),
      ...(input.dropoff.phone ? { dropoff_phone_number: input.dropoff.phone } : {}),
    });
    const currency = (res.currency ?? input.currency).toUpperCase();
    return { quoteId: res.id, fee: fromMinorUnits(res.fee, currency), currency, estimatedDurationMinutes: res.duration, raw: res };
  }

  async createDelivery(input: CreateDeliveryInput): Promise<ProviderDeliveryResult> {
    const res = await this.request<{ id: string; status: string; tracking_url?: string; fee?: number; currency?: string }>(
      "POST",
      "/deliveries",
      {
        quote_id: input.quoteId,
        pickup_name: input.pickup.name,
        pickup_address: this.formatAddress(input.pickup),
        ...this.coordinates("pickup", input.pickup),
        pickup_phone_number: input.pickup.phone,
        pickup_notes: input.pickup.notes,
        dropoff_name: input.dropoff.name,
        dropoff_address: this.formatAddress(input.dropoff),
        ...this.coordinates("dropoff", input.dropoff),
        dropoff_phone_number: input.dropoff.phone,
        dropoff_notes: input.dropoff.notes,
        manifest_items: input.manifestItems.map((item) => ({ name: item.name, quantity: item.quantity })),
        external_id: input.orderId,
        // Phase 89 — Uber's documented idempotency is this BODY field (kept by Uber for 60 minutes);
        // the Idempotency-Key header sent before isn't part of its API. Stable per order, so a
        // retry after a lost response can't book a second courier.
        idempotency_key: input.idempotencyKey,
        ...(this.options.testRoboCourier ? { test_specifications: { robo_courier_specification: { mode: "auto" } } } : {}),
      }
    );
    return {
      providerDeliveryId: res.id,
      status: mapUberStatus(res.status),
      trackingUrl: res.tracking_url,
      fee: res.fee == null ? undefined : fromMinorUnits(res.fee, res.currency),
      currency: res.currency?.toUpperCase(),
      raw: res,
    };
  }

  async getDelivery(providerDeliveryId: string): Promise<ProviderDeliverySnapshot> {
    const res = await this.request<{
      id: string;
      status: string;
      tracking_url?: string;
      fee?: number;
      currency?: string;
      courier?: { name?: string; phone_number?: string };
      pickup_eta?: string;
      dropoff_eta?: string;
    }>("GET", `/deliveries/${providerDeliveryId}`);
    return {
      providerDeliveryId: res.id,
      status: mapUberStatus(res.status),
      trackingUrl: res.tracking_url,
      fee: res.fee == null ? undefined : fromMinorUnits(res.fee, res.currency),
      currency: res.currency?.toUpperCase(),
      courierName: res.courier?.name,
      courierPhone: res.courier?.phone_number,
      pickupEta: res.pickup_eta,
      dropoffEta: res.dropoff_eta,
      raw: res,
    };
  }

  /** Uber's cancel endpoint takes no request body (Phase 89 — the cancellation_reason sent before
   *  isn't part of its API); the reason stays in our own delivery history only. */
  async cancelDelivery(providerDeliveryId: string, _reason?: string): Promise<{ cancelled: boolean }> {
    await this.request("POST", `/deliveries/${providerDeliveryId}/cancel`);
    return { cancelled: true };
  }

  /** Phase 89 — an account can be connected before its webhook signing secret is added (the
   *  owner needs the webhook URL to obtain one). Until then EVERY webhook is rejected: an HMAC keyed
   *  with an empty secret is one anyone could compute. */
  get hasWebhookSigningSecret(): boolean {
    return this.webhookSigningSecret.length > 0;
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): ProviderDeliveryWebhookEvent | null {
    if (!signatureHeader || !this.hasWebhookSigningSecret) return null;
    const expected = createHmac("sha256", this.webhookSigningSecret).update(rawBody).digest("hex");
    const expectedBuf = Buffer.from(expected, "utf-8");
    const actualBuf = Buffer.from(signatureHeader, "utf-8");
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return null;

    let parsed: UberWebhookPayload;
    try {
      parsed = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      return null;
    }
    if (parsed.kind !== "event.delivery_status" || !parsed.delivery_id || !parsed.status) return null;

    return {
      eventId: parsed.id ?? `${parsed.delivery_id}:${parsed.status}:${parsed.data?.updated ?? parsed.created ?? ""}`,
      eventType: parsed.kind,
      providerDeliveryId: parsed.delivery_id,
      status: mapUberStatus(parsed.status),
      courierName: parsed.data?.courier?.name,
      courierPhone: parsed.data?.courier?.phone_number,
      trackingUrl: parsed.data?.tracking_url,
      cancelReason: parsed.data?.cancelation_reason,
      raw: parsed,
    };
  }
}

interface UberWebhookPayload {
  id?: string;
  kind?: string;
  delivery_id?: string;
  status?: string;
  created?: string;
  data?: {
    updated?: string;
    tracking_url?: string;
    cancelation_reason?: string;
    courier?: { name?: string; phone_number?: string };
  };
}

/**
 * Maps Uber's own documented status strings onto this platform's normalized DeliveryStatus — the
 * one place Uber's vocabulary is allowed to exist. Anything unrecognized fails closed to
 * "requested" (never silently "delivered"), mirroring this codebase's existing
 * mapSafepayStatus/mapPaddleStatus "fail closed to a non-final state" convention.
 */
function mapUberStatus(uberStatus: string): DeliveryStatus {
  switch (uberStatus) {
    case "pending":
      return "requested";
    case "pickup":
      return "driver_assigned";
    case "pickup_complete":
      return "picked_up";
    case "dropoff":
      return "out_for_delivery";
    case "delivered":
      return "delivered";
    case "canceled":
      return "cancelled";
    case "returned":
      return "failed";
    default:
      return "requested";
  }
}

/** Uber states fees in the currency's smallest unit ("cents"); this platform stores money in the
 *  main unit (Order.deliveryFee is 3.99, not 399) — Phase 89 converts at the boundary so a
 *  Delivery's provider fee and the customer's delivery fee are directly comparable. */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "CLP", "VND", "ISK", "UGX", "XAF", "XOF", "PYG"]);
function fromMinorUnits(amount: number, currency?: string): number {
  return ZERO_DECIMAL_CURRENCIES.has((currency ?? "").toUpperCase()) ? amount : Math.round(amount) / 100;
}

/**
 * Phase 89 — Uber Direct's documented error responses (status → code), checked against the
 * OpenAPI types of Uber's official SDK (github.com/uber/uber-direct-sdk, src/types/deliveries.d.ts):
 * 400 invalid_params, 401 unauthorized, 402 customer_suspended, 403 customer_blocked,
 * 404 customer_not_found (quote/create) or delivery_not_found, 408 request_timeout,
 * 409 duplicate_delivery, 429 customer_limited, 500 internal_server_error, 503 couriers_busy.
 * Each becomes a message a restaurant's staff can act on; Uber's own message is appended.
 */
function uberError(status: number, body: { code?: string; message?: string }): DeliveryProviderError {
  const code = body?.code ?? "";
  const detail = body?.message ?? `HTTP ${status}`;
  if (code.startsWith("address_undeliverable")) {
    return new DeliveryProviderError(`Uber Direct does not deliver between these addresses: ${detail}`, "outside_service_area");
  }
  switch (status) {
    case 400:
    case 422:
      return new DeliveryProviderError(`Uber Direct rejected the delivery details: ${detail}`, "invalid_address");
    case 401:
      return new DeliveryProviderError(`Uber Direct rejected these credentials: ${detail}`, "invalid_credentials");
    case 402:
      return new DeliveryProviderError(`The Uber Direct account is suspended — contact Uber: ${detail}`, "invalid_credentials");
    case 403:
      return new DeliveryProviderError(`The Uber Direct account is blocked — contact Uber: ${detail}`, "invalid_credentials");
    case 404:
      return code === "customer_not_found"
        ? new DeliveryProviderError(`Uber Direct doesn't recognize this Customer ID — check the connected account: ${detail}`, "invalid_credentials")
        : new DeliveryProviderError(`Uber Direct: ${detail}`, "not_found");
    case 408:
      return new DeliveryProviderError(`Uber Direct timed out: ${detail}`, "timeout");
    case 409:
      return new DeliveryProviderError(
        `Uber Direct says this delivery was already requested (duplicate_delivery) — check the Uber Direct dashboard before retrying: ${detail}`,
        "provider_error"
      );
    case 429:
      return new DeliveryProviderError(`Uber Direct rate limit reached: ${detail}`, "rate_limited");
    case 503:
      return new DeliveryProviderError(`No Uber couriers are available right now — retry shortly: ${detail}`, "provider_unavailable");
    default:
      return new DeliveryProviderError(`Uber Direct error: ${detail}`, "provider_error");
  }
}

export { mapUberStatus, fromMinorUnits };
