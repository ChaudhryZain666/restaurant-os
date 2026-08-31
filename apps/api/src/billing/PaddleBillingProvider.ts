import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  BillingProvider,
  CreateBillingCustomerInput,
  CreateCheckoutSessionInput,
  CreateProviderSubscriptionInput,
  ProviderBillingCustomer,
  ProviderBillingWebhookEvent,
  ProviderCheckoutSession,
  ProviderInvoice,
  ProviderSubscriptionSnapshot,
  ProviderSubscriptionStatus,
} from "./BillingProvider.js";

const SANDBOX_BASE_URL = "https://sandbox-api.paddle.com";
const PRODUCTION_BASE_URL = "https://api.paddle.com";
const REQUEST_TIMEOUT_MS = 10_000;
// Phase 34 — corrected from an assumed 300s to Paddle's actual documented default (re-verified
// against developer.paddle.com/webhooks/signature-verification): "The SDK helper methods enforce a
// five-second timestamp tolerance by default to protect against replay attacks; manual
// implementations should apply the same check." Reject a webhook whose timestamp is older than
// this, even if the HMAC itself checks out, to close a replay window.
const WEBHOOK_MAX_AGE_SECONDS = 5;

/** Carries Paddle's real structured error fields (`error.code`/`error.detail`) so a caller can
 *  branch on the stable machine-readable `code` rather than parsing prose out of a message string.
 *  Phase 40.3 — added specifically so createCustomer can recognize `customer_already_exists`
 *  (HTTP 409) and recover, instead of every non-2xx response collapsing into an opaque Error. */
class PaddleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly detail?: string
  ) {
    super(message);
    this.name = "PaddleApiError";
  }
}

/**
 * Everything below the request-shaping helpers is genuinely wired against Paddle's real
 * sandbox/production hosts and their published Billing API v2 — but, exactly like
 * apps/api/src/payments/SafepayProvider.ts, this adapter has never been exercised against a live
 * Paddle account (no credentials were available when it was written; see
 * docs/commercial-decisions.md's "Provider choice" section). Two categories of fact went into it:
 *
 * VERIFIED (from Paddle's own published developer docs, fetched while building this):
 *  - Base hosts: sandbox-api.paddle.com (sandbox) / api.paddle.com (production) — separate API keys
 *    per environment, never interchangeable.
 *  - Auth model: a server-side API key sent as a Bearer token in the Authorization header.
 *  - Webhook signing: the `Paddle-Signature` header arrives as `ts=<unix_seconds>;h1=<hex_hmac>`,
 *    and the HMAC-SHA256 is computed over the STRING `${ts}:${rawBody}` — NOT the raw body alone
 *    (a documented gotcha; getting this wrong is the most common real-world integration bug).
 *    Paddle's own guidance (re-verified Phase 34 against developer.paddle.com) is a 5-SECOND replay
 *    tolerance by default — tighter than this file originally assumed (300s) — implemented below as
 *    WEBHOOK_MAX_AGE_SECONDS.
 *  - Subscriptions are primarily born from a CHECKOUT completing (Paddle's own client-side
 *    Paddle.js overlay, given a Price id + customer), not a direct "create subscription" API call —
 *    this is WHY createCheckoutSession exists as its own BillingProvider method rather than treating
 *    createSubscription as the only creation path. See subscription.service.ts's checkout flow.
 *
 * ASSUMED / NOT VERIFIED (Paddle's full REST reference sits behind an interactive Postman
 * workspace that couldn't be exhaustively read without an authenticated account):
 *  - The exact REST resource paths below (`/customers`, `/subscriptions`, `/subscriptions/{id}`,
 *    `/subscriptions/{id}/cancel`, `/transactions/{id}`), their exact JSON request/response field
 *    names, and the exact webhook `event_type` strings (`subscription.created`,
 *    `subscription.updated`, `subscription.canceled`, `transaction.completed` are Paddle's
 *    documented naming CONVENTION — `<resource>.<verb>` — but individual field shapes are assumed
 *    from that convention, not independently confirmed against a live payload).
 *  - The exact subscription/transaction status vocabulary Paddle returns. `mapPaddleStatus` is
 *    defensive (unknown values fail closed to "past_due", never silently "active") for exactly this
 *    reason — mirrors SafepayProvider.ts's mapSafepayStatus philosophy exactly.
 *  - Whether a direct, non-checkout `POST /subscriptions` create call is actually available on every
 *    Paddle account tier, versus being reserved for specific migration/admin use cases — this
 *    adapter calls it defensively and lets a real HTTP error surface honestly rather than assuming
 *    success.
 *
 * None of this may be trusted for real money movement until it has been run against a real Paddle
 * sandbox account and reconciled with Paddle's actual, authenticated API reference. Until then,
 * BILLING_PROVIDER=paddle is real, network-capable code — not a second mock.
 */
export class PaddleBillingProvider implements BillingProvider {
  readonly name = "paddle";
  // Verified — see this file's top comment.
  readonly signatureHeaderName = "paddle-signature";

  constructor(
    private readonly apiKey: string,
    private readonly webhookSecret: string,
    private readonly baseUrl: string = SANDBOX_BASE_URL,
    /** Phase 40 — the public, per-environment Paddle.js client-side token (PADDLE_CLIENT_TOKEN),
     *  distinct from apiKey (a private server-side secret). Real Paddle.js's Paddle.Initialize
     *  requires this; it is dashboard-only (no API endpoint creates/lists it — confirmed live this
     *  phase). Absent in an environment that hasn't configured it yet — createCheckoutSession
     *  throws clearly rather than silently handing the frontend an invalid token. */
    private readonly clientToken?: string
  ) {}

  static baseUrlForEnv(paddleEnv: "sandbox" | "production"): string {
    return paddleEnv === "production" ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
  }

  /**
   * Phase 40.3 — real, live-verified transient connectivity issue to Paddle's Cloudflare-fronted
   * sandbox edge (a genuine ConnectTimeoutError, not a code fault — confirmed by immediately
   * succeeding on a bare retry, both during this phase's own reconnaissance and inside the
   * customer-reuse recovery path's own GET call). Phase 40's catalog-creation script already added
   * retry-with-backoff for the exact same class of failure; this brings that same resilience to
   * every real Paddle call this adapter makes, not just that one script. Only TRANSPORT failures
   * (DNS/connect/timeout) are retried — a real HTTP error response (4xx/5xx, parsed into
   * PaddleApiError below) is never retried here, since that's a meaningful business-logic signal,
   * not a connectivity blip.
   */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const attempts = 3;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        return await fetch(url, { ...init, signal: controller.signal });
      } catch (err) {
        if (attempt === attempts) {
          if (err instanceof Error && err.name === "AbortError") throw new Error("Paddle request timed out");
          throw new Error(`Could not reach Paddle: ${(err as Error).message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("Unreachable"); // satisfies TS — the loop above always returns or throws
  }

  private async request<T>(method: "GET" | "POST" | "PATCH", path: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await this.fetchWithRetry(url, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: body ? JSON.stringify(body) : undefined,
    });

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Paddle returned an unreadable response (HTTP ${res.status})`);
    }

    if (!res.ok) {
      const error = (json as { error?: { code?: string; detail?: string } })?.error;
      throw new PaddleApiError(
        `Paddle returned HTTP ${res.status}${error?.detail ? `: ${error.detail}` : ""}`,
        res.status,
        error?.code,
        error?.detail
      );
    }

    return json as T;
  }

  /**
   * Phase 40.3 — real, live-verified finding: calling this unconditionally on every checkout
   * attempt (the original behavior) means a second checkout for the same owner — after an
   * abandoned first attempt, or after a cancelled subscription — hits a real Paddle 409
   * (`customer_already_exists`), since Paddle enforces one customer per email. Confirmed live
   * against the sandbox: `{"error":{"code":"customer_already_exists","detail":"customer email
   * conflicts with customer of id ctm_..."}}`. This makes createCustomer idempotent per email
   * instead: on that specific conflict, fetch the existing customer's own custom_data and reuse its
   * id ONLY if it belongs to the same owner — Paddle's own email-uniqueness check is what makes this
   * safe under concurrency (two racing creates for the same owner/email always resolve to one real
   * customer, the loser recovering here), but a genuine cross-owner email collision must never be
   * silently merged, so that case throws instead of reusing.
   */
  async createCustomer(input: CreateBillingCustomerInput): Promise<ProviderBillingCustomer> {
    try {
      const response = await this.request<{ data?: { id?: string; email?: string; name?: string } }>("POST", "/customers", {
        email: input.email,
        name: input.name,
        custom_data: { ownerType: input.ownerType, ownerId: input.ownerId },
      });
      const providerCustomerId = response.data?.id;
      if (!providerCustomerId) throw new Error("Paddle did not return a customer id");
      return { providerCustomerId, email: response.data?.email, name: response.data?.name };
    } catch (err) {
      if (!(err instanceof PaddleApiError) || err.status !== 409 || err.code !== "customer_already_exists") throw err;

      const existingId = err.detail?.match(/customer of id (ctm_[a-zA-Z0-9]+)/)?.[1];
      if (!existingId) throw err;

      const existing = await this.request<{
        data?: { id?: string; email?: string; name?: string; custom_data?: Record<string, unknown> };
      }>("GET", `/customers/${existingId}`);
      const sameOwner =
        existing.data?.custom_data?.ownerType === input.ownerType && existing.data?.custom_data?.ownerId === input.ownerId;
      if (!sameOwner) {
        throw new Error(
          `Paddle customer email is already associated with a different owner (existing Paddle customer ${existingId}) — refusing to reuse across owners.`
        );
      }
      return { providerCustomerId: existingId, email: existing.data?.email, name: existing.data?.name };
    }
  }

  async retrieveCustomer(providerCustomerId: string): Promise<ProviderBillingCustomer> {
    const response = await this.request<{ data?: { id?: string; email?: string; name?: string } }>("GET", `/customers/${providerCustomerId}`);
    if (!response.data?.id) throw new Error(`Unknown Paddle customer reference: ${providerCustomerId}`);
    return { providerCustomerId, email: response.data.email, name: response.data.name };
  }

  /**
   * ASSUMED endpoint — see this file's top comment: real Paddle subscriptions are primarily
   * checkout-born (createCheckoutSession below), so this direct-create call is the LESS-trodden
   * path, used only for this platform's existing "start a trial with no payment method up front"
   * flow (subscription.service.ts's createSubscriptionCore).
   */
  async createSubscription(input: CreateProviderSubscriptionInput): Promise<ProviderSubscriptionSnapshot> {
    const response = await this.request<PaddleSubscriptionResponse>("POST", "/subscriptions", {
      customer_id: input.providerCustomerId,
      items: [{ price_id: input.planCode, quantity: 1 }],
      billing_cycle: { interval: input.billingInterval === "yearly" ? "year" : "month", frequency: 1 },
      ...(input.trialDays ? { trial_dates: { start: new Date().toISOString() } } : {}),
    });
    return this.toSnapshot(response);
  }

  async retrieveSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionSnapshot> {
    const response = await this.request<PaddleSubscriptionResponse>("GET", `/subscriptions/${providerSubscriptionId}`);
    return this.toSnapshot(response);
  }

  async cancelSubscription(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<ProviderSubscriptionSnapshot> {
    const response = await this.request<PaddleSubscriptionResponse>("POST", `/subscriptions/${providerSubscriptionId}/cancel`, {
      effective_from: atPeriodEnd ? "next_billing_period" : "immediately",
    });
    return this.toSnapshot(response);
  }

  async reactivateSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionSnapshot> {
    // ASSUMED — Paddle's documented pattern for "undo a scheduled cancellation" is a PATCH clearing
    // scheduled_change, not a dedicated /reactivate endpoint. Modeled here as its own request so
    // this call site never needs a mock-specific special case.
    const response = await this.request<PaddleSubscriptionResponse>("PATCH", `/subscriptions/${providerSubscriptionId}`, {
      scheduled_change: null,
    });
    return this.toSnapshot(response);
  }

  async changePlan(providerSubscriptionId: string, newPlanCode: string): Promise<ProviderSubscriptionSnapshot> {
    const response = await this.request<PaddleSubscriptionResponse>("POST", `/subscriptions/${providerSubscriptionId}`, {
      items: [{ price_id: newPlanCode, quantity: 1 }],
      proration_billing_mode: "prorated_next_billing_period",
    });
    return this.toSnapshot(response);
  }

  /**
   * VERIFIED shape (client-side, re-checked live against developer.paddle.com/paddlejs this phase):
   * Paddle's overlay checkout (Paddle.js `Paddle.Checkout.open`) is driven from the FRONTEND given a
   * price id, a customer id, and custom data — there is no server-side "create checkout session"
   * REST call to make first. `Paddle.Initialize({token})` requires a real, PUBLIC, per-environment
   * client-side token (Paddle > Developer tools > Authentication — dashboard-only, no API
   * equivalent), never a per-customer value.
   *
   * Phase 40 fix: this previously returned `clientToken: input.providerCustomerId` — a real bug
   * (would have handed Paddle.Initialize an invalid token, silently breaking every real checkout
   * attempt) found by comparing against Paddle's actual current docs, not merely re-reading this
   * file's own prior assumptions. providerCustomerId is now correctly threaded through as its own
   * field instead, for the frontend's separate `Paddle.Checkout.open({customer: {id: ...}})` call.
   */
  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<ProviderCheckoutSession> {
    if (!this.clientToken) {
      throw new Error("PADDLE_CLIENT_TOKEN is not configured — cannot open a real Paddle.js checkout without it.");
    }
    return {
      mode: "overlay",
      clientToken: this.clientToken,
      providerPriceId: input.providerPriceId,
      providerCustomerId: input.providerCustomerId,
    };
  }

  async retrieveInvoice(providerInvoiceId: string): Promise<ProviderInvoice | null> {
    // ASSUMED path — Paddle's compliant receipts are issued against a "transaction," not a
    // separate "invoice" resource in the Billing API; providerInvoiceId here is that transaction id.
    let response: { data?: PaddleTransactionResponse };
    try {
      response = await this.request<{ data?: PaddleTransactionResponse }>("GET", `/transactions/${providerInvoiceId}`);
    } catch {
      return null;
    }
    const data = response.data;
    if (!data) return null;
    return {
      providerInvoiceId,
      status: mapPaddleTransactionStatus(data.status),
      amountCents: Number(data.details?.totals?.total ?? 0),
      currency: data.currency_code ?? "USD",
      hostedUrl: data.invoice_url ?? data.receipt_url,
      issuedAt: data.billed_at ? new Date(data.billed_at) : new Date(),
    };
  }

  /**
   * VERIFIED format: `Paddle-Signature: ts=<unix_seconds>;h1=<hex_hmac>`, HMAC-SHA256 over the
   * STRING `${ts}:${rawBody}` (not the raw body alone) using the webhook secret from the Paddle
   * dashboard. Rejects anything older than WEBHOOK_MAX_AGE_SECONDS even with a valid signature.
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): ProviderBillingWebhookEvent | null {
    if (!signatureHeader) return null;

    const parts = Object.fromEntries(signatureHeader.split(";").map((part) => part.split("=") as [string, string]));
    const ts = parts.ts;
    const h1 = parts.h1;
    if (!ts || !h1) return null;

    const ageSeconds = Math.abs(Date.now() / 1000 - Number(ts));
    if (!Number.isFinite(ageSeconds) || ageSeconds > WEBHOOK_MAX_AGE_SECONDS) return null;

    const signedPayload = `${ts}:${rawBody.toString("utf-8")}`;
    const expected = createHmac("sha256", this.webhookSecret).update(signedPayload).digest("hex");

    let expectedBuf: Buffer;
    let providedBuf: Buffer;
    try {
      expectedBuf = Buffer.from(expected, "hex");
      providedBuf = Buffer.from(h1, "hex");
    } catch {
      return null;
    }
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) return null;

    let parsed: PaddleWebhookPayload;
    try {
      parsed = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      return null;
    }

    const eventId = parsed.event_id;
    const eventType = parsed.event_type;
    const subscriptionId = parsed.data?.subscription_id ?? parsed.data?.id;
    if (!eventId || !eventType || !subscriptionId) return null;

    const customData = parsed.data?.custom_data as Record<string, string> | undefined;
    const isCheckoutCreation = eventType === "subscription.created" && Boolean(customData?.ownerType);

    return {
      eventId,
      eventType,
      providerSubscriptionId: subscriptionId,
      status: mapPaddleStatus(parsed.data?.status),
      raw: parsed,
      checkoutMetadata: isCheckoutCreation
        ? {
            ownerType: customData!.ownerType as "business" | "agency",
            ownerId: customData!.ownerId,
            planCode: customData!.planCode,
            billingInterval: customData!.billingInterval as "monthly" | "yearly",
            providerCustomerId: (parsed.data?.customer_id as string) ?? "",
          }
        : undefined,
    };
  }

  private toSnapshot(response: PaddleSubscriptionResponse): ProviderSubscriptionSnapshot {
    const data = response.data;
    if (!data?.id) throw new Error("Paddle did not return a subscription id");
    return {
      providerSubscriptionId: data.id,
      status: mapPaddleStatus(data.status),
      currentPeriodStart: data.current_billing_period?.starts_at ? new Date(data.current_billing_period.starts_at) : new Date(),
      currentPeriodEnd: data.current_billing_period?.ends_at ? new Date(data.current_billing_period.ends_at) : new Date(),
      trialEnd: data.status === "trialing" && data.current_billing_period?.ends_at ? new Date(data.current_billing_period.ends_at) : undefined,
    };
  }
}

interface PaddleSubscriptionResponse {
  data?: {
    id?: string;
    status?: string;
    current_billing_period?: { starts_at?: string; ends_at?: string };
  };
}

interface PaddleTransactionResponse {
  status?: string;
  currency_code?: string;
  billed_at?: string;
  invoice_url?: string;
  receipt_url?: string;
  details?: { totals?: { total?: string | number } };
}

interface PaddleWebhookPayload {
  event_id?: string;
  event_type?: string;
  data?: {
    id?: string;
    subscription_id?: string;
    status?: string;
    customer_id?: string;
    custom_data?: Record<string, unknown>;
  };
}

/**
 * Fails closed by design: any status text this adapter doesn't specifically recognize maps to
 * "past_due" rather than "active" — an unrecognized Paddle status should never be silently treated
 * as a healthy, paid subscription. See this file's top comment: the exact status vocabulary is
 * unverified against a live account. Mirrors SafepayProvider.ts's mapSafepayStatus philosophy.
 */
function mapPaddleStatus(raw: string | undefined): ProviderSubscriptionStatus {
  switch (raw) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "paused":
      return "cancelled";
    default:
      return "past_due";
  }
}

function mapPaddleTransactionStatus(raw: string | undefined): "paid" | "pending" | "failed" {
  switch (raw) {
    case "completed":
    case "paid":
      return "paid";
    case "past_due":
    case "canceled":
      return "failed";
    default:
      return "pending";
  }
}
