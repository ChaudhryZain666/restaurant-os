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

const SANDBOX_BASE_URL = "https://sandbox.api.getsafepay.com";
const PRODUCTION_BASE_URL = "https://api.getsafepay.com";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Everything below the request-shaping helpers is genuinely wired against Safepay's real
 * sandbox/production hosts and their published auth model — but this adapter has never been
 * exercised against a live Safepay account (no credentials were available when it was written;
 * see docs/payment-provider-decision.md). Two categories of fact went into it:
 *
 * VERIFIED (from Safepay's own docs/SDK source, fetched while building this):
 *  - Base hosts: sandbox.api.getsafepay.com / api.getsafepay.com.
 *  - Auth model: a merchant API key + a secret key ("authType: 'secret'" in their Node SDK).
 *  - A tracker/session is created by posting amount + currency (+ order metadata), returning an
 *    opaque token; the customer is then sent to a hosted checkout page carrying that token,
 *    orderId, cancelUrl, redirectUrl, and a `source`/`webhooks` flag (mirrors safepay-node's
 *    `checkout.create({token, orderId, cancelUrl, redirectUrl, source, webhooks})`).
 *  - Webhooks are HMAC-signed and Safepay's own SDK ships a `verify.signature()`/`verify.webhook()`
 *    helper, confirming signature verification is real and expected of integrators.
 *
 * UPDATED (Phase 29 — found via a third-party community integration writeup, NOT Safepay's own
 * reference docs, so still one notch below "verified" — but more specific than what Phase 15 had):
 *  - Tracker creation path is `/order/v1/init`, not `/order/v1/payments` as originally guessed —
 *    corrected below. Response carries `data.token` and `data.state` (e.g. `"TRACKER_STARTED"`,
 *    already covered by `mapSafepayStatus`'s fail-closed-to-"pending" default).
 *  - The hosted checkout page itself may live at a `/components` path on a *different* host
 *    (`www.getsafepay.com` in production per that writeup, not `api.getsafepay.com`) — left
 *    unchanged below pending real verification, since acting on a single unofficial source for a
 *    URL customers are actually redirected to is riskier than for a server-to-server POST path.
 *  - redirectUrl/cancelUrl are real, required params for checkout.create() (now wired through from
 *    CreateIntentInput below) — confirmed by two independent sources.
 *
 * UPDATED (Phase 34 closure — re-verified with WebSearch/WebFetch against the official
 * `getsafepay/sfpy-php` SDK's published README, without live credentials to test against; no
 * sandbox account was available this pass — see the credential request in
 * docs/payment-provider-decision.md):
 *  - The webhook signature header is `X-SFPY-SIGNATURE` — CORRECTED below from the previously
 *    assumed `x-safepay-signature`, which was simply wrong (confirmed directly from the official
 *    SDK's own documented usage, not a community source). Under the old name, a real Safepay
 *    webhook would have arrived and been silently read as "no signature header present" — a safe
 *    failure (verifyWebhookSignature returning null), but a failure nonetheless, on every single
 *    real webhook.
 *  - The official SDK's README also documents `intent`/`mode` as fields on order/tracker setup and
 *    `merchant_api_key` as a real field name matching what's already sent below — but does NOT
 *    expose the raw REST field names or checkout-URL query-parameter shape (the PHP/`.NET` SDKs
 *    both abstract the transport layer, so their source doesn't show it).
 *  - A separate, single, self-described-as-possibly-outdated community integration guide (a public
 *    gist, not Safepay's own material) describes a MATERIALLY different checkout-URL shape
 *    (`/components` with `beacon`/`env` query params, snake_case field names) and a webhook
 *    signature scheme that HMACs the tracker token alone rather than the raw body — both
 *    plausible, neither corroborated by a second source, and the source itself flags its own
 *    docs as stale. Exactly the same judgment call this file already made about the `/components`
 *    host above: acting on one unconfirmed, self-flagged-outdated source for the customer-facing
 *    checkout URL or the webhook HMAC scheme is riskier than leaving it as the best-documented
 *    (official-SDK-derived) guess until a real sandbox account can confirm it directly.
 *
 * STILL ASSUMED / NOT VERIFIED (Safepay's full API reference is a JS app that couldn't be read
 * without an authenticated account, and no refund endpoint surfaced anywhere reachable):
 *  - The refund REST path (`/order/v1/refunds`) and the exact status vocabulary beyond what's
 *    noted above. `mapSafepayStatus` is defensive (unknown values fail closed to "pending", never
 *    silently "paid") for exactly this reason.
 *  - Refunds specifically: no evidence of a refund endpoint was found anywhere in the reachable
 *    documentation, official or otherwise — Safepay's own docs categorize refunds under
 *    "Chargebacks, Disputes & Refunds" in merchant-dashboard help content, which is at least
 *    consistent with a refund being dashboard-initiated rather than API-initiated on some
 *    accounts; not confirmed either way. The call below follows this adapter's own conventions
 *    for consistency, but remains the least-trustworthy piece of this file.
 *  - The checkout-URL construction and exact request/response field names beyond what's listed
 *    above as UPDATED.
 *
 * None of this may be trusted for real money movement until it has been run against a real
 * Safepay sandbox account and reconciled with their actual API reference/Postman collection.
 * Until then, `PAYMENT_PROVIDER=safepay` is real, network-capable code — not a second mock.
 */
export class SafepayProvider implements PaymentProvider {
  readonly name = "safepay";
  // Phase 34 closure — corrected from an assumed "x-safepay-signature" to the real header name,
  // confirmed against the official getsafepay/sfpy-php SDK's documented usage ("X-SFPY-SIGNATURE").
  // Header names are case-insensitive over HTTP and Express's req.header() lookup reflects that, so
  // only the actual name (not casing) mattered here — but the old name was a different string
  // entirely, not just a casing mismatch, and would have made every real Safepay webhook read back
  // as "missing signature header" (a safe failure, never a misprocessed one, but still a failure).
  readonly signatureHeaderName = "x-sfpy-signature";

  constructor(
    private readonly apiKey: string,
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    private readonly baseUrl: string = SANDBOX_BASE_URL
  ) {}

  static baseUrlForEnv(safepayEnv: "sandbox" | "production"): string {
    return safepayEnv === "production" ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.secretKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("Safepay request timed out");
      }
      throw new Error(`Could not reach Safepay: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Safepay returned an unreadable response (HTTP ${res.status})`);
    }

    if (!res.ok) {
      const message = (json as { message?: string; error?: string })?.message ?? (json as { error?: string })?.error;
      throw new Error(`Safepay returned HTTP ${res.status}${message ? `: ${message}` : ""}`);
    }

    return json as T;
  }

  async createIntent(input: CreateIntentInput): Promise<ProviderIntent> {
    const response = await this.request<{ data?: { token?: string; tracker?: string } }>(
      "POST",
      "/order/v1/init",
      {
        merchant_api_key: this.apiKey,
        amount: Math.round(input.amount * 100),
        currency: input.currency,
        order_id: input.orderId,
        metadata: { ...input.metadata, restaurantId: input.restaurantId },
      }
    );

    const token = response.data?.token ?? response.data?.tracker;
    if (!token) throw new Error("Safepay did not return a payment token");

    const checkoutUrl = new URL(`${this.baseUrl}/checkout/${token}`);
    checkoutUrl.searchParams.set("orderId", input.orderId);
    checkoutUrl.searchParams.set("source", "custom");
    checkoutUrl.searchParams.set("webhooks", "true");
    checkoutUrl.searchParams.set("redirectUrl", input.returnUrl);
    checkoutUrl.searchParams.set("cancelUrl", input.cancelUrl);

    return { providerRef: token, status: "pending", clientSecret: checkoutUrl.toString() };
  }

  async retrieve(providerRef: string): Promise<ProviderPaymentSnapshot> {
    const response = await this.request<{ data?: { state?: string; status?: string; amount?: number; currency?: string } }>(
      "GET",
      `/order/v1/payments/${providerRef}`
    );
    const raw = response.data ?? {};
    return {
      providerRef,
      status: mapSafepayStatus(raw.state ?? raw.status),
      amount: typeof raw.amount === "number" ? raw.amount / 100 : 0,
      currency: raw.currency ?? "",
      raw,
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): ProviderWebhookEvent | null {
    if (!signatureHeader) return null;
    const expected = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    const provided = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;

    const expectedBuf = Buffer.from(expected, "hex");
    let providedBuf: Buffer;
    try {
      providedBuf = Buffer.from(provided, "hex");
    } catch {
      return null;
    }
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) return null;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      return null;
    }

    const eventId = (parsed.event_id ?? parsed.id ?? parsed.eventId) as string | undefined;
    const eventType = (parsed.event ?? parsed.type ?? parsed.eventType) as string | undefined;
    const providerRef = (parsed.tracker ?? parsed.token ?? parsed.providerRef) as string | undefined;
    const rawStatus = (parsed.state ?? parsed.status) as string | undefined;
    if (!eventId || !eventType || !providerRef || !rawStatus) return null;

    return { eventId, eventType, providerRef, status: mapSafepayStatus(rawStatus), raw: parsed };
  }

  async refund(providerRef: string, amount: number, reason?: string): Promise<ProviderRefundResult> {
    const response = await this.request<{ data?: { refund_id?: string; id?: string; state?: string; status?: string } }>(
      "POST",
      "/order/v1/refunds",
      { tracker: providerRef, amount: Math.round(amount * 100), reason }
    );
    const raw = response.data ?? {};
    const refundRef = raw.refund_id ?? raw.id;
    if (!refundRef) throw new Error("Safepay did not return a refund reference");

    const rawStatus = raw.state ?? raw.status;
    const status: ProviderRefundResult["status"] =
      rawStatus === "succeeded" || rawStatus === "completed" || rawStatus === "SUCCEEDED"
        ? "succeeded"
        : rawStatus === "failed" || rawStatus === "FAILED"
          ? "failed"
          : "pending";

    return { refundRef, status };
  }
}

/**
 * Fails closed by design: any status text this adapter doesn't specifically recognize maps to
 * "pending" rather than "paid" or "failed" — an unrecognized Safepay status should never be
 * silently treated as a successful payment. See this file's top comment: the exact status
 * vocabulary is unverified against a live account.
 */
function mapSafepayStatus(raw: string | undefined): ProviderPaymentStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "PAID":
    case "CAPTURED":
    case "TRACKER_COMPLETED":
    case "COMPLETED":
    case "SUCCEEDED":
      return "paid";
    case "AUTHORIZED":
      return "authorized";
    case "REQUIRES_ACTION":
    case "ACTION_REQUIRED":
      return "requires_action";
    case "FAILED":
    case "DECLINED":
    case "ERROR":
      return "failed";
    case "CANCELLED":
    case "CANCELED":
    case "EXPIRED":
    case "VOIDED":
      return "cancelled";
    default:
      return "pending";
  }
}
