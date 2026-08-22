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
 * ASSUMED / NOT VERIFIED (Safepay's full API reference is a JS app that couldn't be read without
 * an authenticated account, and no refund endpoint surfaced anywhere in public docs or the SDK
 * README):
 *  - The exact REST paths below (`/order/v1/payments`, `/order/v1/refunds`), the exact webhook
 *    signature header name and JSON field names, and the exact status vocabulary Safepay returns.
 *    `mapSafepayStatus` is defensive (unknown values fail closed to "pending", never silently
 *    "paid") for exactly this reason.
 *  - Refunds specifically: no evidence of a refund endpoint was found anywhere in the reachable
 *    documentation. The call below follows this adapter's own conventions for consistency, but
 *    should be treated as the least-trustworthy piece of this file.
 *
 * None of this may be trusted for real money movement until it has been run against a real
 * Safepay sandbox account and reconciled with their actual API reference/Postman collection.
 * Until then, `PAYMENT_PROVIDER=safepay` is real, network-capable code — not a second mock.
 */
export class SafepayProvider implements PaymentProvider {
  readonly name = "safepay";
  // Assumed, not confirmed against real documentation — see this file's top comment. If this is
  // wrong, real Safepay webhooks will arrive at /webhooks/payments/safepay but read back as
  // "missing signature header" (verifyWebhookSignature returns null, a safe failure) rather than
  // being silently misprocessed.
  readonly signatureHeaderName = "x-safepay-signature";

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
      "/order/v1/payments",
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
