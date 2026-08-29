import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CreateIntentInput,
  PaymentProvider,
  ProviderIntent,
  ProviderPaymentSnapshot,
  ProviderPaymentStatus,
  ProviderRefundResult,
  ProviderWebhookEvent,
} from "./PaymentProvider.js";

const BASE_URL = "https://api.stripe.com";
const REQUEST_TIMEOUT_MS = 10_000;
// Stripe's own documented recommendation — reject a webhook whose timestamp is older than this,
// even if the HMAC itself checks out, to close a replay window. Mirrors
// billing/PaddleBillingProvider.ts's WEBHOOK_MAX_AGE_SECONDS precedent exactly.
const WEBHOOK_MAX_AGE_SECONDS = 300;

/**
 * Phase 34's second restaurant-payment adapter — Safepay (SafepayProvider.ts) is deliberately
 * Pakistan-only (docs/payment-provider-decision.md), so this is the sanctioned second adapter that
 * doc already anticipated ("a StripeProvider... can be added later, selected the same way, without
 * touching PaymentService or any controller"), for the countries Stripe actually covers.
 *
 * Built against Stripe's real, publicly-documented REST API — unlike Safepay/Paddle, Stripe's full
 * API reference is entirely public with no authenticated-account wall, so more of this adapter is
 * VERIFIED than either of those. Still, like both, it has never been exercised against a live
 * (even test-mode) Stripe account in this environment — no credentials were available when it was
 * written. See docs/payment-provider-decision.md's Phase 34 addendum.
 *
 * VERIFIED (from Stripe's own public API reference):
 *  - Base host: api.stripe.com. Auth: a secret key as a Bearer token.
 *  - Requests are application/x-www-form-urlencoded (NOT JSON) — a well-known, commonly-missed
 *    Stripe API quirk; responses are JSON.
 *  - Deliberately built against Stripe **Checkout Sessions** (`/v1/checkout/sessions`), not raw
 *    PaymentIntents directly: a Checkout Session returns a real hosted-checkout `url` matching this
 *    codebase's existing PaymentProvider contract (ProviderIntent.clientSecret is redirected to
 *    directly by OrderPaymentPanel.tsx for every non-mock provider, exactly like
 *    SafepayProvider.createIntent's checkoutUrl) — raw PaymentIntent client_secret values are NOT
 *    URLs and need Stripe.js/Elements on the frontend to consume, which nothing in this codebase
 *    integrates; Checkout Sessions avoids that gap entirely with zero frontend changes.
 *  - Webhook signing: the `Stripe-Signature` header is `t=<unix_seconds>,v1=<hex_hmac>[,v0=...]`;
 *    the HMAC-SHA256 is computed over the STRING `${t}.${rawBody}` using the webhook signing
 *    secret. Stripe's own guidance is to reject anything older than a few minutes even if the
 *    signature matches — implemented below as WEBHOOK_MAX_AGE_SECONDS, mirroring Paddle's identical
 *    documented recommendation.
 *  - Refunds are against a PaymentIntent (or Charge) id, not a Checkout Session id — a completed
 *    session's `payment_intent` field carries that id, so refund() retrieves the session first to
 *    resolve it (one extra GET), then calls `/v1/refunds`.
 *
 * NOT independently re-verified against a live payload (reasonable inference from Stripe's
 * documented event-naming convention, not confirmed against real webhook traffic):
 *  - The exact set of `checkout.session.*` event payload shapes this adapter reads
 *    (`data.object.id`, `.payment_status`, `.payment_intent`) — mapCheckoutSessionStatus fails
 *    closed to "pending" for anything unrecognized, never silently "paid", mirroring
 *    SafepayProvider.ts's mapSafepayStatus/PaddleBillingProvider.ts's mapPaddleStatus philosophy.
 *
 * None of this may be trusted for real money movement until it has been run against a real (even
 * test-mode) Stripe account and reconciled with an actual webhook payload. Until then,
 * PAYMENT_PROVIDER=stripe (or a per-restaurant eligibility-engine routing to it — see
 * payments/eligibility.ts) is real, network-capable code — not a second mock.
 */
export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  // Verified — see this file's top comment.
  readonly signatureHeaderName = "stripe-signature";

  /**
   * Phase 37 — `connectedAccountId`, when set, makes every request below a Direct Charge acting
   * "as" that Stripe Connect connected account (the `Stripe-Account` header — Stripe's own
   * documented mechanism for a platform to act on a connected account's behalf using ONLY the
   * platform's own secret key). This is precisely what makes it possible to never collect or store
   * a restaurant's own Stripe secret key: `secretKey` here is always the PLATFORM's key, never the
   * restaurant's. `webhookSecret` is unused/irrelevant when `connectedAccountId` is set — Connect
   * webhook verification is centralized (see stripeConnect.ts's verifyStripeSignature, used
   * directly by paymentWebhook.controller.ts's handleStripeConnectWebhook) rather than per-instance.
   */
  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    private readonly baseUrl: string = BASE_URL,
    private readonly connectedAccountId?: string
  ) {}

  private async request<T>(method: "GET" | "POST", path: string, form?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${this.secretKey}`,
          ...(this.connectedAccountId ? { "Stripe-Account": this.connectedAccountId } : {}),
        },
        body: form ? encodeForm(form) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw new Error("Stripe request timed out");
      throw new Error(`Could not reach Stripe: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Stripe returned an unreadable response (HTTP ${res.status})`);
    }

    if (!res.ok) {
      const message = (json as { error?: { message?: string } })?.error?.message;
      throw new Error(`Stripe returned HTTP ${res.status}${message ? `: ${message}` : ""}`);
    }

    return json as T;
  }

  async createIntent(input: CreateIntentInput): Promise<ProviderIntent> {
    const response = await this.request<StripeCheckoutSession>("POST", "/v1/checkout/sessions", {
      mode: "payment",
      client_reference_id: input.orderId,
      success_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      metadata: { ...input.metadata, restaurantId: input.restaurantId, orderId: input.orderId },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: Math.round(input.amount * 100),
            product_data: { name: `Order ${input.metadata?.orderNumber ?? input.orderId}` },
          },
        },
      ],
    });
    if (!response.id || !response.url) throw new Error("Stripe did not return a checkout session id/url");
    return { providerRef: response.id, status: "pending", clientSecret: response.url };
  }

  async retrieve(providerRef: string): Promise<ProviderPaymentSnapshot> {
    const session = await this.request<StripeCheckoutSession>("GET", `/v1/checkout/sessions/${providerRef}`);
    return {
      providerRef,
      status: mapCheckoutSessionStatus(session.status, session.payment_status),
      amount: typeof session.amount_total === "number" ? session.amount_total / 100 : 0,
      currency: session.currency ?? "",
      raw: session,
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): ProviderWebhookEvent | null {
    return verifyStripeSignature(rawBody, signatureHeader, this.webhookSecret);
  }

  async refund(providerRef: string, amount: number, _reason?: string): Promise<ProviderRefundResult> {
    // providerRef is the Checkout Session id (see createIntent) — a refund is against the
    // underlying PaymentIntent, so resolve it first. See this file's top comment.
    const session = await this.request<StripeCheckoutSession>("GET", `/v1/checkout/sessions/${providerRef}`);
    if (!session.payment_intent) throw new Error("Stripe checkout session has no associated payment_intent to refund");

    const response = await this.request<StripeRefund>("POST", "/v1/refunds", {
      payment_intent: session.payment_intent,
      amount: Math.round(amount * 100),
    });
    if (!response.id) throw new Error("Stripe did not return a refund id");

    const status: ProviderRefundResult["status"] =
      response.status === "succeeded" ? "succeeded" : response.status === "failed" ? "failed" : "pending";
    return { refundRef: response.id, status };
  }

  // BYOC connect-time check (restaurantProvider.ts) — GET /v1/balance is Stripe's own documented
  // cheapest "is this key valid and live" call: read-only, no side effects, works for any
  // authenticated secret key regardless of account configuration.
  async verifyCredentials(): Promise<boolean> {
    try {
      await this.request("GET", "/v1/balance");
      return true;
    } catch {
      return false;
    }
  }
}

interface StripeCheckoutSession {
  id?: string;
  url?: string;
  status?: string;
  payment_status?: string;
  payment_intent?: string;
  amount_total?: number;
  currency?: string;
}

interface StripeRefund {
  id?: string;
  status?: string;
}

interface StripeWebhookPayload {
  id?: string;
  type?: string;
  data?: { object?: StripeCheckoutSession };
}

/**
 * Phase 37 — the pure cryptographic half of verifyWebhookSignature, extracted so
 * stripeConnect.ts's centralized Connect webhook handler can verify a signature without needing a
 * whole StripeProvider instance (which would otherwise require a meaningless placeholder secretKey
 * just to satisfy the constructor). Returns the ALREADY-JSON-PARSED body on success — every caller
 * needs that anyway, and parsing twice would be wasted work — or null if the signature/timestamp
 * don't check out, exactly mirroring verifyWebhookSignature's own failure semantics below.
 */
export function verifyStripeSignatureRaw(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  webhookSecret: string
): Record<string, unknown> | null {
  if (!signatureHeader) return null;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value] as [string, string];
    })
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return null;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(ageSeconds) || ageSeconds > WEBHOOK_MAX_AGE_SECONDS) return null;

  const signedPayload = `${t}.${rawBody.toString("utf-8")}`;
  const expected = createHmac("sha256", webhookSecret).update(signedPayload).digest("hex");

  let expectedBuf: Buffer;
  let providedBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expected, "hex");
    providedBuf = Buffer.from(v1, "hex");
  } catch {
    return null;
  }
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) return null;

  try {
    return JSON.parse(rawBody.toString("utf-8"));
  } catch {
    return null;
  }
}

/** The pooled/BYOC checkout-session-shaped mapping on top of verifyStripeSignatureRaw — unchanged
 *  behavior from before this function existed, just no longer duplicating the HMAC logic inline. */
export function verifyStripeSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  webhookSecret: string
): ProviderWebhookEvent | null {
  const parsed = verifyStripeSignatureRaw(rawBody, signatureHeader, webhookSecret) as StripeWebhookPayload | null;
  if (!parsed) return null;

  const eventId = parsed.id;
  const eventType = parsed.type;
  const session = parsed.data?.object;
  if (!eventId || !eventType || !session?.id) return null;

  return {
    eventId,
    eventType,
    providerRef: session.id,
    status: mapCheckoutSessionStatus(eventType === "checkout.session.expired" ? "expired" : session.status, session.payment_status),
    raw: parsed,
  };
}

/**
 * Fails closed by design: any status this adapter doesn't specifically recognize maps to "pending"
 * rather than "paid"/"failed" — mirrors SafepayProvider.ts's mapSafepayStatus philosophy exactly.
 * A Checkout Session's `payment_status` ("paid"/"unpaid"/"no_payment_required") is the actual
 * signal for whether money moved; `status` ("open"/"complete"/"expired") only says whether the
 * session itself is still usable.
 */
export function mapCheckoutSessionStatus(status: string | undefined, paymentStatus: string | undefined): ProviderPaymentStatus {
  if (status === "expired") return "cancelled";
  if (paymentStatus === "paid" || paymentStatus === "no_payment_required") return "paid";
  if (status === "complete") return "paid";
  if (status === "open") return "pending";
  return "pending";
}

/** Flattens a nested object into Stripe's bracket-notation form encoding (`a[b][c]=x`,
 *  `a[0][b]=x` for arrays) — Stripe's REST API requires application/x-www-form-urlencoded bodies,
 *  never JSON, for nested parameters like line_items/metadata/price_data. */
function encodeForm(input: Record<string, unknown>): string {
  const params = new URLSearchParams();
  const walk = (prefix: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(`${prefix}[${i}]`, item));
    } else if (typeof value === "object") {
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        walk(`${prefix}[${key}]`, val);
      }
    } else {
      params.append(prefix, String(value));
    }
  };
  for (const [key, value] of Object.entries(input)) walk(key, value);
  return params.toString();
}
