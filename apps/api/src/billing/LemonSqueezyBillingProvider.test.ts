import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createHmac } from "node:crypto";
import { LemonSqueezyBillingProvider } from "./LemonSqueezyBillingProvider.js";

afterEach(() => {
  jest.restoreAllMocks();
});

const SECRET = "test-signing-secret";
const CHECKOUT_SECRET = "test-checkout-secret-0123456789abcdef";

function provider(testMode = true, checkoutSecret = CHECKOUT_SECRET) {
  return new LemonSqueezyBillingProvider("api-key", SECRET, "123", testMode, checkoutSecret, "https://ls.example");
}

function mockFetch(...responses: Array<{ status: number; body: unknown }>) {
  const spy = jest.spyOn(globalThis, "fetch");
  for (const r of responses) {
    spy.mockResolvedValueOnce({ status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body } as unknown as Response);
  }
  return spy;
}

function sign(body: Buffer, secret = SECRET) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function subscriptionEvent(eventName: string, attributes: Record<string, unknown>, customData?: Record<string, unknown>, meta: Record<string, unknown> = {}) {
  return Buffer.from(
    JSON.stringify({
      meta: { event_name: eventName, ...meta, ...(customData ? { custom_data: customData } : {}) },
      data: {
        type: "subscriptions",
        id: "555",
        attributes: {
          customer_id: 777,
          variant_id: 2346454,
          renews_at: "2026-12-07T10:00:00.000000Z",
          ends_at: null,
          created_at: "2026-11-07T10:00:00.000000Z",
          updated_at: "2026-11-07T10:00:05.000000Z",
          test_mode: true,
          ...attributes,
        },
      },
    })
  );
}

const CHECKOUT_INPUT = {
  providerCustomerId: "pending_checkout:business:biz-1",
  providerPriceId: "2346454",
  metadata: { ownerType: "business", ownerId: "6aee6ff96e33177eefa98a9c", planCode: "owner_starter", billingInterval: "monthly" },
  successUrl: "https://admin.example.com/billing-checkout-complete",
  cancelUrl: "https://admin.example.com/billing",
};

/** The custom data our own createCheckoutSession sends, exactly as Lemon Squeezy echoes it back. */
async function signedCustomData(input = CHECKOUT_INPUT, checkoutSecret = CHECKOUT_SECRET): Promise<Record<string, unknown>> {
  const spy = mockFetch({ status: 201, body: { data: { attributes: { url: "https://garnishtable.lemonsqueezy.com/checkout/custom/abc" } } } });
  await provider(true, checkoutSecret).createCheckoutSession(input);
  const custom = JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string).data.attributes.checkout_data.custom;
  spy.mockRestore();
  return custom;
}

describe("LemonSqueezyBillingProvider.createCheckoutSession", () => {
  it("creates a hosted checkout for the variant with the owner in checkout_data.custom and returns its URL", async () => {
    const fetchSpy = mockFetch({ status: 201, body: { data: { attributes: { url: "https://garnishtable.lemonsqueezy.com/checkout/custom/abc" } } } });

    const session = await provider().createCheckoutSession(CHECKOUT_INPUT);

    expect(session).toEqual({ mode: "redirect", url: "https://garnishtable.lemonsqueezy.com/checkout/custom/abc" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ls.example/checkouts");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer api-key");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/vnd.api+json");
    const body = JSON.parse(init.body as string);
    expect(body.data.type).toBe("checkouts");
    expect(body.data.attributes.checkout_data.custom).toEqual({
      ...CHECKOUT_INPUT.metadata,
      variantId: "2346454",
      checkoutSignature: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(body.data.attributes.product_options.redirect_url).toBe(CHECKOUT_INPUT.successUrl);
    expect(body.data.attributes.test_mode).toBe(true);
    expect(body.data.relationships.store.data).toEqual({ type: "stores", id: "123" });
    expect(body.data.relationships.variant.data).toEqual({ type: "variants", id: "2346454" });
  });

  it("refuses to create a checkout it can't sign completely, before any request", async () => {
    const spy = jest.spyOn(globalThis, "fetch");
    await expect(provider().createCheckoutSession({ ...CHECKOUT_INPUT, metadata: { ...CHECKOUT_INPUT.metadata, ownerId: "" } })).rejects.toThrow(
      "Lemon Squeezy checkout needs"
    );
    await expect(provider().createCheckoutSession({ ...CHECKOUT_INPUT, providerPriceId: "pri_abc" })).rejects.toThrow("Lemon Squeezy checkout needs");
    expect(spy).not.toHaveBeenCalled();
  });

  it("throws when Lemon Squeezy returns no https URL", async () => {
    mockFetch({ status: 201, body: { data: { attributes: {} } } });
    await expect(provider().createCheckoutSession(CHECKOUT_INPUT)).rejects.toThrow("did not return a checkout URL");
  });

  it("surfaces Lemon Squeezy's error detail on a non-2xx response", async () => {
    mockFetch({ status: 422, body: { errors: [{ detail: "The variant must be published." }] } });
    await expect(provider().createCheckoutSession(CHECKOUT_INPUT)).rejects.toThrow("HTTP 422: The variant must be published.");
  });
});

describe("LemonSqueezyBillingProvider.verifyWebhookSignature", () => {
  it("rejects a missing, malformed or wrong signature", () => {
    const body = subscriptionEvent("subscription_updated", { status: "active" });
    expect(provider().verifyWebhookSignature(body, undefined)).toBeNull();
    expect(provider().verifyWebhookSignature(body, "not-hex")).toBeNull();
    expect(provider().verifyWebhookSignature(body, sign(body, "other-secret"))).toBeNull();
    // A body changed after signing.
    expect(provider().verifyWebhookSignature(Buffer.from(body.toString().replace("555", "556")), sign(body))).toBeNull();
  });

  it("maps a checkout's subscription_created to checkout metadata carrying the owner and the real customer id", async () => {
    const body = subscriptionEvent("subscription_created", { status: "active" }, await signedCustomData());
    const event = provider().verifyWebhookSignature(body, sign(body));
    expect(event).toMatchObject({
      eventType: "subscription_created",
      providerSubscriptionId: "555",
      status: "active",
      providerPriceId: "2346454",
      scheduledCancelAt: null,
      currentPeriod: { end: new Date("2026-12-07T10:00:00Z") },
      occurredAt: new Date("2026-11-07T10:00:05Z"),
      simulated: false,
      checkoutMetadata: {
        ownerType: "business",
        ownerId: "6aee6ff96e33177eefa98a9c",
        planCode: "owner_starter",
        billingInterval: "monthly",
        providerCustomerId: "777",
      },
    });
    expect(event!.rejectedReason).toBeUndefined();
    expect(event!.currentPeriod!.start).toBeUndefined();
  });

  it("accepts checkout data echoed back with stringified values", async () => {
    const custom = Object.fromEntries(Object.entries(await signedCustomData()).map(([k, v]) => [k, String(v)]));
    const body = subscriptionEvent("subscription_created", { status: "active", variant_id: "2346454" }, custom);
    expect(provider().verifyWebhookSignature(body, sign(body))!.checkoutMetadata?.ownerId).toBe("6aee6ff96e33177eefa98a9c");
  });

  it("rejects a subscription_created whose checkout data was altered, is missing, or names another variant — and maps no owner", async () => {
    const signed = await signedCustomData();
    const cases: Array<[string, Record<string, unknown> | undefined, Record<string, unknown>, RegExp]> = [
      ["another account", { ...signed, ownerId: "6aee6ff96e33177eefa98a9d" }, {}, /signature does not match/],
      ["an agency instead of a business", { ...signed, ownerType: "agency" }, {}, /signature does not match/],
      ["a dearer plan", { ...signed, planCode: "agency_growth_v2" }, {}, /signature does not match/],
      ["another interval", { ...signed, billingInterval: "yearly" }, {}, /signature does not match/],
      ["a variant claim edited to match a cheaper purchase", { ...signed, variantId: "2346457" }, { variant_id: 2346457 }, /signature does not match/],
      ["a correctly signed checkout used to buy another variant", signed, { variant_id: 2346465 }, /purchased variant 2346465 is not the checkout's signed variant 2346454/],
      ["unsigned custom data (a public buy link)", { ...CHECKOUT_INPUT.metadata, variantId: "2346454" }, {}, /without complete signed GarnishTable checkout data/],
      ["no custom data at all", undefined, {}, /without complete signed GarnishTable checkout data/],
      ["a malformed owner id", { ...signed, ownerId: "biz-1" }, {}, /without complete signed GarnishTable checkout data/],
    ];
    for (const [label, custom, attributes, reason] of cases) {
      const body = subscriptionEvent("subscription_created", { status: "active", ...attributes }, custom);
      const event = provider().verifyWebhookSignature(body, sign(body));
      expect({ label, reason: event?.rejectedReason }).toEqual({ label, reason: expect.stringMatching(reason) });
      expect(event!.checkoutMetadata).toBeUndefined();
      expect(event!.providerSubscriptionId).toBe("555");
    }
    // Signed by another server's key.
    const foreign = subscriptionEvent("subscription_created", { status: "active" }, await signedCustomData(CHECKOUT_INPUT, "another-servers-checkout-secret-xyz"));
    expect(provider().verifyWebhookSignature(foreign, sign(foreign))!.rejectedReason).toMatch(/signature does not match/);
  });

  it("gives a dashboard resend (new meta.webhook_id) the same event id, and strips the pre-signed urls from what is stored", () => {
    const urls = { customer_portal: "https://garnishtable.lemonsqueezy.com/billing?expires=1&signature=a", update_payment_method: "https://x.example/payment?signature=b" };
    const original = subscriptionEvent("subscription_updated", { status: "active", urls }, undefined, { webhook_id: "11111111-aaaa" });
    const resend = subscriptionEvent(
      "subscription_updated",
      { status: "active", urls: { ...urls, customer_portal: "https://garnishtable.lemonsqueezy.com/billing?expires=2&signature=c" } },
      undefined,
      { webhook_id: "22222222-bbbb" }
    );
    const a = provider().verifyWebhookSignature(original, sign(original))!;
    const b = provider().verifyWebhookSignature(resend, sign(resend))!;
    expect(a.eventId).toBe(b.eventId);
    const raw = a.raw as { meta: Record<string, unknown>; data: { attributes: Record<string, unknown> } };
    expect(raw.data.attributes).not.toHaveProperty("urls");
    expect(JSON.stringify(a.raw)).not.toContain("signature=");
    expect(raw.meta.webhook_id).toBe("11111111-aaaa"); // kept for support lookups, just not hashed
    expect(raw.data.attributes.status).toBe("active");
  });

  it("derives a stable event id from the signed body, so a redelivery de-duplicates and a different body does not", () => {
    const body = subscriptionEvent("subscription_updated", { status: "active" });
    const other = subscriptionEvent("subscription_updated", { status: "past_due" });
    const a = provider().verifyWebhookSignature(body, sign(body))!;
    const b = provider().verifyWebhookSignature(body, sign(body))!;
    const c = provider().verifyWebhookSignature(other, sign(other))!;
    expect(a.eventId).toMatch(/^lsq_subscription_updated_[0-9a-f]{64}$/);
    expect(a.eventId).toBe(b.eventId);
    expect(a.eventId).not.toBe(c.eventId);
  });

  it("treats Lemon Squeezy's 'cancelled' as a scheduled cancellation (still active until ends_at)", () => {
    const body = subscriptionEvent("subscription_cancelled", { status: "cancelled", cancelled: true, ends_at: "2026-12-07T10:00:00.000000Z" });
    const event = provider().verifyWebhookSignature(body, sign(body))!;
    expect(event.status).toBe("active");
    expect(event.scheduledCancelAt).toEqual(new Date("2026-12-07T10:00:00Z"));
    expect(event.checkoutMetadata).toBeUndefined();
  });

  it("clears the scheduled cancellation on resume and maps expiry, failed renewals and unknown statuses", () => {
    const resumed = subscriptionEvent("subscription_resumed", { status: "active" });
    expect(provider().verifyWebhookSignature(resumed, sign(resumed))).toMatchObject({ status: "active", scheduledCancelAt: null });

    const expired = subscriptionEvent("subscription_expired", { status: "expired", ends_at: "2026-12-07T10:00:00.000000Z" });
    const expiredEvent = provider().verifyWebhookSignature(expired, sign(expired))!;
    expect(expiredEvent.status).toBe("cancelled");
    expect(expiredEvent.currentPeriod).toBeUndefined();

    for (const [raw, mapped] of [
      ["past_due", "past_due"],
      ["unpaid", "past_due"],
      ["on_trial", "trialing"],
      ["paused", "cancelled"],
      ["something_new", "past_due"],
    ] as const) {
      const body = subscriptionEvent("subscription_updated", { status: raw });
      expect(provider().verifyWebhookSignature(body, sign(body))!.status).toBe(mapped);
    }
  });

  it("records a renewal payment as a billing notice without a subscription status or event ordering", () => {
    const body = Buffer.from(
      JSON.stringify({
        meta: { event_name: "subscription_payment_success" },
        data: {
          type: "subscription-invoices",
          id: "9001",
          attributes: { subscription_id: 555, billing_reason: "renewal", status: "paid", total: 5900, currency: "USD", test_mode: true, updated_at: "2026-12-07T10:00:00Z" },
        },
      })
    );
    const event = provider().verifyWebhookSignature(body, sign(body))!;
    expect(event.providerSubscriptionId).toBe("555");
    expect(event.status).toBeUndefined();
    expect(event.occurredAt).toBeUndefined();
    expect(event.billingNotice).toEqual({ type: "payment_succeeded", amountCents: 5900, currency: "USD", reference: "9001" });
  });

  it("gives no notice for the initial payment or a failed payment (subscription_updated reports past_due)", () => {
    for (const [name, reason] of [
      ["subscription_payment_success", "initial"],
      ["subscription_payment_failed", "renewal"],
    ]) {
      const body = Buffer.from(
        JSON.stringify({ meta: { event_name: name }, data: { type: "subscription-invoices", id: "1", attributes: { subscription_id: 555, billing_reason: reason, total: 5900, test_mode: true } } })
      );
      const event = provider().verifyWebhookSignature(body, sign(body))!;
      expect(event.billingNotice).toBeUndefined();
      expect(event.status).toBeUndefined();
    }
  });

  it("acknowledges order_created with nothing to apply", () => {
    const body = Buffer.from(JSON.stringify({ meta: { event_name: "order_created" }, data: { type: "orders", id: "42", attributes: { test_mode: true } } }));
    const event = provider().verifyWebhookSignature(body, sign(body))!;
    expect(event.providerSubscriptionId).toBe("");
    expect(event.status).toBeUndefined();
    expect(event.billingNotice).toBeUndefined();
  });

  it("marks an object from the other mode as simulated (recorded, never applied)", () => {
    const testBody = subscriptionEvent("subscription_updated", { status: "active", test_mode: true });
    expect(provider(false).verifyWebhookSignature(testBody, sign(testBody))!.simulated).toBe(true);
    expect(provider(true).verifyWebhookSignature(testBody, sign(testBody))!.simulated).toBe(false);
  });
});

describe("LemonSqueezyBillingProvider subscription calls", () => {
  const subscription = (attributes: Record<string, unknown>) => ({
    status: 200,
    body: {
      data: {
        id: "555",
        attributes: { variant_id: 2346454, created_at: "2026-11-07T10:00:00Z", renews_at: "2027-01-07T10:00:00Z", ends_at: null, ...attributes },
      },
    },
  });
  const monthlyVariant = { status: 200, body: { data: { id: "2346454", attributes: { interval: "month", interval_count: 1 } } } };

  it("retrieveSubscription steps the period start back one interval from renews_at", async () => {
    mockFetch(subscription({ status: "active" }), monthlyVariant);
    const snapshot = await provider().retrieveSubscription("555");
    expect(snapshot).toEqual({
      providerSubscriptionId: "555",
      status: "active",
      currentPeriodStart: new Date("2026-12-07T10:00:00Z"),
      currentPeriodEnd: new Date("2027-01-07T10:00:00Z"),
      trialEnd: undefined,
    });
  });

  it("never starts the period before the subscription was created", async () => {
    mockFetch(subscription({ status: "active", renews_at: "2026-12-07T10:00:00Z" }), {
      status: 200,
      body: { data: { id: "2346457", attributes: { interval: "year", interval_count: 1 } } },
    });
    const snapshot = await provider().retrieveSubscription("555");
    expect(snapshot.currentPeriodStart).toEqual(new Date("2026-11-07T10:00:00Z"));
  });

  it("cancels with DELETE and resumes with PATCH cancelled:false", async () => {
    const spy = mockFetch(
      subscription({ status: "cancelled", ends_at: "2027-01-07T10:00:00Z" }),
      monthlyVariant,
      subscription({ status: "active" }),
      monthlyVariant
    );
    const cancelled = await provider().cancelSubscription("555", true);
    expect(cancelled.currentPeriodEnd).toEqual(new Date("2027-01-07T10:00:00Z"));
    await provider().reactivateSubscription("555");

    const [cancelUrl, cancelInit] = spy.mock.calls[0] as [string, RequestInit];
    expect(cancelUrl).toBe("https://ls.example/subscriptions/555");
    expect(cancelInit.method).toBe("DELETE");
    const [, resumeInit] = spy.mock.calls[2] as [string, RequestInit];
    expect(resumeInit.method).toBe("PATCH");
    expect(JSON.parse(resumeInit.body as string)).toEqual({ data: { type: "subscriptions", id: "555", attributes: { cancelled: false } } });
  });

  it("changes plan by PATCHing the numeric variant id, and refuses a non-variant id before any request", async () => {
    const spy = mockFetch(subscription({ status: "active", variant_id: 2346465 }), monthlyVariant);
    await provider().changePlan("555", "2346465");
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).data.attributes).toEqual({ variant_id: 2346465 });

    await expect(provider().changePlan("555", "pri_abc")).rejects.toThrow("is not a Lemon Squeezy variant id");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("returns the pre-signed update-payment-method URL, or null when there is none", async () => {
    mockFetch(subscription({ urls: { update_payment_method: "https://garnishtable.lemonsqueezy.com/subscription/555/payment-details?signature=x" } }));
    expect(await provider().getPaymentMethodUpdateUrl("555")).toMatch(/^https:\/\/garnishtable\.lemonsqueezy\.com\//);
    mockFetch(subscription({ urls: { update_payment_method: null } }));
    expect(await provider().getPaymentMethodUpdateUrl("555")).toBeNull();
  });

  it("has no create-subscription API and creates no customer before checkout", async () => {
    const spy = jest.spyOn(globalThis, "fetch");
    await expect(provider().createSubscription({ providerCustomerId: "x", planCode: "owner_starter", billingInterval: "monthly" })).rejects.toThrow(
      "no create-subscription API"
    );
    const customer = await provider().createCustomer({ ownerType: "business", ownerId: "biz-1", email: "a@b.c", name: "A" });
    expect(customer.providerCustomerId).toBe("pending_checkout:business:biz-1");
    expect(spy).not.toHaveBeenCalled();
  });
});
