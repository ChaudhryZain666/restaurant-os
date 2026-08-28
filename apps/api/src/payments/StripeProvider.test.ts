import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createHmac } from "node:crypto";
import { StripeProvider } from "./StripeProvider.js";

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
  return new StripeProvider("sk_test_secret", "whsec_test_secret", "https://api.stripe.com");
}

describe("StripeProvider.createIntent", () => {
  it("creates a Checkout Session and returns its hosted URL as clientSecret", async () => {
    const fetchSpy = mockFetchOnce(200, { id: "cs_123", url: "https://checkout.stripe.com/c/pay/cs_123" });

    const intent = await provider().createIntent({
      amount: 12.5,
      currency: "USD",
      orderId: "order-1",
      restaurantId: "rest-1",
      metadata: { orderNumber: "ORD-1" },
      returnUrl: "https://example.com/orders/order-1",
      cancelUrl: "https://example.com/orders/order-1",
    });

    expect(intent.providerRef).toBe("cs_123");
    expect(intent.status).toBe("pending");
    expect(intent.clientSecret).toBe("https://checkout.stripe.com/c/pay/cs_123");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test_secret");
    const params = new URLSearchParams(init.body as string);
    // Amount must be sent in the smallest currency unit (cents) — never the raw decimal.
    expect(params.get("line_items[0][price_data][unit_amount]")).toBe("1250");
    expect(params.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(params.get("mode")).toBe("payment");
    expect(params.get("success_url")).toBe("https://example.com/orders/order-1");
    expect(params.get("cancel_url")).toBe("https://example.com/orders/order-1");
  });

  it("throws when Stripe's response has no session id/url", async () => {
    mockFetchOnce(200, {});
    await expect(
      provider().createIntent({
        amount: 10,
        currency: "USD",
        orderId: "o1",
        restaurantId: "r1",
        returnUrl: "https://example.com/orders/o1",
        cancelUrl: "https://example.com/orders/o1",
      })
    ).rejects.toThrow("did not return a checkout session");
  });

  it("throws a clear error on a non-2xx response", async () => {
    mockFetchOnce(402, { error: { message: "your card was declined" } }, false);
    await expect(
      provider().createIntent({
        amount: 10,
        currency: "USD",
        orderId: "o1",
        restaurantId: "r1",
        returnUrl: "https://example.com/orders/o1",
        cancelUrl: "https://example.com/orders/o1",
      })
    ).rejects.toThrow(/HTTP 402/);
  });

  it("throws on a request timeout rather than hanging", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementationOnce(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    await expect(
      provider().createIntent({
        amount: 10,
        currency: "USD",
        orderId: "o1",
        restaurantId: "r1",
        returnUrl: "https://example.com/orders/o1",
        cancelUrl: "https://example.com/orders/o1",
      })
    ).rejects.toThrow("timed out");
  });
});

describe("StripeProvider.retrieve", () => {
  it("maps a paid session and converts amount back from the minor unit", async () => {
    mockFetchOnce(200, { status: "complete", payment_status: "paid", amount_total: 1250, currency: "usd" });
    const snapshot = await provider().retrieve("cs_123");
    expect(snapshot.status).toBe("paid");
    expect(snapshot.amount).toBe(12.5);
  });

  it("maps an open, unpaid session to pending", async () => {
    mockFetchOnce(200, { status: "open", payment_status: "unpaid" });
    const snapshot = await provider().retrieve("cs_123");
    expect(snapshot.status).toBe("pending");
  });

  it("maps an expired session to cancelled", async () => {
    mockFetchOnce(200, { status: "expired", payment_status: "unpaid" });
    const snapshot = await provider().retrieve("cs_123");
    expect(snapshot.status).toBe("cancelled");
  });
});

describe("StripeProvider.verifyWebhookSignature", () => {
  function sign(payload: object, secret = "whsec_test_secret", tOverride?: number) {
    const t = tOverride ?? Math.floor(Date.now() / 1000);
    const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
    const signedPayload = `${t}.${rawBody.toString("utf-8")}`;
    const v1 = createHmac("sha256", secret).update(signedPayload).digest("hex");
    return { rawBody, signatureHeader: `t=${t},v1=${v1}` };
  }

  const payload = { id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_123", status: "complete", payment_status: "paid" } } };

  it("accepts a correctly signed, well-formed payload", () => {
    const { rawBody, signatureHeader } = sign(payload);
    const event = provider().verifyWebhookSignature(rawBody, signatureHeader);
    expect(event).toEqual({ eventId: "evt_1", eventType: "checkout.session.completed", providerRef: "cs_123", status: "paid", raw: payload });
  });

  it("rejects a payload signed with the wrong secret", () => {
    const { rawBody, signatureHeader } = sign(payload, "wrong-secret");
    expect(provider().verifyWebhookSignature(rawBody, signatureHeader)).toBeNull();
  });

  it("rejects a tampered body even when the header claims a matching signature", () => {
    const { signatureHeader } = sign(payload);
    const tampered = Buffer.from(JSON.stringify({ ...payload, id: "evt_evil" }));
    expect(provider().verifyWebhookSignature(tampered, signatureHeader)).toBeNull();
  });

  it("rejects when the signature header is missing", () => {
    const { rawBody } = sign(payload);
    expect(provider().verifyWebhookSignature(rawBody, undefined)).toBeNull();
  });

  it("rejects a timestamp older than the replay window even with a valid signature", () => {
    const staleT = Math.floor(Date.now() / 1000) - 600; // 10 minutes old
    const { rawBody, signatureHeader } = sign(payload, "whsec_test_secret", staleT);
    expect(provider().verifyWebhookSignature(rawBody, signatureHeader)).toBeNull();
  });

  it("rejects a well-signed payload that's missing required fields", () => {
    const { rawBody, signatureHeader } = sign({ id: "evt_1" });
    expect(provider().verifyWebhookSignature(rawBody, signatureHeader)).toBeNull();
  });

  it("maps checkout.session.expired to cancelled", () => {
    const expiredPayload = { id: "evt_2", type: "checkout.session.expired", data: { object: { id: "cs_123", status: "expired" } } };
    const { rawBody, signatureHeader } = sign(expiredPayload);
    const event = provider().verifyWebhookSignature(rawBody, signatureHeader);
    expect(event?.status).toBe("cancelled");
  });
});

describe("StripeProvider.refund", () => {
  it("resolves the session's payment_intent, then refunds against it in the minor currency unit", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ id: "cs_123", payment_intent: "pi_123" }) } as unknown as Response)
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ id: "re_1", status: "succeeded" }) } as unknown as Response);

    const result = await provider().refund("cs_123", 5.5);

    expect(result).toEqual({ refundRef: "re_1", status: "succeeded" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [refundUrl, refundInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(refundUrl).toBe("https://api.stripe.com/v1/refunds");
    const params = new URLSearchParams(refundInit.body as string);
    expect(params.get("payment_intent")).toBe("pi_123");
    expect(params.get("amount")).toBe("550");
  });

  it("throws when the session has no payment_intent to refund", async () => {
    mockFetchOnce(200, { id: "cs_123" });
    await expect(provider().refund("cs_123", 5)).rejects.toThrow("no associated payment_intent");
  });
});
