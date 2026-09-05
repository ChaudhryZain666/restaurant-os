import { createHmac, timingSafeEqual } from "node:crypto";
import { DeliveryProviderError, type CreateDeliveryInput, type DeliveryProvider, type DeliveryQuoteInput, type DeliveryQuoteResult, type ProviderDeliveryResult, type ProviderDeliverySnapshot, type ProviderDeliveryWebhookEvent } from "./DeliveryProvider.js";
import type { DeliveryStatus } from "@restaurant/types";

const AUTH_URL = "https://auth.uber.com/oauth/v2/token";
const API_BASE_URL = "https://api.uber.com/v1";
const REQUEST_TIMEOUT_MS = 10_000;
// Uber issues a token valid for 30 days (2,592,000s per their docs); refreshing a full day early
// is cheap insurance against clock skew/edge-of-expiry races, never a meaningful extra cost against
// a token this long-lived.
const TOKEN_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

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

  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly customerId: string,
    private readonly webhookSigningSecret: string
  ) {}

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return this.cachedToken.value;
    }
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
    if (!res.ok || !json.access_token) {
      throw new DeliveryProviderError(`Uber Direct authentication failed (HTTP ${res.status})`, "invalid_credentials");
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

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const token = await this.getAccessToken();
    const res = await this.withTimeout((signal) =>
      fetch(`${API_BASE_URL}/customers/${this.customerId}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      })
    );
    const json = await this.parseJson<T & { code?: string; message?: string }>(res, path);
    if (!res.ok) {
      const message = (json as { message?: string })?.message ?? `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new DeliveryProviderError(`Uber Direct rejected these credentials: ${message}`, "invalid_credentials");
      if (res.status === 429) throw new DeliveryProviderError(`Uber Direct rate limit reached: ${message}`, "rate_limited");
      if (res.status === 404) throw new DeliveryProviderError(`Uber Direct: ${message}`, "not_found");
      if (res.status === 422) throw new DeliveryProviderError(`Uber Direct could not deliver to this address: ${message}`, "invalid_address");
      throw new DeliveryProviderError(`Uber Direct error: ${message}`, "provider_error");
    }
    return json;
  }

  /** Uber's documented address format: a JSON-encoded string of a structured address. Only the
   *  fields this adapter can honestly populate from what it's given are set — see this file's
   *  header comment on what's verified vs inferred here. */
  private formatAddress(address: string): string {
    return JSON.stringify({ street_address: [address] });
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
      pickup_address: this.formatAddress(input.pickup.address),
      dropoff_address: this.formatAddress(input.dropoff.address),
    });
    return { quoteId: res.id, fee: res.fee, currency: res.currency ?? input.currency, estimatedDurationMinutes: res.duration, raw: res };
  }

  async createDelivery(input: CreateDeliveryInput): Promise<ProviderDeliveryResult> {
    const res = await this.request<{ id: string; status: string; tracking_url?: string; fee?: number; currency?: string }>(
      "POST",
      "/deliveries",
      {
        quote_id: input.quoteId,
        pickup_name: input.pickup.name,
        pickup_address: this.formatAddress(input.pickup.address),
        pickup_phone_number: input.pickup.phone,
        pickup_notes: input.pickup.notes,
        dropoff_name: input.dropoff.name,
        dropoff_address: this.formatAddress(input.dropoff.address),
        dropoff_phone_number: input.dropoff.phone,
        dropoff_notes: input.dropoff.notes,
        manifest_items: input.manifestItems.map((item) => ({ name: item.name, quantity: item.quantity })),
        external_id: input.orderId,
      },
      input.idempotencyKey
    );
    return {
      providerDeliveryId: res.id,
      status: mapUberStatus(res.status),
      trackingUrl: res.tracking_url,
      fee: res.fee,
      currency: res.currency,
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
      fee: res.fee,
      currency: res.currency,
      courierName: res.courier?.name,
      courierPhone: res.courier?.phone_number,
      pickupEta: res.pickup_eta,
      dropoffEta: res.dropoff_eta,
      raw: res,
    };
  }

  async cancelDelivery(providerDeliveryId: string, reason?: string): Promise<{ cancelled: boolean }> {
    await this.request("POST", `/deliveries/${providerDeliveryId}/cancel`, reason ? { cancellation_reason: reason } : undefined);
    return { cancelled: true };
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): ProviderDeliveryWebhookEvent | null {
    if (!signatureHeader) return null;
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

export { mapUberStatus };
