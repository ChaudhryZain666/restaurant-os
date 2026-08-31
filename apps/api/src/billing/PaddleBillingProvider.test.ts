import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createHmac } from "node:crypto";
import { PaddleBillingProvider } from "./PaddleBillingProvider.js";

afterEach(() => {
  jest.restoreAllMocks();
});

function mockFetchOnce(status: number, body: unknown, ok = status >= 200 && status < 300) {
  return jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    status,
    ok,
    json: async () => body,
  } as unknown as Response);
}

function provider(clientToken?: string) {
  return new PaddleBillingProvider("api-key", "webhook-secret", "https://sandbox-api.paddle.com", clientToken);
}

/**
 * Phase 40 — proves the real bug live verification found: createCheckoutSession previously
 * returned the per-CUSTOMER providerCustomerId as `clientToken`, which real Paddle.js's
 * Paddle.Initialize({token}) requires to be a public, per-ENVIRONMENT credential instead (confirmed
 * against developer.paddle.com/paddlejs). Fixed to source clientToken from a real
 * PADDLE_CLIENT_TOKEN value, and to thread providerCustomerId through as its own separate field.
 */
describe("PaddleBillingProvider.createCheckoutSession", () => {
  it("returns the real per-environment client token, not the per-customer id", async () => {
    const session = await provider("real-env-client-token").createCheckoutSession({
      providerCustomerId: "ctm_123",
      providerPriceId: "pri_456",
      metadata: { ownerType: "business", ownerId: "biz-1", planCode: "owner_growth", billingInterval: "monthly" },
      successUrl: "https://admin.example.com/billing-checkout-complete",
      cancelUrl: "https://admin.example.com/billing",
    });
    expect(session).toEqual({
      mode: "overlay",
      clientToken: "real-env-client-token",
      providerPriceId: "pri_456",
      providerCustomerId: "ctm_123",
    });
    // The bug this fixed: clientToken must never equal the customer id.
    expect(session.clientToken).not.toBe("ctm_123");
  });

  it("throws clearly when PADDLE_CLIENT_TOKEN is not configured, rather than handing the frontend an invalid token", async () => {
    await expect(
      provider(undefined).createCheckoutSession({
        providerCustomerId: "ctm_123",
        providerPriceId: "pri_456",
        metadata: { ownerType: "business", ownerId: "biz-1", planCode: "owner_growth", billingInterval: "monthly" },
        successUrl: "https://admin.example.com/billing-checkout-complete",
        cancelUrl: "https://admin.example.com/billing",
      })
    ).rejects.toThrow("PADDLE_CLIENT_TOKEN is not configured");
  });
});

describe("PaddleBillingProvider.createCustomer", () => {
  it("creates a customer and returns its provider id", async () => {
    const fetchSpy = mockFetchOnce(200, { data: { id: "ctm_123", email: "a@b.com", name: "Acme" } });

    const customer = await provider().createCustomer({ ownerType: "business", ownerId: "biz-1", email: "a@b.com", name: "Acme" });

    expect(customer).toEqual({ providerCustomerId: "ctm_123", email: "a@b.com", name: "Acme" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sandbox-api.paddle.com/customers");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer api-key");
    expect(JSON.parse(init.body as string).custom_data).toEqual({ ownerType: "business", ownerId: "biz-1" });
  });

  it("throws when Paddle's response has no customer id", async () => {
    mockFetchOnce(200, { data: {} });
    await expect(provider().createCustomer({ ownerType: "business", ownerId: "biz-1", email: "a@b.com", name: "Acme" })).rejects.toThrow(
      "did not return a customer id"
    );
  });

  it("throws a clear error on a non-2xx response", async () => {
    mockFetchOnce(402, { error: { detail: "payment required" } }, false);
    await expect(provider().createCustomer({ ownerType: "business", ownerId: "biz-1", email: "a@b.com", name: "Acme" })).rejects.toThrow(
      /HTTP 402/
    );
  });

  /**
   * Phase 40.3 — live-verified against the real Paddle sandbox: a second createCustomer call with
   * an email already in use returns exactly
   * `{"error":{"code":"customer_already_exists","detail":"customer email conflicts with customer of
   * id ctm_..."}}` (HTTP 409). This is the real class of failure a checkout retry/abandoned-checkout
   * hits. createCustomer must recover by reusing that existing customer — but only for the same
   * owner.
   */
  it("recovers from a same-owner Paddle 409 by reusing the existing customer", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        status: 409,
        ok: false,
        json: async () => ({
          error: { code: "customer_already_exists", detail: "customer email conflicts with customer of id ctm_existing123" },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          data: { id: "ctm_existing123", email: "a@b.com", name: "Acme", custom_data: { ownerType: "business", ownerId: "biz-1" } },
        }),
      } as unknown as Response);

    const customer = await provider().createCustomer({ ownerType: "business", ownerId: "biz-1", email: "a@b.com", name: "Acme" });

    expect(customer).toEqual({ providerCustomerId: "ctm_existing123", email: "a@b.com", name: "Acme" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((fetchSpy.mock.calls[1] as [string])[0]).toBe("https://sandbox-api.paddle.com/customers/ctm_existing123");
  });

  it("refuses to reuse a Paddle customer that belongs to a different owner, rather than silently merging", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        status: 409,
        ok: false,
        json: async () => ({
          error: { code: "customer_already_exists", detail: "customer email conflicts with customer of id ctm_existing123" },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          data: {
            id: "ctm_existing123",
            email: "a@b.com",
            name: "Someone Else",
            custom_data: { ownerType: "business", ownerId: "biz-DIFFERENT" },
          },
        }),
      } as unknown as Response);

    await expect(
      provider().createCustomer({ ownerType: "business", ownerId: "biz-1", email: "a@b.com", name: "Acme" })
    ).rejects.toThrow(/different owner/);
  });

  it("does not attempt recovery for a 409 that isn't customer_already_exists", async () => {
    const fetchSpy = mockFetchOnce(409, { error: { code: "some_other_conflict", detail: "unrelated conflict" } }, false);
    await expect(provider().createCustomer({ ownerType: "business", ownerId: "biz-1", email: "a@b.com", name: "Acme" })).rejects.toThrow(
      /HTTP 409/
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("PaddleBillingProvider.createSubscription / retrieveSubscription / cancelSubscription", () => {
  const subscriptionResponse = {
    data: {
      id: "sub_123",
      status: "trialing",
      current_billing_period: { starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-01-15T00:00:00Z" },
    },
  };

  it("creates a subscription and maps the snapshot fields", async () => {
    mockFetchOnce(200, subscriptionResponse);
    const snapshot = await provider().createSubscription({ providerCustomerId: "ctm_123", planCode: "pri_123", billingInterval: "monthly", trialDays: 14 });
    expect(snapshot.providerSubscriptionId).toBe("sub_123");
    expect(snapshot.status).toBe("trialing");
    expect(snapshot.currentPeriodStart).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(snapshot.trialEnd).toEqual(new Date("2026-01-15T00:00:00Z"));
  });

  it("retrieves an existing subscription by id", async () => {
    const fetchSpy = mockFetchOnce(200, subscriptionResponse);
    await provider().retrieveSubscription("sub_123");
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe("https://sandbox-api.paddle.com/subscriptions/sub_123");
  });

  it("cancels a subscription, passing effective_from based on atPeriodEnd", async () => {
    const fetchSpy = mockFetchOnce(200, { data: { ...subscriptionResponse.data, status: "canceled" } });
    const snapshot = await provider().cancelSubscription("sub_123", true);
    expect(snapshot.status).toBe("cancelled");
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).effective_from).toBe("next_billing_period");
  });

  it("throws when the response has no subscription id", async () => {
    mockFetchOnce(200, { data: {} });
    await expect(provider().retrieveSubscription("sub_123")).rejects.toThrow("did not return a subscription id");
  });
});

describe("PaddleBillingProvider.verifyWebhookSignature", () => {
  function sign(payload: object, secret = "webhook-secret", tsOverride?: number) {
    const ts = tsOverride ?? Math.floor(Date.now() / 1000);
    const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
    const signedPayload = `${ts}:${rawBody.toString("utf-8")}`;
    const h1 = createHmac("sha256", secret).update(signedPayload).digest("hex");
    return { rawBody, signatureHeader: `ts=${ts};h1=${h1}` };
  }

  const payload = { event_id: "evt_1", event_type: "subscription.updated", data: { id: "sub_123", status: "active" } };

  it("accepts a correctly signed, well-formed payload", () => {
    const { rawBody, signatureHeader } = sign(payload);
    const event = provider().verifyWebhookSignature(rawBody, signatureHeader);
    expect(event).toMatchObject({ eventId: "evt_1", eventType: "subscription.updated", providerSubscriptionId: "sub_123", status: "active" });
  });

  it("rejects a payload signed with the wrong secret", () => {
    const { rawBody, signatureHeader } = sign(payload, "wrong-secret");
    expect(provider().verifyWebhookSignature(rawBody, signatureHeader)).toBeNull();
  });

  it("rejects a tampered body even when the header claims a matching signature", () => {
    const { signatureHeader } = sign(payload);
    const tampered = Buffer.from(JSON.stringify({ ...payload, event_id: "evt_evil" }));
    expect(provider().verifyWebhookSignature(tampered, signatureHeader)).toBeNull();
  });

  it("rejects when the signature header is missing", () => {
    const { rawBody } = sign(payload);
    expect(provider().verifyWebhookSignature(rawBody, undefined)).toBeNull();
  });

  // Phase 34 — re-verified against Paddle's own docs: the real default replay tolerance is 5
  // seconds (WEBHOOK_MAX_AGE_SECONDS), not the 300s this adapter originally assumed.
  it("rejects a timestamp older than the 5-second replay window even with a valid signature", () => {
    const staleTs = Math.floor(Date.now() / 1000) - 10;
    const { rawBody, signatureHeader } = sign(payload, "webhook-secret", staleTs);
    expect(provider().verifyWebhookSignature(rawBody, signatureHeader)).toBeNull();
  });

  it("accepts a timestamp within the 5-second replay window", () => {
    const freshTs = Math.floor(Date.now() / 1000) - 2;
    const { rawBody, signatureHeader } = sign(payload, "webhook-secret", freshTs);
    expect(provider().verifyWebhookSignature(rawBody, signatureHeader)).not.toBeNull();
  });

  it("rejects a well-signed payload that's missing required fields", () => {
    const { rawBody, signatureHeader } = sign({ event_id: "evt_1" });
    expect(provider().verifyWebhookSignature(rawBody, signatureHeader)).toBeNull();
  });

  it("recognizes a checkout-completion event via custom_data and surfaces checkoutMetadata", () => {
    const checkoutPayload = {
      event_id: "evt_2",
      event_type: "subscription.created",
      data: {
        id: "sub_456",
        status: "trialing",
        customer_id: "ctm_1",
        custom_data: { ownerType: "business", ownerId: "biz-1", planCode: "owner_pro", billingInterval: "monthly" },
      },
    };
    const { rawBody, signatureHeader } = sign(checkoutPayload);
    const event = provider().verifyWebhookSignature(rawBody, signatureHeader);
    expect(event?.checkoutMetadata).toEqual({
      ownerType: "business",
      ownerId: "biz-1",
      planCode: "owner_pro",
      billingInterval: "monthly",
      providerCustomerId: "ctm_1",
    });
  });
});

describe("PaddleBillingProvider.baseUrlForEnv", () => {
  it("defaults unsafely-guessable input toward sandbox, never production, on anything but an exact match", () => {
    expect(PaddleBillingProvider.baseUrlForEnv("sandbox")).toBe("https://sandbox-api.paddle.com");
    expect(PaddleBillingProvider.baseUrlForEnv("production")).toBe("https://api.paddle.com");
  });
});
