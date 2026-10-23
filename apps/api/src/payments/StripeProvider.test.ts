import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createHmac } from "node:crypto";
import { StripeProvider, mapStripeRefundStatus, parseStripeRefundEvent } from "./StripeProvider.js";

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

    const result = await provider().refund("cs_123", 5.5, undefined, { idempotencyKey: "gt_refund_abc" });

    expect(result).toEqual({ refundRef: "re_1", status: "succeeded", providerStatus: "succeeded" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [refundUrl, refundInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(refundUrl).toBe("https://api.stripe.com/v1/refunds");
    const params = new URLSearchParams(refundInit.body as string);
    expect(params.get("payment_intent")).toBe("pi_123");
    expect(params.get("amount")).toBe("550");
    // Stripe's documented idempotency: a retry with this key returns the original refund.
    expect((refundInit.headers as Record<string, string>)["Idempotency-Key"]).toBe("gt_refund_abc");
    // ...and the same key rides along as metadata, so the refund can be found again by lookup.
    expect(params.get("metadata[gt_refund_key]")).toBe("gt_refund_abc");
  });

  it("maps requires_action and unknown statuses to pending (amount stays reserved)", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ id: "cs_9", payment_intent: "pi_9" }) } as unknown as Response)
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ id: "re_9", status: "requires_action" }) } as unknown as Response);
    expect(await provider().refund("cs_9", 5, undefined, { idempotencyKey: "k9" })).toEqual({ refundRef: "re_9", status: "pending", providerStatus: "requires_action" });
  });

  it("classifies failures: session lookup failure = rejected, provider 5xx/timeout = unknown, 4xx = rejected", async () => {
    mockFetchOnce(500, { error: { message: "boom" } });
    await expect(provider().refund("cs_1", 5, undefined, { idempotencyKey: "k1" })).rejects.toMatchObject({ outcome: "rejected" });

    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ id: "cs_2", payment_intent: "pi_2" }) } as unknown as Response)
      .mockResolvedValueOnce({ status: 502, ok: false, json: async () => ({ error: { message: "bad gateway" } }) } as unknown as Response);
    await expect(provider().refund("cs_2", 5, undefined, { idempotencyKey: "k2" })).rejects.toMatchObject({ outcome: "unknown" });

    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ id: "cs_3", payment_intent: "pi_3" }) } as unknown as Response)
      .mockResolvedValueOnce({ status: 400, ok: false, json: async () => ({ error: { message: "amount too large" } }) } as unknown as Response);
    await expect(provider().refund("cs_3", 5, undefined, { idempotencyKey: "k3" })).rejects.toMatchObject({ outcome: "rejected" });

    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ id: "cs_4", payment_intent: "pi_4" }) } as unknown as Response)
      .mockImplementationOnce(() => {
        const err = new Error("aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      });
    await expect(provider().refund("cs_4", 5, undefined, { idempotencyKey: "k4" })).rejects.toMatchObject({ outcome: "unknown" });
  });

  it("declares documented refund idempotency", () => {
    expect(provider().supportsRefundIdempotency).toBe(true);
  });

  it("throws when the session has no payment_intent to refund", async () => {
    mockFetchOnce(200, { id: "cs_123" });
    await expect(provider().refund("cs_123", 5, undefined, { idempotencyKey: "k" })).rejects.toThrow("no associated payment_intent");
  });
});

describe("StripeProvider.verifyCredentials", () => {
  it("resolves true when GET /v1/balance succeeds", async () => {
    const fetchSpy = mockFetchOnce(200, { object: "balance" });
    await expect(provider().verifyCredentials()).resolves.toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/balance");
    expect(init.method).toBe("GET");
  });

  it("resolves false, never throws, when the key is rejected", async () => {
    mockFetchOnce(401, { error: { message: "Invalid API Key provided" } }, false);
    await expect(provider().verifyCredentials()).resolves.toBe(false);
  });
});

describe("Stripe refund status mapping", () => {
  it("releases only on failed or canceled; everything not final stays pending", () => {
    expect(mapStripeRefundStatus("succeeded")).toBe("succeeded");
    expect(mapStripeRefundStatus("failed")).toBe("failed");
    expect(mapStripeRefundStatus("canceled")).toBe("failed");
    expect(mapStripeRefundStatus("pending")).toBe("pending");
    expect(mapStripeRefundStatus("requires_action")).toBe("pending");
    expect(mapStripeRefundStatus("something_new")).toBe("pending");
    expect(mapStripeRefundStatus(undefined)).toBe("pending");
  });
});

describe("Stripe refund events", () => {
  const refundEvent = (type: string, object: Record<string, unknown>) => ({ id: "evt_r1", type, data: { object } });

  it("parses refund.created / refund.updated / refund.failed / charge.refund.updated, carrying our refund key", () => {
    for (const type of ["refund.created", "refund.updated", "refund.failed", "charge.refund.updated"]) {
      expect(parseStripeRefundEvent(refundEvent(type, { id: "re_1", object: "refund", status: "failed", metadata: { gt_refund_key: "gt_refund_k" } }))).toEqual({
        refundRef: "re_1",
        status: "failed",
        providerStatus: "failed",
        refundKey: "gt_refund_k",
      });
    }
  });

  it("ignores non-refund events and malformed refund objects", () => {
    expect(parseStripeRefundEvent(refundEvent("checkout.session.completed", { id: "cs_1", object: "checkout.session" }))).toBeNull();
    expect(parseStripeRefundEvent(refundEvent("refund.updated", { id: "re_1", object: "charge" }))).toBeNull();
    expect(parseStripeRefundEvent(refundEvent("refund.updated", { object: "refund", status: "succeeded" }))).toBeNull();
  });

  it("a signed refund event is routed as a refund event, never as a payment status", () => {
    const payload = refundEvent("refund.updated", { id: "re_2", object: "refund", status: "succeeded" });
    const t = Math.floor(Date.now() / 1000);
    const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
    const v1 = createHmac("sha256", "whsec_test_secret").update(`${t}.${rawBody.toString("utf-8")}`).digest("hex");
    const event = provider().verifyWebhookSignature(rawBody, `t=${t},v1=${v1}`);
    expect(event).toMatchObject({ eventId: "evt_r1", providerRef: "re_2", status: "pending", refund: { refundRef: "re_2", status: "succeeded" } });
  });
});

describe("StripeProvider.lookupRefund", () => {
  const ok = (body: unknown) => ({ status: 200, ok: true, json: async () => body }) as unknown as Response;

  it("by refund id: GET /v1/refunds/{id}", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok({ id: "re_1", status: "pending" }));
    expect(await provider().lookupRefund({ providerRef: "cs_1", refundKey: "k", refundRef: "re_1" })).toEqual({
      found: true,
      refundRef: "re_1",
      status: "pending",
      providerStatus: "pending",
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/refunds/re_1");
    expect(init.method).toBe("GET");
  });

  it("by our key: lists the payment intent's refunds, following pages, matching metadata", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok({ id: "cs_1", payment_intent: "pi_1" }))
      .mockResolvedValueOnce(ok({ data: [{ id: "re_a", status: "succeeded", metadata: { gt_refund_key: "other" } }], has_more: true }))
      .mockResolvedValueOnce(ok({ data: [{ id: "re_b", status: "succeeded", metadata: { gt_refund_key: "k" } }], has_more: false }));
    expect(await provider().lookupRefund({ providerRef: "cs_1", refundKey: "k" })).toEqual({
      found: true,
      refundRef: "re_b",
      status: "succeeded",
      providerStatus: "succeeded",
    });
    const second = new URL((fetchSpy.mock.calls[2] as [string])[0]);
    expect(second.pathname).toBe("/v1/refunds");
    expect(second.searchParams.get("payment_intent")).toBe("pi_1");
    expect(second.searchParams.get("starting_after")).toBe("re_a");
  });

  it("definitively not found only when every page was read", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok({ id: "cs_1", payment_intent: "pi_1" }))
      .mockResolvedValueOnce(ok({ data: [], has_more: false }));
    expect(await provider().lookupRefund({ providerRef: "cs_1", refundKey: "k" })).toEqual({ found: false });
  });

  it("is inconclusive (throws 'unknown') on any error — including 4xx, timeouts and unreadable lists — never 'not found'", async () => {
    mockFetchOnce(404, { error: { message: "No such refund" } });
    await expect(provider().lookupRefund({ providerRef: "cs_1", refundKey: "k", refundRef: "re_x" })).rejects.toMatchObject({ outcome: "unknown" });

    mockFetchOnce(500, { error: { message: "boom" } });
    await expect(provider().lookupRefund({ providerRef: "cs_1", refundKey: "k" })).rejects.toMatchObject({ outcome: "unknown" });

    jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(provider().lookupRefund({ providerRef: "cs_1", refundKey: "k" })).rejects.toMatchObject({ outcome: "unknown" });

    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok({ id: "cs_1", payment_intent: "pi_1" }))
      .mockResolvedValueOnce(ok({ unexpected: true }));
    await expect(provider().lookupRefund({ providerRef: "cs_1", refundKey: "k" })).rejects.toMatchObject({ outcome: "unknown" });
  });

  it("is inconclusive when there are more refunds than it pages through", async () => {
    const spy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok({ id: "cs_1", payment_intent: "pi_1" }));
    for (let i = 0; i < 10; i++) spy.mockResolvedValueOnce(ok({ data: [{ id: `re_${i}`, status: "succeeded", metadata: {} }], has_more: true }));
    await expect(provider().lookupRefund({ providerRef: "cs_1", refundKey: "k" })).rejects.toMatchObject({ outcome: "unknown" });
  });
});
