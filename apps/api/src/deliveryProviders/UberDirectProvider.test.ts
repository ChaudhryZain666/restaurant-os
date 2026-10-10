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
    // Phase 89 — Uber states fees in the smallest currency unit; stored in the main unit like every other amount.
    expect(quote).toEqual({ quoteId: "quote_1", fee: 3.5, currency: "PKR", estimatedDurationMinutes: 25, raw: expect.any(Object) });
  });
});

describe("UberDirectProvider.createDelivery", () => {
  it("creates a delivery, mapping the provider status and sending Uber's idempotency_key body field", async () => {
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
      fee: 4,
      currency: "PKR",
      raw: expect.any(Object),
    });
    const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
    // Phase 89 — Uber's API documents idempotency as a body field, not a header.
    expect(JSON.parse(init.body as string).idempotency_key).toBe("delivery_create_order-1");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
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

// Phase 89 (U1/U4) — the request Uber actually receives, and how its answers are read back.
describe("UberDirectProvider Phase 89 — structured requests", () => {
  const structuredPickup: DeliveryContact = {
    ...pickup,
    addressParts: { street: ["1 Test St"], city: "Karachi", state: "Sindh", postalCode: "75500", country: "PK" },
  };
  const structuredDropoff: DeliveryContact = {
    ...dropoff,
    addressParts: { street: ["2 Customer Ave", "Flat 3"], city: "Karachi", country: "PK" },
  };
  const sentBody = (spy: ReturnType<typeof mockAuthThen>) => JSON.parse((spy.mock.calls[1] as [string, RequestInit])[1].body as string);

  it("quotes with a structured address, exact coordinates and both phone numbers", async () => {
    const spy = mockAuthThen(200, { id: "quote_2", fee: 1299, currency: "usd" });
    const quote = await provider().getQuote({ pickup: structuredPickup, dropoff: structuredDropoff, currency: "USD" });
    const body = sentBody(spy);
    expect(JSON.parse(body.pickup_address)).toEqual({ street_address: ["1 Test St"], city: "Karachi", state: "Sindh", zip_code: "75500", country: "PK" });
    expect(JSON.parse(body.dropoff_address)).toEqual({ street_address: ["2 Customer Ave", "Flat 3"], city: "Karachi", country: "PK" });
    expect(body).toMatchObject({
      pickup_latitude: 24.86,
      pickup_longitude: 67.0,
      dropoff_latitude: 24.87,
      dropoff_longitude: 67.01,
      pickup_phone_number: "+920000000000",
      dropoff_phone_number: "+920000000001",
    });
    expect(quote).toMatchObject({ quoteId: "quote_2", fee: 12.99, currency: "USD" });
  });

  it("books against the quote it was given, with the same structured address and coordinates", async () => {
    const spy = mockAuthThen(200, { id: "del_2", status: "pending", fee: 1299, currency: "USD" });
    await provider().createDelivery({
      orderId: "order-2",
      restaurantId: "rest-1",
      quoteId: "quote_2",
      pickup: structuredPickup,
      dropoff: structuredDropoff,
      manifestItems: [{ name: "Burger", quantity: 1 }],
      idempotencyKey: "delivery_create_order-2",
    });
    const body = sentBody(spy);
    expect(body.quote_id).toBe("quote_2");
    expect(JSON.parse(body.dropoff_address).street_address).toEqual(["2 Customer Ave", "Flat 3"]);
    expect(body.dropoff_latitude).toBe(24.87);
    expect(body.external_id).toBe("order-2");
  });

  it("falls back to the one-line address only when no structured parts are known", async () => {
    const spy = mockAuthThen(200, { id: "quote_3", fee: 500, currency: "USD" });
    await provider().getQuote({ pickup, dropoff, currency: "USD" });
    expect(JSON.parse(sentBody(spy).pickup_address)).toEqual({ street_address: ["1 Test St"] });
  });

  it("does not divide fees in a currency with no minor unit", async () => {
    mockAuthThen(200, { id: "quote_4", fee: 800, currency: "JPY" });
    expect((await provider().getQuote({ pickup, dropoff, currency: "JPY" })).fee).toBe(800);
  });

  it("an address Uber does not serve is reported as outside the service area, not a malformed address", async () => {
    mockAuthThen(400, { code: "address_undeliverable", message: "The specified location is not in a deliverable area." });
    await expect(provider().getQuote({ pickup, dropoff, currency: "USD" })).rejects.toMatchObject({ code: "outside_service_area" });
    mockAuthThen(422, { code: "invalid_params", message: "dropoff_address is invalid" });
    await expect(provider().getQuote({ pickup, dropoff, currency: "USD" })).rejects.toMatchObject({ code: "invalid_address" });
  });

  it("with no webhook signing secret, rejects every webhook — even one signed with an empty key", () => {
    const unsecured = new UberDirectProvider("client-id", "client-secret", "customer-id", "");
    const rawBody = Buffer.from(JSON.stringify({ id: "evt_1", kind: "event.delivery_status", delivery_id: "del_1", status: "pickup" }));
    expect(unsecured.hasWebhookSigningSecret).toBe(false);
    expect(unsecured.verifyWebhookSignature(rawBody, createHmac("sha256", "").update(rawBody).digest("hex"))).toBeNull();
  });
});

// Phase 89 — checked against the OpenAPI types in Uber's official SDK (uber/uber-direct-sdk).
describe("UberDirectProvider Phase 89 — matches Uber's documented API", () => {
  it("cancels with no request body (Uber's cancel endpoint takes none)", async () => {
    const spy = mockAuthThen(200, { id: "del_1", status: "canceled" });
    await provider().cancelDelivery("del_1", "customer changed their mind");
    const [url, init] = spy.mock.calls[1] as [string, RequestInit];
    expect(url.endsWith("/deliveries/del_1/cancel")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it.each([
    [400, "invalid_params", "invalid_address", /rejected the delivery details/],
    [401, "unauthorized", "invalid_credentials", /rejected these credentials/],
    [402, "customer_suspended", "invalid_credentials", /suspended/],
    [403, "customer_blocked", "invalid_credentials", /blocked/],
    [404, "customer_not_found", "invalid_credentials", /doesn't recognize this Customer ID/],
    [404, "delivery_not_found", "not_found", /Uber Direct:/],
    [408, "request_timeout", "timeout", /timed out/],
    [409, "duplicate_delivery", "provider_error", /already requested \(duplicate_delivery\)/],
    [429, "customer_limited", "rate_limited", /rate limit/],
    [503, "couriers_busy", "provider_unavailable", /No Uber couriers are available/],
    [500, "internal_server_error", "provider_error", /Uber Direct error/],
  ])("maps HTTP %i %s to %s with an actionable message", async (status, code, expectedCode, message) => {
    mockAuthThen(status, { code, message: "detail from Uber" });
    await expect(provider().getQuote({ pickup, dropoff, currency: "USD" })).rejects.toMatchObject({
      code: expectedCode,
      message: expect.stringMatching(message),
    });
  });
});

describe("UberDirectProvider test-mode robo courier (sandbox check only)", () => {
  const input = { orderId: "o-robo", restaurantId: "r1", pickup, dropoff, manifestItems: [{ name: "Item", quantity: 1 }], idempotencyKey: "k-robo" };

  it("is never requested by default — production deliveries don't send test_specifications", async () => {
    const spy = mockAuthThen(200, { id: "del_r", status: "pending" });
    await provider().createDelivery(input);
    const [, init] = spy.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string).test_specifications).toBeUndefined();
  });

  it("asks for Uber's robo courier only when the test option is set", async () => {
    const spy = mockAuthThen(200, { id: "del_r", status: "pending" });
    await new UberDirectProvider("client-id", "client-secret", "customer-id", "", { testRoboCourier: true }).createDelivery(input);
    const [, init] = spy.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string).test_specifications).toEqual({ robo_courier_specification: { mode: "auto" } });
  });
});
