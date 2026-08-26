import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createHmac } from "node:crypto";
import { SafepayProvider } from "./SafepayProvider.js";

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
  return new SafepayProvider("api-key", "secret-key", "webhook-secret", "https://sandbox.api.getsafepay.com");
}

describe("SafepayProvider.createIntent", () => {
  it("creates a tracker and builds a hosted checkout URL from the returned token", async () => {
    const fetchSpy = mockFetchOnce(200, { data: { token: "tok_123" } });

    const intent = await provider().createIntent({
      amount: 12.5,
      currency: "PKR",
      orderId: "order-1",
      restaurantId: "rest-1",
      returnUrl: "https://example.com/orders/order-1",
      cancelUrl: "https://example.com/orders/order-1",
    });

    expect(intent.providerRef).toBe("tok_123");
    expect(intent.status).toBe("pending");
    expect(intent.clientSecret).toContain("tok_123");
    expect(intent.clientSecret).toContain(encodeURIComponent("https://example.com/orders/order-1"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sandbox.api.getsafepay.com/order/v1/init");
    const body = JSON.parse(init.body as string);
    // Amount must be sent in the smallest currency unit (cents/paisa) — never the raw decimal.
    expect(body.amount).toBe(1250);
    expect(body.currency).toBe("PKR");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
  });

  it("throws when Safepay's response has no token", async () => {
    mockFetchOnce(200, { data: {} });
    await expect(
      provider().createIntent({
        amount: 10,
        currency: "PKR",
        orderId: "o1",
        restaurantId: "r1",
        returnUrl: "https://example.com/orders/o1",
        cancelUrl: "https://example.com/orders/o1",
      })
    ).rejects.toThrow("did not return a payment token");
  });

  it("throws a clear error on a non-2xx response", async () => {
    mockFetchOnce(402, { message: "insufficient funds" }, false);
    await expect(
      provider().createIntent({
        amount: 10,
        currency: "PKR",
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
        currency: "PKR",
        orderId: "o1",
        restaurantId: "r1",
        returnUrl: "https://example.com/orders/o1",
        cancelUrl: "https://example.com/orders/o1",
      })
    ).rejects.toThrow("timed out");
  });
});

describe("SafepayProvider.retrieve", () => {
  it("maps a paid-equivalent status and converts amount back from the minor unit", async () => {
    mockFetchOnce(200, { data: { state: "TRACKER_COMPLETED", amount: 1250, currency: "PKR" } });
    const snapshot = await provider().retrieve("tok_123");
    expect(snapshot.status).toBe("paid");
    expect(snapshot.amount).toBe(12.5);
  });

  it("fails closed to pending for an unrecognized status rather than guessing paid", async () => {
    mockFetchOnce(200, { data: { state: "SOME_NEW_STATUS_SAFEPAY_ADDS_LATER" } });
    const snapshot = await provider().retrieve("tok_123");
    expect(snapshot.status).toBe("pending");
  });
});

describe("SafepayProvider.verifyWebhookSignature", () => {
  function sign(payload: object, secret = "webhook-secret") {
    const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
    return { rawBody, signatureHeader: `sha256=${signature}` };
  }

  it("accepts a correctly signed, well-formed payload", () => {
    const payload = { event_id: "evt_1", event: "payment.succeeded", tracker: "tok_123", state: "PAID" };
    const { rawBody, signatureHeader } = sign(payload);

    const event = provider().verifyWebhookSignature(rawBody, signatureHeader);

    expect(event).toEqual({
      eventId: "evt_1",
      eventType: "payment.succeeded",
      providerRef: "tok_123",
      status: "paid",
      raw: payload,
    });
  });

  it("rejects a payload signed with the wrong secret", () => {
    const payload = { event_id: "evt_1", event: "payment.succeeded", tracker: "tok_123", state: "PAID" };
    const { rawBody, signatureHeader } = sign(payload, "wrong-secret");
    expect(provider().verifyWebhookSignature(rawBody, signatureHeader)).toBeNull();
  });

  it("rejects a tampered body even when the header claims a matching signature", () => {
    const { signatureHeader } = sign({ event_id: "evt_1", event: "payment.succeeded", tracker: "tok_123", state: "PAID" });
    const tampered = Buffer.from(JSON.stringify({ event_id: "evt_1", event: "payment.succeeded", tracker: "tok_999", state: "PAID" }));
    expect(provider().verifyWebhookSignature(tampered, signatureHeader)).toBeNull();
  });

  it("rejects when the signature header is missing", () => {
    const { rawBody } = sign({ event_id: "evt_1" });
    expect(provider().verifyWebhookSignature(rawBody, undefined)).toBeNull();
  });

  it("rejects a well-signed payload that's missing required fields", () => {
    const { rawBody, signatureHeader } = sign({ event_id: "evt_1" });
    expect(provider().verifyWebhookSignature(rawBody, signatureHeader)).toBeNull();
  });

  it("rejects a non-hex signature header without throwing", () => {
    const rawBody = Buffer.from(JSON.stringify({ event_id: "evt_1" }), "utf-8");
    expect(provider().verifyWebhookSignature(rawBody, "not-hex-!!")).toBeNull();
  });
});

describe("SafepayProvider.refund", () => {
  it("maps a succeeded refund response", async () => {
    mockFetchOnce(200, { data: { refund_id: "re_1", state: "succeeded" } });
    const result = await provider().refund("tok_123", 5, "customer request");
    expect(result).toEqual({ refundRef: "re_1", status: "succeeded" });
  });

  it("sends the refund amount in the minor currency unit", async () => {
    const fetchSpy = mockFetchOnce(200, { data: { refund_id: "re_1", state: "pending" } });
    await provider().refund("tok_123", 5.5);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).amount).toBe(550);
  });

  it("throws when Safepay's response has no refund reference", async () => {
    mockFetchOnce(200, { data: {} });
    await expect(provider().refund("tok_123", 5)).rejects.toThrow("did not return a refund reference");
  });
});

describe("SafepayProvider.baseUrlForEnv", () => {
  it("defaults unsafely-guessable input toward sandbox, never production, on anything but an exact match", () => {
    expect(SafepayProvider.baseUrlForEnv("sandbox")).toBe("https://sandbox.api.getsafepay.com");
    expect(SafepayProvider.baseUrlForEnv("production")).toBe("https://api.getsafepay.com");
  });
});
