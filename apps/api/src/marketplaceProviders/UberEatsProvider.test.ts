import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createHmac } from "node:crypto";
import { UberEatsProvider, toServiceAvailability } from "./UberEatsProvider.js";
import { UBER_EATS_HOSTS, resolveUberEatsHosts } from "./uberEatsHosts.js";

/**
 * MOCKED HTTP — every Uber call here is a stubbed fetch, nothing leaves the process. These tests
 * pin the request shapes to Uber's published API reference; they are not a substitute for the
 * sandbox run in scripts/uberEatsSandboxCheck.ts, and neither is Uber's production validation.
 */
afterEach(() => {
  jest.restoreAllMocks();
});

type Reply = { status: number; body?: unknown; unreadable?: boolean };

function stubFetch(...replies: Reply[]) {
  jest.restoreAllMocks();
  const queue = [...replies];
  return jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra fetch");
    return {
      status: next.status,
      ok: next.status >= 200 && next.status < 300,
      json: async () => {
        if (next.unreadable || next.body === undefined) throw new SyntaxError("Unexpected end of JSON input");
        return next.body;
      },
    } as unknown as Response;
  });
}

const TOKEN = { status: 200, body: { access_token: "tok_1", expires_in: 2_592_000 } };

function provider(hosts = UBER_EATS_HOSTS.sandbox) {
  return new UberEatsProvider("client-id", "client-secret", hosts);
}

function call(spy: ReturnType<typeof stubFetch>, i: number) {
  const [url, init] = spy.mock.calls[i] as [string, RequestInit];
  return { url: String(url), init, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body };
}

describe("environment separation", () => {
  it("defaults to the sandbox hosts — test-api.uber.com and sandbox-login.uber.com", async () => {
    const spy = stubFetch(TOKEN, { status: 204 });
    await new UberEatsProvider("id", "secret").acceptOrder("store-1", "order-1");
    expect(call(spy, 0).url).toBe("https://sandbox-login.uber.com/oauth/v2/token");
    expect(call(spy, 1).url).toBe("https://test-api.uber.com/v1/eats/orders/order-1/accept_pos_order");
  });

  it("uses the production hosts only when explicitly given them", async () => {
    const spy = stubFetch(TOKEN, { status: 204 });
    await provider(UBER_EATS_HOSTS.production).acceptOrder("store-1", "order-1");
    expect(call(spy, 0).url).toBe("https://auth.uber.com/oauth/v2/token");
    expect(call(spy, 1).url).toBe("https://api.uber.com/v1/eats/orders/order-1/accept_pos_order");
  });

  it("refuses production hosts outside a production deployment", () => {
    expect(() => resolveUberEatsHosts("production", "development")).toThrow(/only allowed when NODE_ENV=production/);
    expect(() => resolveUberEatsHosts("production", "test")).toThrow();
    expect(resolveUberEatsHosts("production", "production")).toBe(UBER_EATS_HOSTS.production);
    expect(resolveUberEatsHosts("sandbox", "production")).toBe(UBER_EATS_HOSTS.sandbox);
  });
});

describe("OAuth (client_credentials)", () => {
  it("requests exactly eats.store + eats.order with client_credentials, form-encoded", async () => {
    const spy = stubFetch(TOKEN);
    await expect(provider().healthCheck()).resolves.toBe(true);
    const body = new URLSearchParams(call(spy, 0).init.body as URLSearchParams);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("scope")).toBe("eats.store eats.order");
    expect(body.get("client_id")).toBe("client-id");
    expect((call(spy, 0).init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("caches the token across calls (Uber limits token creation to 100/hour)", async () => {
    const spy = stubFetch(TOKEN, { status: 204 }, { status: 204 });
    const p = provider();
    await p.acceptOrder("s", "o1");
    await p.acceptOrder("s", "o2");
    expect(spy.mock.calls.filter(([url]) => String(url).endsWith("/oauth/v2/token"))).toHaveLength(1);
    expect((call(spy, 2).init.headers as Record<string, string>).Authorization).toBe("Bearer tok_1");
  });

  it("an authorization failure (bad client secret / scope not granted) reports invalid_credentials", async () => {
    stubFetch({ status: 401, body: { error: "invalid_client" } });
    await expect(provider().fetchOrder("s", "o")).rejects.toMatchObject({ code: "invalid_credentials" });
    stubFetch({ status: 400, body: { error: "invalid_scope" } });
    await expect(provider().healthCheck()).resolves.toBe(false);
  });

  it("a token-rate-limit 429 is reported as rate_limited, not as bad credentials", async () => {
    stubFetch({ status: 429, unreadable: true });
    await expect(provider().fetchOrder("s", "o")).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("a malformed token response is rejected without throwing raw parse errors", async () => {
    stubFetch({ status: 200, unreadable: true });
    await expect(provider().fetchOrder("s", "o")).rejects.toMatchObject({ code: "provider_error" });
    stubFetch({ status: 200, body: { token_type: "Bearer" } });
    await expect(provider().fetchOrder("s", "o")).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("a 401 from the API refreshes the token once, then gives up", async () => {
    const spy = stubFetch(TOKEN, { status: 401, body: {} }, { status: 200, body: { access_token: "tok_2" } }, { status: 204 });
    await provider().acceptOrder("s", "o");
    expect((call(spy, 3).init.headers as Record<string, string>).Authorization).toBe("Bearer tok_2");

    stubFetch(TOKEN, { status: 401, body: {} }, TOKEN, { status: 401, body: { message: "Unauthorized" } });
    await expect(provider().acceptOrder("s", "o")).rejects.toMatchObject({ code: "invalid_credentials" });
  });
});

describe("orders", () => {
  const ORDER = {
    id: "order-1",
    display_id: "A1B2",
    current_state: "CREATED",
    placed_at: "2026-10-25T12:00:00+05:00",
    type: "PICK_UP",
    store: { id: "store-1" },
    eater: { first_name: "Ayesha", phone: "+15555550100" },
    cart: {
      special_instructions: "No onions",
      items: [
        {
          id: "item-burger",
          instance_id: "cart-instance-1",
          title: "Burger",
          quantity: 2,
          price: { unit_price: { amount: 1250 } },
          selected_modifier_groups: [{ selected_items: [{ id: "opt-cheese", title: "Cheese", price: { unit_price: { amount: 100 } } }] }],
        },
      ],
    },
    payment: { charges: { sub_total: { amount: 2700, currency_code: "USD" }, total: { amount: 2900, currency_code: "USD" } } },
  };

  it("GET /v2/eats/order/{id} and maps the documented fields (item id, not per-cart instance_id)", async () => {
    const spy = stubFetch(TOKEN, { status: 200, body: ORDER });
    const order = await provider().fetchOrder("store-1", "order-1");
    expect(call(spy, 1).url).toBe("https://test-api.uber.com/v2/eats/order/order-1");
    expect(call(spy, 1).init.method).toBe("GET");
    expect(order.items[0]).toMatchObject({ externalItemId: "item-burger", quantity: 2, unitPriceCents: 1250 });
    expect(order.items[0]!.modifiers[0]).toMatchObject({ externalOptionId: "opt-cheese", priceCents: 100 });
    expect(order).toMatchObject({ externalOrderId: "order-1", customerNotes: "No onions", orderType: "pickup", totalCents: 2900, currency: "USD" });
  });

  it("refuses an order that belongs to a different store (tenant isolation)", async () => {
    stubFetch(TOKEN, { status: 200, body: { ...ORDER, store: { id: "someone-elses-store" } } });
    await expect(provider().fetchOrder("store-1", "order-1")).rejects.toThrow(/different store/);
  });

  it("rejects a malformed order body (no cart items / unreadable JSON)", async () => {
    stubFetch(TOKEN, { status: 200, body: { id: "order-1" } });
    await expect(provider().fetchOrder("store-1", "order-1")).rejects.toMatchObject({ code: "provider_error" });
    stubFetch(TOKEN, { status: 200, unreadable: true });
    await expect(provider().fetchOrder("store-1", "order-1")).rejects.toMatchObject({ code: "provider_error" });
  });

  it("accept: POST /v1/eats/orders/{id}/accept_pos_order with {reason}; a 204 empty body is success", async () => {
    const spy = stubFetch(TOKEN, { status: 204 });
    await expect(provider().acceptOrder("store-1", "order-1")).resolves.toBeUndefined();
    expect(call(spy, 1).init.method).toBe("POST");
    expect(typeof call(spy, 1).body.reason).toBe("string");
  });

  it("deny: POST /v1/eats/orders/{id}/deny_pos_order with a {explanation, code} reason object", async () => {
    const spy = stubFetch(TOKEN, { status: 204 });
    await provider().denyOrder("store-1", "order-1", "Item not on our menu");
    expect(call(spy, 1).url).toBe("https://test-api.uber.com/v1/eats/orders/order-1/deny_pos_order");
    expect(call(spy, 1).body).toEqual({ reason: { explanation: "Item not on our menu", code: "OTHER" } });
  });

  it("maps 404/429/5xx/timeouts to typed errors", async () => {
    stubFetch(TOKEN, { status: 404, body: { message: "order not found" } });
    await expect(provider().acceptOrder("s", "o")).rejects.toMatchObject({ code: "not_found" });
    stubFetch(TOKEN, { status: 429, body: {} });
    await expect(provider().acceptOrder("s", "o")).rejects.toMatchObject({ code: "rate_limited" });
    stubFetch(TOKEN, { status: 503, unreadable: true });
    await expect(provider().acceptOrder("s", "o")).rejects.toMatchObject({ code: "provider_error" });
    jest.restoreAllMocks();
    jest.spyOn(globalThis, "fetch").mockImplementationOnce(() => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    await expect(provider().acceptOrder("s", "o")).rejects.toMatchObject({ code: "timeout" });
  });

  it("escapes ids in paths", async () => {
    const spy = stubFetch(TOKEN, { status: 204 });
    await provider().acceptOrder("s", "../stores/x");
    expect(call(spy, 1).url).toBe("https://test-api.uber.com/v1/eats/orders/..%2Fstores%2Fx/accept_pos_order");
  });
});

describe("menu", () => {
  it("PUT /v2/eats/stores/{id}/menus with a MenuConfiguration; ids are ours so they round-trip to orders", async () => {
    const spy = stubFetch(TOKEN, { status: 204 });
    const result = await provider().pushMenu({
      externalStoreId: "store-1",
      categories: [{ internalId: "cat-1", name: "Burgers", sortOrder: 0 }],
      items: [
        { internalId: "item-1", name: "Burger", description: "Beef", priceCents: 1250, currency: "USD", isAvailable: true, categoryExternalId: "", categoryInternalId: "cat-1" },
        { internalId: "item-2", name: "Fries", priceCents: 400, currency: "USD", isAvailable: false, categoryExternalId: "", categoryInternalId: "cat-1" },
      ],
      serviceHours: [],
    });
    const { url, init, body } = call(spy, 1);
    expect(url).toBe("https://test-api.uber.com/v2/eats/stores/store-1/menus");
    expect(init.method).toBe("PUT");
    expect(body.menus[0]).toMatchObject({ title: { translations: { en_us: "Menu" } }, category_ids: ["cat-1"] });
    expect(body.menus[0].service_availability).toHaveLength(7);
    expect(body.categories[0]).toEqual({
      id: "cat-1",
      title: { translations: { en_us: "Burgers" } },
      entities: [
        { id: "item-1", type: "ITEM" },
        { id: "item-2", type: "ITEM" },
      ],
    });
    expect(body.items[0]).toMatchObject({ id: "item-1", price_info: { price: 1250 }, tax_info: {}, description: { translations: { en_us: "Beef" } } });
    expect(body.items[0].suspension_info).toBeUndefined();
    expect(body.items[1].suspension_info.suspension.suspend_until).toBeGreaterThan(Date.now() / 1000);
    expect(result.items).toEqual([
      { internalId: "item-1", externalId: "item-1" },
      { internalId: "item-2", externalId: "item-2" },
    ]);
  });

  it("item availability: POST /v2/eats/stores/{s}/menus/items/{i} with suspension_info", async () => {
    const spy = stubFetch(TOKEN, { status: 204 }, { status: 204 });
    const p = provider();
    await p.updateItemAvailability("store-1", "item-1", false);
    await p.updateItemAvailability("store-1", "item-1", true);
    expect(call(spy, 1).url).toBe("https://test-api.uber.com/v2/eats/stores/store-1/menus/items/item-1");
    expect(call(spy, 1).body.suspension_info.suspension.suspend_until).toBeGreaterThan(0);
    expect(call(spy, 2).body).toEqual({ suspension_info: { suspension: null } });
  });

  it("business hours become service_availability, splitting overnight spans at midnight", () => {
    expect(
      toServiceAvailability([
        { day: "monday", isClosed: false, open: "11:00", close: "23:00" },
        { day: "friday", isClosed: false, open: "18:00", close: "02:00" },
        { day: "sunday", isClosed: true },
      ])
    ).toEqual([
      { day_of_week: "monday", time_periods: [{ start_time: "11:00", end_time: "23:00" }] },
      { day_of_week: "friday", time_periods: [{ start_time: "18:00", end_time: "23:59" }] },
      { day_of_week: "saturday", time_periods: [{ start_time: "00:00", end_time: "02:00" }] },
    ]);
  });
});

describe("webhooks", () => {
  const signed = (payload: unknown, secret = "client-secret") => {
    const rawBody = Buffer.from(JSON.stringify(payload));
    return { rawBody, signature: createHmac("sha256", secret).update(rawBody).digest("hex") };
  };
  // Uber's documented orders.notification example (webhooks.orders-notification reference).
  const NOTIFICATION = {
    event_type: "orders.notification",
    event_id: "c4d2261e-2779-4eb6-beb0-cb41235c751e",
    event_time: 1427343990,
    meta: { resource_id: "153dd7f1-339d-4619-940c-418943c14636", status: "pos", user_id: "89dd9741-66b5-4bb4-b216-a813f3b21b4f" },
    resource_href: "https://api.uber.com/v2/eats/order/153dd7f1-339d-4619-940c-418943c14636",
  };

  it("accepts Uber's documented payload: store from meta.user_id, order from meta.resource_id", () => {
    const { rawBody, signature } = signed(NOTIFICATION);
    expect(provider().verifyWebhookSignature(rawBody, signature)).toEqual({
      eventId: NOTIFICATION.event_id,
      eventType: "orders.notification",
      externalStoreId: NOTIFICATION.meta.user_id,
      externalOrderId: NOTIFICATION.meta.resource_id,
      raw: NOTIFICATION,
    });
  });

  it("a cancellation or store event carries no order id, so it is never ingested as a new order", () => {
    for (const event_type of ["orders.cancel", "orders.failure", "store.provisioned", "store.status.changed"]) {
      const { rawBody, signature } = signed({ ...NOTIFICATION, event_type });
      expect(provider().verifyWebhookSignature(rawBody, signature)?.externalOrderId).toBeUndefined();
    }
  });

  it("rejects a wrong secret, a tampered body, a missing header and malformed payloads", () => {
    const p = provider();
    const good = signed(NOTIFICATION);
    const wrongSecret = signed(NOTIFICATION, "other-secret");
    expect(p.verifyWebhookSignature(wrongSecret.rawBody, wrongSecret.signature)).toBeNull();
    expect(p.verifyWebhookSignature(Buffer.from(JSON.stringify({ ...NOTIFICATION, event_id: "x" })), good.signature)).toBeNull();
    expect(p.verifyWebhookSignature(good.rawBody, undefined)).toBeNull();
    expect(p.verifyWebhookSignature(good.rawBody, "zz")).toBeNull();
    const noStore = signed({ ...NOTIFICATION, meta: { resource_id: "o" } });
    expect(p.verifyWebhookSignature(noStore.rawBody, noStore.signature)).toBeNull();
    const notJson = Buffer.from("not json");
    expect(p.verifyWebhookSignature(notJson, createHmac("sha256", "client-secret").update(notJson).digest("hex"))).toBeNull();
  });

  it("with a dashboard webhook signing key (BASIC_HMAC): accepts that key's signature AND the client secret's", () => {
    const p = new UberEatsProvider("client-id", "client-secret", UBER_EATS_HOSTS.sandbox, { webhookSigningKey: "dashboard-signing-key" });
    const byKey = signed(NOTIFICATION, "dashboard-signing-key");
    const bySecret = signed(NOTIFICATION, "client-secret");
    expect(p.verifyWebhookSignature(byKey.rawBody, byKey.signature)?.eventId).toBe(NOTIFICATION.event_id);
    expect(p.verifyWebhookSignature(bySecret.rawBody, bySecret.signature)?.eventId).toBe(NOTIFICATION.event_id);
  });

  it("with a signing key configured, any other key — and a tampered body — is still rejected", () => {
    const p = new UberEatsProvider("client-id", "client-secret", UBER_EATS_HOSTS.sandbox, { webhookSigningKey: "dashboard-signing-key" });
    const forged = signed(NOTIFICATION, "attacker-key");
    expect(p.verifyWebhookSignature(forged.rawBody, forged.signature)).toBeNull();
    const byKey = signed(NOTIFICATION, "dashboard-signing-key");
    expect(p.verifyWebhookSignature(Buffer.from(JSON.stringify({ ...NOTIFICATION, event_id: "other" })), byKey.signature)).toBeNull();
  });

  it("without a signing key, only the client secret verifies (an empty key is never used)", () => {
    const p = new UberEatsProvider("client-id", "client-secret", UBER_EATS_HOSTS.sandbox, { webhookSigningKey: "" });
    const emptyKey = signed(NOTIFICATION, "");
    expect(p.verifyWebhookSignature(emptyKey.rawBody, emptyKey.signature)).toBeNull();
    const bySecret = signed(NOTIFICATION, "client-secret");
    expect(p.verifyWebhookSignature(bySecret.rawBody, bySecret.signature)).not.toBeNull();
  });

  it("tolerates surrounding whitespace in the header", () => {
    const { rawBody, signature } = signed(NOTIFICATION);
    expect(provider().verifyWebhookSignature(rawBody, ` ${signature} `)).not.toBeNull();
  });

  it("accepts an uppercase-hex signature header", () => {
    const { rawBody, signature } = signed(NOTIFICATION);
    expect(provider().verifyWebhookSignature(rawBody, signature.toUpperCase())).not.toBeNull();
  });
});

describe("Integration Configuration API (pos_data)", () => {
  // Shape of the real sandbox response for the provisioned test store (2026-10-30), ids changed.
  const POS_DATA = {
    store_id: "39a899b2-e44f-4eb9-b3e2-272e92d83bea",
    pos_integration_enabled: true,
    integration_enabled: true,
    online_status: "online",
    order_release_enabled: false,
    auto_accept_enabled: false,
    order_manager_client_id: "client-id",
    merchant_store_id: "",
    webhooks_config: { schedule_order_webhooks: { is_enabled: false } },
    require_manual_acceptance: false,
  };

  it("GET /v1/eats/stores/{id}/pos_data: maps enablement, order-manager status and our integrator id", async () => {
    const spy = stubFetch(TOKEN, { status: 200, body: { ...POS_DATA, integrator_store_id: "restaurant-1" } });
    await expect(provider().getStoreIntegration(POS_DATA.store_id)).resolves.toEqual({
      storeId: POS_DATA.store_id,
      integrationEnabled: true,
      isOrderManager: true,
      orderManagerPending: false,
      integratorStoreId: "restaurant-1",
      onlineStatus: "online",
      autoAcceptEnabled: false,
      requireManualAcceptance: false,
    });
    expect(call(spy, 1).url).toBe(`https://test-api.uber.com/v1/eats/stores/${POS_DATA.store_id}/pos_data`);
    expect(call(spy, 1).init.method).toBe("GET");
  });

  it("another app (or a redacted id) as order manager means we are NOT the order manager", async () => {
    stubFetch(TOKEN, { status: 200, body: { ...POS_DATA, order_manager_client_id: "someone-else" } });
    expect((await provider().getStoreIntegration(POS_DATA.store_id)).isOrderManager).toBe(false);
    stubFetch(TOKEN, { status: 200, body: { ...POS_DATA, order_manager_client_id: "****" } });
    expect((await provider().getStoreIntegration(POS_DATA.store_id)).isOrderManager).toBe(false);
    stubFetch(TOKEN, { status: 200, body: { ...POS_DATA, order_manager_client_id: undefined } });
    expect((await provider().getStoreIntegration(POS_DATA.store_id)).isOrderManager).toBe(false);
  });

  it("falls back to pos_integration_enabled; an absent flag counts as disabled", async () => {
    stubFetch(TOKEN, { status: 200, body: { store_id: "s", pos_integration_enabled: true } });
    expect((await provider().getStoreIntegration("s")).integrationEnabled).toBe(true);
    stubFetch(TOKEN, { status: 200, body: { store_id: "s" } });
    expect((await provider().getStoreIntegration("s")).integrationEnabled).toBe(false);
  });

  it("rejects a malformed body, an unknown store (404) and refused credentials (403)", async () => {
    stubFetch(TOKEN, { status: 200, body: { integration_enabled: true } });
    await expect(provider().getStoreIntegration("s")).rejects.toMatchObject({ code: "provider_error" });
    stubFetch(TOKEN, { status: 200, unreadable: true });
    await expect(provider().getStoreIntegration("s")).rejects.toMatchObject({ code: "provider_error" });
    stubFetch(TOKEN, { status: 404, body: { code: "not_found", message: "not found" } });
    await expect(provider().getStoreIntegration("s")).rejects.toMatchObject({ code: "not_found" });
    stubFetch(TOKEN, { status: 403, body: { message: "forbidden" } });
    await expect(provider().getStoreIntegration("s")).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("PATCH /v1/eats/stores/{id}/pos_data sends only the given fields; 204 is success", async () => {
    const spy = stubFetch(TOKEN, { status: 204 }, { status: 204 });
    const p = provider();
    await expect(p.updateStoreIntegration("s", { integratorStoreId: "restaurant-1" })).resolves.toBeUndefined();
    await p.updateStoreIntegration("s", { integrationEnabled: true, storeConfigurationData: "{}" });
    expect(call(spy, 1).init.method).toBe("PATCH");
    expect(call(spy, 1).url).toBe("https://test-api.uber.com/v1/eats/stores/s/pos_data");
    expect(call(spy, 1).body).toEqual({ integrator_store_id: "restaurant-1" });
    expect(call(spy, 2).body).toEqual({ integration_enabled: true, store_configuration_data: "{}" });
  });

  it("an empty update is refused without calling Uber", async () => {
    const spy = stubFetch();
    await expect(provider().updateStoreIntegration("s", {})).rejects.toMatchObject({ code: "provider_error" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("stores", () => {
  it("GET /v1/eats/stores lists the stores provisioned to the app", async () => {
    const spy = stubFetch(TOKEN, { status: 200, body: { stores: [{ store_id: "store-1", name: "Test" }, { name: "no id" }], next_key: "" } });
    await expect(provider().listStores()).resolves.toEqual([{ storeId: "store-1", name: "Test" }]);
    expect(call(spy, 1).url).toBe("https://test-api.uber.com/v1/eats/stores");
  });
});

describe("UberEatsProvider capability declaration", () => {
  it("Phase 78 — declares connect.mechanism as oauth_redirect — the one provider with a real merchant-facing authorization_code flow", () => {
    expect(provider().capabilities.connect).toEqual({ mechanism: "oauth_redirect" });
  });
});
