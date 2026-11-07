import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  BillingProvider,
  CreateBillingCustomerInput,
  CreateCheckoutSessionInput,
  CreateProviderSubscriptionInput,
  ProviderBillingCustomer,
  ProviderBillingNotice,
  ProviderBillingWebhookEvent,
  ProviderCheckoutSession,
  ProviderInvoice,
  ProviderSubscriptionSnapshot,
  ProviderSubscriptionStatus,
} from "./BillingProvider.js";

const API_BASE_URL = "https://api.lemonsqueezy.com/v1";
const REQUEST_TIMEOUT_MS = 10_000;
/** Prefix of the event ids this adapter derives (Lemon Squeezy sends none — see verifyWebhookSignature). */
export const LEMONSQUEEZY_EVENT_ID_PREFIX = "lsq_";

/** Carries Lemon Squeezy's JSON:API error detail so callers can branch on the HTTP status. */
export class LemonSqueezyApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "LemonSqueezyApiError";
  }
}

/**
 * Lemon Squeezy (Merchant of Record) platform-billing adapter. Facts below were read from Lemon
 * Squeezy's own API docs (docs.lemonsqueezy.com/api, /help/webhooks) and checked against a test-mode
 * store: checkout, purchase, plan change, cancel, resume and a genuine signed webhook delivery.
 *
 *  - One host for both modes: https://api.lemonsqueezy.com/v1, JSON:API (`application/vnd.api+json`),
 *    Bearer API key. Test vs live is decided by WHICH key is used (keys are created per mode), and
 *    every object carries `test_mode`.
 *  - Checkouts are hosted pages: POST /checkouts with the store + variant relationships returns
 *    `data.attributes.url` — so createCheckoutSession is a "redirect" session. Our owner metadata
 *    rides in `checkout_data.custom` and comes back on webhooks as `meta.custom_data`. Anyone can add
 *    custom data to a public buy link (`?checkout[custom][…]=…`), so ours is signed with a
 *    server-only secret and bound to the variant bought (see verifyCheckoutData).
 *  - There is no "create subscription" API and no need to create a customer first: the customer and
 *    the subscription are both born from a completed checkout.
 *  - Subscription statuses: on_trial, active, paused, past_due, unpaid, cancelled, expired. NOTE
 *    "cancelled" means a cancellation is SCHEDULED (grace period until `ends_at`) — our
 *    "cancelling" — while "expired" means it has ended.
 *  - DELETE /subscriptions/{id} cancels with access until `ends_at` (the period end); no immediate
 *    cancel is documented. PATCH with `cancelled: false` resumes before `ends_at`; PATCH with
 *    `variant_id` changes plan (prorated on the next invoice by default).
 *  - Webhooks: `X-Signature` = hex HMAC-SHA256 of the raw body with the webhook's signing secret;
 *    `meta.event_name` names the event. There is NO per-event id and no timestamp header, so the
 *    event id is derived from a hash of the body. A dashboard resend is NOT byte-identical — it
 *    carries a new `meta.webhook_id` (observed 2026-11-07) — so that field and the pre-signed `urls`
 *    are left out of the hash. There is no replay window beyond that de-duplication.
 *  - `data.attributes.urls` holds pre-signed customer-portal / update-payment-method links (bearer
 *    access to the customer's billing); they are removed from the payload before it is stored.
 *  - subscription_payment_* events carry a subscription-invoice (`billing_reason` initial / renewal /
 *    updated; integer cents).
 */
export class LemonSqueezyBillingProvider implements BillingProvider {
  readonly name = "lemonsqueezy";
  readonly signatureHeaderName = "x-signature";

  constructor(
    private readonly apiKey: string,
    private readonly webhookSecret: string,
    private readonly storeId: string,
    /** Which Lemon Squeezy mode this deployment bills in. A webhook whose object is from the other
     *  mode (a test purchase reaching a live deployment, or the reverse) is recorded, never applied. */
    private readonly testMode: boolean,
    /** Server-only key for the checkout custom data (LEMONSQUEEZY_CHECKOUT_SECRET) — never sent to
     *  Lemon Squeezy, unlike the webhook signing secret. */
    private readonly checkoutSecret: string,
    private readonly baseUrl: string = API_BASE_URL
  ) {}

  private async request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: Record<string, unknown>): Promise<T> {
    const attempts = 3;
    let res: Response | undefined;
    for (let attempt = 1; attempt <= attempts && !res; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Accept: "application/vnd.api+json",
            "Content-Type": "application/vnd.api+json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        // Only transport failures are retried — an HTTP error response is a real answer.
        if (attempt === attempts) {
          if (err instanceof Error && err.name === "AbortError") throw new Error("Lemon Squeezy request timed out");
          throw new Error(`Could not reach Lemon Squeezy: ${(err as Error).message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      } finally {
        clearTimeout(timer);
      }
    }

    let json: unknown;
    try {
      json = await res!.json();
    } catch {
      throw new Error(`Lemon Squeezy returned an unreadable response (HTTP ${res!.status})`);
    }
    if (!res!.ok) {
      const detail = (json as { errors?: Array<{ detail?: string }> })?.errors?.[0]?.detail;
      throw new LemonSqueezyApiError(`Lemon Squeezy returned HTTP ${res!.status}${detail ? `: ${detail}` : ""}`, res!.status);
    }
    return json as T;
  }

  /**
   * Lemon Squeezy creates the customer during checkout, so nothing is created here. The real
   * customer id arrives with subscription_created (checkoutMetadata.providerCustomerId); this
   * placeholder is only what createCheckoutSessionCore passes along to createCheckoutSession, which
   * ignores it.
   */
  async createCustomer(input: CreateBillingCustomerInput): Promise<ProviderBillingCustomer> {
    return { providerCustomerId: `pending_checkout:${input.ownerType}:${input.ownerId}`, email: input.email, name: input.name };
  }

  async retrieveCustomer(providerCustomerId: string): Promise<ProviderBillingCustomer> {
    const response = await this.request<{ data?: { id?: string; attributes?: { email?: string; name?: string } } }>(
      "GET",
      `/customers/${encodeURIComponent(providerCustomerId)}`
    );
    if (!response.data?.id) throw new Error(`Unknown Lemon Squeezy customer reference: ${providerCustomerId}`);
    return { providerCustomerId, email: response.data.attributes?.email, name: response.data.attributes?.name };
  }

  async createSubscription(_input: CreateProviderSubscriptionInput): Promise<ProviderSubscriptionSnapshot> {
    throw new Error("Lemon Squeezy has no create-subscription API — subscriptions start from a completed checkout.");
  }

  async retrieveSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionSnapshot> {
    return this.toSnapshot(await this.request<LemonSqueezySubscriptionResponse>("GET", `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`));
  }

  /** DELETE always keeps access until the period end (`ends_at`): Lemon Squeezy documents no
   *  immediate cancel, so an `atPeriodEnd: false` request is honoured as a period-end cancel too and
   *  subscription_expired ends it when the period does. */
  async cancelSubscription(providerSubscriptionId: string, _atPeriodEnd: boolean): Promise<ProviderSubscriptionSnapshot> {
    return this.toSnapshot(await this.request<LemonSqueezySubscriptionResponse>("DELETE", `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`));
  }

  async reactivateSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionSnapshot> {
    return this.toSnapshot(
      await this.request<LemonSqueezySubscriptionResponse>("PATCH", `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, {
        data: { type: "subscriptions", id: providerSubscriptionId, attributes: { cancelled: false } },
      })
    );
  }

  /** newProviderPriceId is the Lemon Squeezy VARIANT id. Default proration: the difference is
   *  charged (or credited) on the next invoice. */
  async changePlan(providerSubscriptionId: string, newProviderPriceId: string): Promise<ProviderSubscriptionSnapshot> {
    const variantId = Number(newProviderPriceId);
    if (!Number.isInteger(variantId) || variantId <= 0) throw new Error(`"${newProviderPriceId}" is not a Lemon Squeezy variant id.`);
    return this.toSnapshot(
      await this.request<LemonSqueezySubscriptionResponse>("PATCH", `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, {
        data: { type: "subscriptions", id: providerSubscriptionId, attributes: { variant_id: variantId } },
      })
    );
  }

  /**
   * A hosted checkout page for one variant. `checkout_data.custom` carries the owner, plan,
   * interval and variant, signed (signCheckoutData); Lemon Squeezy returns it as `meta.custom_data`
   * on subscription_created, which is how the new subscription is tied to the account that started
   * the checkout. The email/name are deliberately not pre-filled: the person paying may use a
   * different billing email.
   */
  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<ProviderCheckoutSession> {
    const fields = checkoutFieldsOf({ ...input.metadata, variantId: input.providerPriceId });
    if (!fields) throw new Error("Lemon Squeezy checkout needs ownerType, ownerId, planCode, billingInterval and a numeric variant id.");
    const response = await this.request<{ data?: { attributes?: { url?: string } } }>("POST", "/checkouts", {
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: { custom: { ...input.metadata, variantId: fields.variantId, checkoutSignature: this.signCheckoutData(fields) } },
          product_options: { redirect_url: input.successUrl, enabled_variants: [Number(input.providerPriceId)] },
          test_mode: this.testMode,
        },
        relationships: {
          store: { data: { type: "stores", id: this.storeId } },
          variant: { data: { type: "variants", id: input.providerPriceId } },
        },
      },
    });
    const url = response.data?.attributes?.url;
    if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("Lemon Squeezy did not return a checkout URL");
    return { mode: "redirect", url };
  }

  /** Read-only, for scripts/setLemonSqueezyVariantIds.ts. Null on 404 (an id from the other mode,
   *  or a typo). */
  async retrieveVariant(variantId: string): Promise<LemonSqueezyVariant | null> {
    try {
      const response = await this.request<{ data?: { id?: string; attributes?: LemonSqueezyVariant } }>("GET", `/variants/${encodeURIComponent(variantId)}`);
      return response.data?.attributes ? { ...response.data.attributes, id: response.data.id } : null;
    } catch (err) {
      if (err instanceof LemonSqueezyApiError && err.status === 404) return null;
      throw err;
    }
  }

  /** providerInvoiceId is a subscription-invoice id. */
  async retrieveInvoice(providerInvoiceId: string): Promise<ProviderInvoice | null> {
    let response: { data?: { attributes?: LemonSqueezyInvoiceAttributes } };
    try {
      response = await this.request("GET", `/subscription-invoices/${encodeURIComponent(providerInvoiceId)}`);
    } catch {
      return null;
    }
    const data = response.data?.attributes;
    if (!data) return null;
    return {
      providerInvoiceId,
      status: data.status === "paid" ? "paid" : data.status === "void" ? "failed" : "pending",
      amountCents: Number(data.total ?? 0),
      currency: data.currency ?? "USD",
      hostedUrl: data.urls?.invoice_url ?? undefined,
      issuedAt: data.created_at ? new Date(data.created_at) : new Date(),
    };
  }

  /** A pre-signed page (valid 24h) where the customer replaces their card — fetched per click. */
  async getPaymentMethodUpdateUrl(providerSubscriptionId: string): Promise<string | null> {
    const response = await this.request<LemonSqueezySubscriptionResponse>("GET", `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`);
    const url = response.data?.attributes?.urls?.update_payment_method;
    return typeof url === "string" && url.startsWith("https://") ? url : null;
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): ProviderBillingWebhookEvent | null {
    if (!signatureHeader || !/^[0-9a-f]{64}$/i.test(signatureHeader)) return null;
    const expected = createHmac("sha256", this.webhookSecret).update(rawBody).digest();
    const provided = Buffer.from(signatureHeader, "hex");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

    let parsed: LemonSqueezyWebhookPayload;
    try {
      parsed = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      return null;
    }
    const eventType = parsed.meta?.event_name;
    if (!eventType) return null;

    const data = parsed.data;
    const attributes = data?.attributes ?? {};
    const updatedAt = toDate(attributes.updated_at);
    const stored = withoutSignedUrls(parsed);
    const base = {
      eventId: `${LEMONSQUEEZY_EVENT_ID_PREFIX}${eventType}_${canonicalEventHash(stored)}`,
      eventType,
      raw: stored,
      occurredAt: updatedAt,
      // An object from the other mode is acknowledged and recorded, never applied.
      simulated: typeof attributes.test_mode === "boolean" && attributes.test_mode !== this.testMode,
    };

    if (data?.type !== "subscriptions") {
      const subscriptionId = attributes.subscription_id;
      return {
        ...base,
        // Payment events are not subscription state; they must not advance the event ordering.
        occurredAt: undefined,
        providerSubscriptionId: data?.type === "subscription-invoices" && subscriptionId != null ? String(subscriptionId) : "",
        billingNotice: data?.type === "subscription-invoices" ? billingNoticeFor(eventType, data.id, attributes) : undefined,
      };
    }

    if (!data.id) return null;
    // Every new subscription must come from a checkout this server signed: one bought through a
    // public link (or with edited custom data) is recorded and alerted on, never attached to anyone.
    let checkoutMetadata: ProviderBillingWebhookEvent["checkoutMetadata"];
    if (eventType === "subscription_created") {
      const verdict = this.verifyCheckoutData(parsed.meta?.custom_data, attributes.variant_id);
      if ("rejectedReason" in verdict) return { ...base, providerSubscriptionId: data.id, rejectedReason: verdict.rejectedReason };
      checkoutMetadata = {
        ownerType: verdict.ownerType,
        ownerId: verdict.ownerId,
        planCode: verdict.planCode,
        billingInterval: verdict.billingInterval,
        providerCustomerId: attributes.customer_id != null ? String(attributes.customer_id) : "",
      };
    }
    const periodEnd = toDate(attributes.status === "cancelled" || attributes.status === "expired" ? attributes.ends_at : attributes.renews_at);

    return {
      ...base,
      providerSubscriptionId: data.id,
      status: mapLemonSqueezyStatus(attributes.status),
      // Lemon Squeezy reports only when the period ends; the service carries the start forward.
      currentPeriod: periodEnd && attributes.status !== "expired" ? { end: periodEnd } : undefined,
      scheduledCancelAt: attributes.status === "cancelled" ? (toDate(attributes.ends_at) ?? null) : null,
      providerPriceId: attributes.variant_id != null ? String(attributes.variant_id) : undefined,
      checkoutMetadata,
    };
  }

  /** HMAC over every field that decides who gets which subscription — including the variant, so a
   *  signature from one checkout can't be replayed onto a cheaper product's buy link. */
  private signCheckoutData(fields: CheckoutFields): string {
    const payload = JSON.stringify([CHECKOUT_SIGNATURE_VERSION, fields.ownerType, fields.ownerId, fields.planCode, fields.billingInterval, fields.variantId]);
    return createHmac("sha256", this.checkoutSecret).update(payload).digest("hex");
  }

  /** Trusts `meta.custom_data` only when it is complete, carries our signature over exactly these
   *  values, and names the variant that was actually bought. */
  private verifyCheckoutData(customData: Record<string, unknown> | undefined, purchasedVariantId: number | string | undefined): (CheckoutFields & { rejectedReason?: never }) | { rejectedReason: string } {
    const fields = checkoutFieldsOf(customData);
    const signature = customData?.checkoutSignature;
    if (!fields || typeof signature !== "string" || !/^[0-9a-f]{64}$/i.test(signature)) {
      return { rejectedReason: "subscription_created without complete signed GarnishTable checkout data (bought outside the app?)" };
    }
    const expected = Buffer.from(this.signCheckoutData(fields), "hex");
    if (!timingSafeEqual(Buffer.from(signature, "hex"), expected)) {
      return { rejectedReason: "checkout data signature does not match (custom data altered or signed with another key)" };
    }
    if (purchasedVariantId == null || String(purchasedVariantId) !== fields.variantId) {
      return { rejectedReason: `purchased variant ${String(purchasedVariantId)} is not the checkout's signed variant ${fields.variantId}` };
    }
    return fields;
  }

  /** Lemon Squeezy reports only the period END (renews_at); the start is the end stepped back one
   *  billing interval, read from the subscription's variant — never earlier than the subscription. */
  private async toSnapshot(response: LemonSqueezySubscriptionResponse): Promise<ProviderSubscriptionSnapshot> {
    const data = response.data;
    if (!data?.id) throw new Error("Lemon Squeezy did not return a subscription id");
    const a = data.attributes ?? {};
    const createdAt = toDate(a.created_at) ?? new Date();
    const end = toDate(a.status === "cancelled" || a.status === "expired" ? a.ends_at : a.renews_at) ?? createdAt;

    let start = createdAt;
    if (a.variant_id != null) {
      const variant = await this.retrieveVariant(String(a.variant_id));
      const stepped = variant?.interval ? stepBack(end, variant.interval, variant.interval_count ?? 1) : undefined;
      if (stepped && stepped > createdAt) start = stepped;
    }

    return {
      providerSubscriptionId: String(data.id),
      status: mapLemonSqueezyStatus(a.status),
      currentPeriodStart: start,
      currentPeriodEnd: end,
      trialEnd: a.status === "on_trial" ? toDate(a.trial_ends_at) : undefined,
    };
  }
}

export interface LemonSqueezyVariant {
  id?: string;
  product_id?: number;
  name?: string;
  status?: string;
  price?: number;
  is_subscription?: boolean;
  interval?: "day" | "week" | "month" | "year" | null;
  interval_count?: number | null;
  has_free_trial?: boolean;
  test_mode?: boolean;
}

interface LemonSqueezySubscriptionAttributes {
  status?: string;
  customer_id?: number | string;
  variant_id?: number | string;
  renews_at?: string | null;
  ends_at?: string | null;
  trial_ends_at?: string | null;
  created_at?: string;
  updated_at?: string;
  test_mode?: boolean;
  urls?: { update_payment_method?: string | null; customer_portal?: string | null };
}

interface LemonSqueezyInvoiceAttributes {
  subscription_id?: number | string;
  billing_reason?: string;
  status?: string;
  total?: number;
  refunded_amount?: number;
  currency?: string;
  created_at?: string;
  updated_at?: string;
  test_mode?: boolean;
  urls?: { invoice_url?: string | null };
}

interface LemonSqueezySubscriptionResponse {
  data?: { id?: string; attributes?: LemonSqueezySubscriptionAttributes };
}

interface LemonSqueezyWebhookPayload {
  meta?: { event_name?: string; custom_data?: Record<string, unknown>; webhook_id?: string; test_mode?: boolean };
  data?: { type?: string; id?: string; attributes?: LemonSqueezySubscriptionAttributes & LemonSqueezyInvoiceAttributes };
}

const CHECKOUT_SIGNATURE_VERSION = "lsq-checkout-v1";

interface CheckoutFields {
  ownerType: "business" | "agency";
  ownerId: string;
  planCode: string;
  billingInterval: "monthly" | "yearly";
  variantId: string;
}

/** The signed checkout fields, validated; null when any is missing or malformed. Lemon Squeezy may
 *  hand custom data back with values stringified, so everything is compared as strings. */
function checkoutFieldsOf(source: Record<string, unknown> | undefined): CheckoutFields | null {
  if (!source) return null;
  const { ownerType, ownerId, planCode, billingInterval } = source;
  const variantId = source.variantId != null ? String(source.variantId) : "";
  if (ownerType !== "business" && ownerType !== "agency") return null;
  if (typeof ownerId !== "string" || !/^[0-9a-f]{24}$/i.test(ownerId)) return null;
  if (typeof planCode !== "string" || !planCode) return null;
  if (billingInterval !== "monthly" && billingInterval !== "yearly") return null;
  if (!/^[1-9]\d*$/.test(variantId)) return null;
  return { ownerType, ownerId, planCode, billingInterval, variantId };
}

/** The payload as stored: without `data.attributes.urls` (pre-signed billing links). */
function withoutSignedUrls(parsed: LemonSqueezyWebhookPayload): LemonSqueezyWebhookPayload {
  if (!parsed.data?.attributes || !("urls" in parsed.data.attributes)) return parsed;
  const attributes = { ...parsed.data.attributes };
  delete attributes.urls;
  return { ...parsed, data: { ...parsed.data, attributes } };
}

/** Hash of the event's content, minus the per-delivery `meta.webhook_id` (new on every resend). */
function canonicalEventHash(stored: LemonSqueezyWebhookPayload): string {
  const meta = { ...stored.meta };
  delete meta.webhook_id;
  return createHash("sha256").update(JSON.stringify({ ...stored, meta })).digest("hex");
}

function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function stepBack(end: Date, interval: "day" | "week" | "month" | "year", count: number): Date {
  const d = new Date(end);
  if (interval === "day") d.setUTCDate(d.getUTCDate() - count);
  else if (interval === "week") d.setUTCDate(d.getUTCDate() - 7 * count);
  else if (interval === "month") d.setUTCMonth(d.getUTCMonth() - count);
  else d.setUTCFullYear(d.getUTCFullYear() - count);
  return d;
}

/**
 * Billing-history notices, deliberately narrow (mirrors PaddleBillingProvider's billingNoticeFor):
 *  - a successful RENEWAL only — the first payment is recorded by the checkout-completion path;
 *  - a refund. Failed payments need no notice: subscription_updated reports past_due as a status.
 */
function billingNoticeFor(eventType: string, invoiceId: string | undefined, a: LemonSqueezyInvoiceAttributes): ProviderBillingNotice | undefined {
  if (eventType === "subscription_payment_success" && a.billing_reason === "renewal") {
    return { type: "payment_succeeded", amountCents: a.total, currency: a.currency, reference: invoiceId };
  }
  if (eventType === "subscription_payment_refunded") {
    return { type: "refunded", amountCents: a.refunded_amount ?? a.total, currency: a.currency, reference: invoiceId };
  }
  return undefined;
}

/**
 * Fails closed: an unrecognised status maps to past_due, never active. "cancelled" is a SCHEDULED
 * cancellation still inside its paid period, so it is "active" here and becomes our "cancelling"
 * through scheduledCancelAt (resolveTransitionTarget); "expired" is the actual end.
 */
function mapLemonSqueezyStatus(raw: string | undefined): ProviderSubscriptionStatus {
  switch (raw) {
    case "on_trial":
      return "trialing";
    case "active":
    case "cancelled":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "expired":
    case "paused":
      return "cancelled";
    default:
      return "past_due";
  }
}
