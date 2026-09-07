import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createHmac } from "node:crypto";
import { UberDirectProvider, mapUberStatus } from "./UberDirectProvider.js";
import type { DeliveryContact } from "./DeliveryProvider.js";

afterEach(() => {
  jest.restoreAllMocks();
});

const AUTH_RESPONSE = { access_token: "test-token", expires_in: 2_592_000 };

function mockResponse(status: number, body: unknown, ok = status >= 200 && status < 300) {
  return { status, ok, json: async () => body } as unknown as Response;
}

/** Every provider action authenticates first (OAuth2 client-credentials) — queues the auth
 *  response, then the actual API call's response, matching the two real fetches each action makes. */
function mockAuthThen(status: number, body: unknown, ok?: boolean) {
  return jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(mockResponse(200, AUTH_RESPONSE))
    .mockResolvedValueOnce(mockResponse(status, body, ok));
}

function provider() {
  return new UberDirectProvider("client-id", "client-secret", "customer-id", "webhook-secret");
}

const pickup: DeliveryContact = { name: "Test Restaurant", phone: "+920000000000", address: "1 Test St", latitude: 24.86, longitude: 67.0 };
const dropoff: DeliveryContact = { name: "Test Customer", phone: "+920000000001", address: "2 Customer Ave", latitude: 24.87, longitude: 67.01 };

describe("UberDirectProvider.getQuote", () => {
  it("maps a successful quote response", async () => {
    mockAuthThen(200, { id: "quote_1", fee: 350, currency: "PKR", duration: 25 });
    const quote = await provider().getQuote({ pickup, dropoff, currency: "PKR" });
    expect(quote).toEqual({ quoteId: "quote_1", fee: 350, currency: "PKR", estimatedDurationMinutes: 25, raw: expect.any(Object) });
  });
});

describe("UberDirectProvider.createDelivery", () => {
  it("creates a delivery, mapping the provider status and sending the idempotency key header", async () => {
    const fetchSpy = mockAuthThen(200, { id: "del_1", status: "pending", tracking_url: "https://track.uber.com/del_1", fee: 400, currency: "PKR" });

    const result = await provider().createDelivery({
      orderId: "order-1",
      restaurantId: "rest-1",
      pickup,
      dropoff,
      manifestItems: [{ name: "Burger", quantity: 2 }],
      idempotencyKey: "delivery_create_order-1",
    });

    expect(result).toEqual({
      providerDeliveryId: "del_1",
      status: "requested",
      trackingUrl: "https://track.uber.com/del_1",
      fee: 400,
      currency: "PKR",
      raw: expect.any(Object),
    });
    const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("delivery_create_order-1");
  });
});

describe("UberDirectProvider.getDelivery", () => {
  it("maps courier and ETA fields from a delivery snapshot", async () => {
    mockAuthThen(200, {
      id: "del_1",
      status: "pickup",
      tracking_url: "https://track.uber.com/del_1",
      courier: { name: "Ali", phone_number: "+920000000002" },
      pickup_eta: "2026-01-01T12:00:00.000Z",
      dropoff_eta: "2026-01-01T12:30:00.000Z",
    });

    const snapshot = await provider().getDelivery("del_1");

    expect(snapshot.status).toBe("driver_assigned");
    expect(snapshot.courierName).toBe("Ali");
    expect(snapshot.courierPhone).toBe("+920000000002");
    expect(snapshot.pickupEta).toBe("2026-01-01T12:00:00.000Z");
    expect(snapshot.dropoffEta).toBe("2026-01-01T12:30:00.000Z");
  });
});

describe("UberDirectProvider.cancelDelivery", () => {
  it("returns cancelled:true on a successful cancel", async () => {
    mockAuthThen(200, {});
    const result = await provider().cancelDelivery("del_1", "customer changed their mind");
    expect(result).toEqual({ cancelled: true });
  });
});

describe("UberDirectProvider — provider error handling", () => {
  it("maps 401 to invalid_credentials", async () => {
    mockAuthThen(401, { message: "bad token" }, false);
    await expect(provider().getDelivery("del_1")).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("maps 429 to rate_limited", async () => {
    mockAuthThen(429, { message: "slow down" }, false);
    await expect(provider().getDelivery("del_1")).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("maps 404 to not_found", async () => {
    mockAuthThen(404, { message: "no such delivery" }, false);
    await expect(provider().getDelivery("del_1")).rejects.toMatchObject({ code: "not_found" });
  });

  it("maps 422 to invalid_address", async () => {
    mockAuthThen(422, { message: "can't deliver there" }, false);
    await expect(
      provider().createDelivery({ orderId: "o1", restaurantId: "r1", pickup, dropoff, manifestItems: [], idempotencyKey: "k" })
    ).rejects.toMatchObject({ code: "invalid_address" });
  });

  it("maps an unrecognized non-2xx status to provider_error", async () => {
    mockAuthThen(500, { message: "boom" }, false);
    await expect(provider().getDelivery("del_1")).rejects.toMatchObject({ code: "provider_error" });
  });

  it("maps a malformed (unparseable) JSON response to provider_error", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(200, AUTH_RESPONSE))
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => {
          throw new Error("bad json");
        },
      } as unknown as Response);
    await expect(provider().getDelivery("del_1")).rejects.toMatchObject({ code: "provider_error" });
  });

  it("maps a network timeout to a timeout error", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(200, AUTH_RESPONSE))
      .mockImplementationOnce(() => {
        const err = new Error("aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      });
    await expect(provider().getDelivery("del_1")).rejects.toMatchObject({ code: "timeout" });
  });

  it("maps a failed authentication (no access_token) to invalid_credentials", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse(401, { error: "invalid_client" }, false));
    await expect(provider().getDelivery("del_1")).rejects.toMatchObject({ code: "invalid_credentials" });
  });
});

describe("UberDirectProvider.healthCheck", () => {
  it("returns true when authentication succeeds", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse(200, AUTH_RESPONSE));
    expect(await provider().healthCheck()).toBe(true);
  });

  it("returns false, never throws, when authentication fails", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse(401, {}, false));
    expect(await provider().healthCheck()).toBe(false);
  });
});

describe("UberDirectProvider — access token caching", () => {
  it("reuses a cached token across calls instead of re-authenticating every time", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(200, AUTH_RESPONSE))
      .mockResolvedValueOnce(mockResponse(200, { id: "del_1", status: "delivered" }))
      .mockResolvedValueOnce(mockResponse(200, { id: "del_1", status: "delivered" }));

    const p = provider();
    await p.getDelivery("del_1");
    await p.getDelivery("del_1");

    // 1 auth call + 2 actual calls = 3 total, not 4 — the second getDelivery reused the cached token.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe("UberDirectProvider.mapUberStatus", () => {
  it("maps every documented Uber status to its normalized internal equivalent", () => {
    expect(mapUberStatus("pending")).toBe("requested");
    expect(mapUberStatus("pickup")).toBe("driver_assigned");
    expect(mapUberStatus("pickup_complete")).toBe("picked_up");
    expect(mapUberStatus("dropoff")).toBe("out_for_delivery");
    expect(mapUberStatus("delivered")).toBe("delivered");
    expect(mapUberStatus("canceled")).toBe("cancelled");
    expect(mapUberStatus("returned")).toBe("failed");
  });

  it("fails closed to a non-terminal status for anything unrecognized — never silently 'delivered'", () => {
    expect(mapUberStatus("some_new_status_uber_adds_later")).toBe("requested");
  });
});

describe("UberDirectProvider.verifyWebhookSignature", () => {
  function sign(payload: object, secret = "webhook-secret") {
    const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
    const signatureHeader = createHmac("sha256", secret).update(rawBody).digest("hex");
    return { rawBody, signatureHeader };
  }

  const validPayload = {
    id: "evt_1",
    kind: "event.delivery_status",
    delivery_id: "del_1",
    status: "pickup_complete",
    data: { courier: { name: "Ali", phone_number: "+920000000002" }, tracking_url: "https://track.uber.com/del_1" },
  };

  it("accepts a correctly signed, well-formed payload", () => {
    const { rawBody, signatureHeader } = sign(validPayload);
    const event = provider().verifyWebhookSignature(rawBody, signatureHeader);
    expect(event).toEqual({
      eventId: "evt_1",
      eventType: "event.delivery_status",
      providerDeliveryId: "del_1",
      status: "picked_up",
      courierName: "Ali",
      courierPhone: "+920000000002",
      trackingUrl: "https://track.uber.com/del_1",
      cancelReason: undefined,
      raw: validPayload,
    });
  });

  it("rejects a payload signed with the wrong secret", () => {
    const { rawBody, signatureHeader } = sign(validPayload, "wrong-secret");
    expect(provider().verifyWebhookSignature(rawBody, signatureHeader)).toBeNull();
  });

  it("rejects a tampered body even when the header claims a matching signature", () => {
    const { signatureHeader } = sign(validPayload);
    const tampered = Buffer.from(JSON.stringify({ ...validPayload, delivery_id: "del_999" }), "utf-8");
    expect(provider().verifyWebhookSignature(tampered, signatureHeader)).toBeNull();
  });

  it("rejects when the signature header is missing", () => {
    const { rawBody } = sign(validPayload);
    expect(provider().verifyWebhookSignature(rawBody, undefined)).toBeNull();
  });

  it("rejects an unparseable body without throwing", () => {
    const rawBody = Buffer.from("not json", "utf-8");
    const signatureHeader = createHmac("sha256", "webhook-secret").update(rawBody).digest("hex");
    expect(provider().verifyWebhookSignature(rawBody, signatureHeader)).toBeNull();
  });

  it("rejects a well-signed payload of the wrong event kind", () => {
    const { rawBody, signatureHeader } = sign({ ...validPayload, kind: "event.some_other_thing" });
    expect(provider().verifyWebhookSignature(rawBody, signatureHeader)).toBeNull();
  });

  it("rejects a well-signed payload missing required fields", () => {
    const { rawBody, signatureHeader } = sign({ kind: "event.delivery_status" });
    expect(provider().verifyWebhookSignature(rawBody, signatureHeader)).toBeNull();
  });

  it("derives a synthetic eventId when the payload has none, from delivery_id+status+timestamp", () => {
    const payloadNoId = { kind: "event.delivery_status", delivery_id: "del_2", status: "delivered", data: { updated: "2026-01-01T00:00:00.000Z" } };
    const { rawBody, signatureHeader } = sign(payloadNoId);
    const event = provider().verifyWebhookSignature(rawBody, signatureHeader);
    expect(event?.eventId).toBe("del_2:delivered:2026-01-01T00:00:00.000Z");
  });
});
