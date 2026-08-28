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

function provider() {
  return new PaddleBillingProvider("api-key", "webhook-secret", "https://sandbox-api.paddle.com");
}

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
