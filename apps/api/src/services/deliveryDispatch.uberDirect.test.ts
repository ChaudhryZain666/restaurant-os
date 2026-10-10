import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Delivery } from "../models/Delivery.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantDeliveryProviderAccount } from "../models/RestaurantDeliveryProviderAccount.js";
import { User } from "../models/User.js";
import { encryptCredentials } from "../utils/credentialEncryption.js";
import request from "supertest";
import { createApp } from "../app.js";
import { AuditLog } from "../models/AuditLog.js";
import { createDeliveryForOrder, retryDeliveryCreation, switchDeliveryToManual } from "./deliveryDispatch.service.js";
import { courierDispatchIneligibility } from "./courierDispatchEligibility.js";
import { applyOrderStatusTransition } from "./orderTransition.service.js";
import { notificationQueue } from "../queues/notification.queue.js";
import { createOrderForCustomer } from "./orderCreation.service.js";
import {
  closeTestConnections,
  createTestCategory,
  createTestMenuItem,
  createTestOrder,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

/**
 * Phase 89 (U1/U4) — dispatching a "ready" delivery order through a connected Uber Direct account.
 * Uber's API is simulated with a stubbed fetch (auth → quote → create): nothing leaves this
 * machine and no courier is ever booked.
 */
const restaurantIds: string[] = [];
const userIds: string[] = [];

beforeAll(async () => {
  await connectDB();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([
    Delivery.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Order.deleteMany({ restaurantId: { $in: restaurantIds } }),
    RestaurantDeliveryProviderAccount.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

const respond = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;
const AUTH = respond(200, { access_token: "test-token", expires_in: 2_592_000 });

interface UberSetup {
  restaurantPhone?: string | null;
  customerPhone?: string | null;
  restaurantCountry?: string | null;
  /** false = connected, signing secret not added yet. */
  webhookSecretConfigured?: boolean;
  orderPhone?: string;
  orderCountry?: string;
}

async function uberRestaurant(options: UberSetup = {}) {
  const restaurant = await createTestRestaurant({
    latitude: 40.7128,
    longitude: -74.006,
    address: "1 Test Street",
    city: "New York",
    state: "NY",
    postalCode: "10007",
    ...(options.restaurantCountry === null ? {} : { country: options.restaurantCountry ?? "US" }),
    ...(options.restaurantPhone === null ? {} : { phone: options.restaurantPhone ?? "+12125550100" }),
  });
  restaurantIds.push(restaurant.id);
  await Restaurant.updateOne(
    { _id: restaurant._id },
    { $set: { "settings.deliveryProvider": "uber_direct", "settings.currency": "USD", "settings.deliveryRadiusKm": 20 } }
  );
  const customer = await createTestUser("customer", undefined, options.customerPhone === null ? {} : { phone: options.customerPhone ?? "+12125550199" });
  userIds.push(customer.id as string);
  const secretConfigured = options.webhookSecretConfigured ?? true;
  await RestaurantDeliveryProviderAccount.create({
    restaurantId: restaurant._id,
    businessId: new mongoose.Types.ObjectId(),
    provider: "uber_direct",
    status: "active",
    encryptedCredentials: encryptCredentials({
      clientId: "client_x",
      clientSecret: "secret_x",
      customerId: "cus_x",
      ...(secretConfigured ? { webhookSigningSecret: "whsec_x" } : {}),
    }),
    webhookSecretConfigured: secretConfigured,
    connectedByUserId: customer._id,
  });
  return { restaurant: (await Restaurant.findById(restaurant._id))!, customer };
}

async function uberReadyOrder(options: UberSetup = {}) {
  const { restaurant, customer } = await uberRestaurant(options);
  const order = await createTestOrder(restaurant._id, customer._id, {
    orderType: "delivery",
    status: "ready",
    currency: "USD",
    deliveryFee: 5,
    deliveryAddress: {
      line1: "42 Customer Lane",
      line2: "Apt 5",
      city: "New York",
      state: "NY",
      postalCode: "10002",
      latitude: 40.715,
      longitude: -73.99,
      ...(options.orderPhone ? { phone: options.orderPhone } : {}),
      ...(options.orderCountry ? { country: options.orderCountry } : {}),
    },
  });
  return { restaurant, order, customer };
}

const bodyOf = (spy: ReturnType<typeof jest.spyOn>, call: number) => JSON.parse(((spy.mock.calls[call] as [string, RequestInit])[1].body as string) ?? "{}");

describe("Uber Direct dispatch — quote, then book against that quote", () => {
  it("quotes first, books with the quote id and structured addresses, and flags a courier fee above what the customer paid", async () => {
    const { restaurant, order } = await uberReadyOrder();
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(AUTH)
      .mockResolvedValueOnce(respond(200, { id: "dqt_1", fee: 1299, currency: "usd", duration: 30 }))
      .mockResolvedValueOnce(respond(200, { id: "del_1", status: "pending", tracking_url: "https://track.example/del_1", fee: 1299, currency: "USD" }));

    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);

    const [quoteUrl] = fetchSpy.mock.calls[1] as [string];
    const [createUrl] = fetchSpy.mock.calls[2] as [string]; // one OAuth token serves both calls
    expect(quoteUrl).toMatch(/\/delivery_quotes$/);
    expect(createUrl).toMatch(/\/deliveries$/);
    const quoteBody = bodyOf(fetchSpy, 1);
    expect(JSON.parse(quoteBody.dropoff_address)).toEqual({ street_address: ["42 Customer Lane", "Apt 5"], city: "New York", state: "NY", zip_code: "10002", country: "US" });
    expect(JSON.parse(quoteBody.pickup_address)).toEqual({ street_address: ["1 Test Street"], city: "New York", state: "NY", zip_code: "10007", country: "US" });
    expect(quoteBody).toMatchObject({ pickup_latitude: 40.7128, dropoff_longitude: -73.99, pickup_phone_number: "+12125550100", dropoff_phone_number: "+12125550199" });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(bodyOf(fetchSpy, 2).quote_id).toBe("dqt_1");

    expect(delivery.provider).toBe("uber_direct");
    expect(delivery.status).toBe("requested");
    expect(delivery.quoteId).toBe("dqt_1");
    expect(delivery.providerDeliveryId).toBe("del_1");
    expect(delivery.fee).toBe(12.99);
    expect(delivery.statusHistory.map((h) => h.note).join(" ")).toMatch(/Courier fee 12\.99 USD is more than the 5\.00 delivery fee/);
  });

  it("an address Uber doesn't serve fails before any courier is booked, with a reason staff can act on", async () => {
    const { restaurant, order } = await uberReadyOrder();
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(AUTH)
      .mockResolvedValueOnce(respond(400, { code: "address_undeliverable", message: "The specified location is not in a deliverable area." }));

    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // auth + quote — never POST /deliveries
    expect(delivery.status).toBe("failed");
    expect(delivery.providerDeliveryId).toBeUndefined();
    expect(delivery.failureReason).toMatch(/does not deliver between these addresses/);
  });

  it("refuses to book without the customer's phone number, without calling Uber at all", async () => {
    const { restaurant, order } = await uberReadyOrder({ customerPhone: null });
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(delivery.status).toBe("failed");
    expect(delivery.failureReason).toMatch(/customer's phone number/);
  });

  it("refuses to book without the restaurant's phone number", async () => {
    const { restaurant, order } = await uberReadyOrder({ restaurantPhone: null });
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(delivery.failureReason).toMatch(/restaurant's phone number/);
  });
});

// Phase 89 follow-up — normalization at dispatch, the signing-secret gate, the per-order manual
// fallback, and the checkout phone requirement.
describe("Uber Direct dispatch — normalized contact details", () => {
  it("sends ISO country codes and E.164 phones built from the stored free text", async () => {
    const { restaurant, order } = await uberReadyOrder({ restaurantCountry: "United States", restaurantPhone: "(212) 555-0100", orderPhone: "212 555 0177" });
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(AUTH)
      .mockResolvedValueOnce(respond(200, { id: "dqt_n", fee: 400, currency: "USD" }))
      .mockResolvedValueOnce(respond(200, { id: "del_n", status: "pending", fee: 400, currency: "USD" }));

    await createDeliveryForOrder(order.id as string, restaurant.id as string);
    const quote = bodyOf(fetchSpy, 1);
    expect(JSON.parse(quote.pickup_address).country).toBe("US");
    expect(JSON.parse(quote.dropoff_address).country).toBe("US");
    expect(quote.pickup_phone_number).toBe("+12125550100");
    // The number given for this delivery wins over the one on the customer's account.
    expect(quote.dropoff_phone_number).toBe("+12125550177");
  });

  it("refuses an unrecognized restaurant country without calling Uber, saying where to fix it", async () => {
    const { restaurant, order } = await uberReadyOrder({ restaurantCountry: "Narnia" });
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(delivery.status).toBe("failed");
    expect(delivery.failureReason).toMatch(/country \("Narnia"\) isn't recognized — set it in Settings → Location details/);
  });

  it("refuses a customer number it would have to guess a country code for", async () => {
    const { restaurant, order } = await uberReadyOrder({ restaurantCountry: "PK", customerPhone: "0300 1234567", restaurantPhone: "+92 21 1234567" });
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(delivery.failureReason).toMatch(/customer's phone number can't be given to a courier: .*international format/);
  });
});

describe("Uber Direct dispatch — signing secret gate", () => {
  it("books no courier while the webhook signing secret is missing: own-staff dispatch with the reason noted", async () => {
    const { restaurant, order } = await uberReadyOrder({ webhookSecretConfigured: false });
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(delivery.provider).toBe("manual");
    expect(delivery.statusHistory.map((h) => h.note).join(" ")).toMatch(/webhook signing secret hasn't been added yet/);
  });
});

describe("Per-order manual dispatch fallback", () => {
  async function failedUberDelivery() {
    const ctx = await uberReadyOrder({ customerPhone: null });
    const delivery = await createDeliveryForOrder(ctx.order.id as string, ctx.restaurant.id as string);
    expect(delivery.status).toBe("failed");
    return { ...ctx, delivery };
  }

  it("switches a failed courier booking to own staff, audited, without touching the restaurant-wide setting", async () => {
    const { restaurant, order, delivery } = await failedUberDelivery();
    const staff = await createTestUser("restaurant_staff", restaurant._id);
    userIds.push(staff.id as string);

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders/${order.id}/delivery/dispatch-manually`)
      .set("Authorization", `Bearer ${tokenFor(staff)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.delivery).toMatchObject({ provider: "manual", status: "accepted" });

    const stored = await Delivery.findById(delivery._id);
    expect(stored!.providerDeliveryId).toMatch(/^manual_/);
    expect(stored!.failureReason).toBeUndefined();
    expect(stored!.statusHistory.at(-1)!.note).toMatch(/Switched to manual dispatch by staff \(was uber_direct\)/);
    expect((await Restaurant.findById(restaurant._id))!.settings.deliveryProvider).toBe("uber_direct");
    const audit = await AuditLog.findOne({ restaurantId: restaurant._id, action: "delivery.switched_to_manual" });
    expect(audit).toMatchObject({ targetType: "delivery", metadata: { from: "uber_direct", to: "manual" } });
    expect(audit!.actorUserId.toString()).toBe(staff.id);
  });

  it("refuses when a courier was already booked, when the delivery hasn't failed, or when it is already own-staff", async () => {
    const { restaurant, delivery } = await failedUberDelivery();
    const actor = { userId: new mongoose.Types.ObjectId().toString(), role: "restaurant_owner" as const };

    await Delivery.updateOne({ _id: delivery._id }, { $set: { providerDeliveryId: "del_booked" } });
    await expect(switchDeliveryToManual(delivery.id as string, restaurant.id as string, actor)).rejects.toMatchObject({ statusCode: 409 });

    await Delivery.updateOne({ _id: delivery._id }, { $unset: { providerDeliveryId: "" }, $set: { status: "requested" } });
    await expect(switchDeliveryToManual(delivery.id as string, restaurant.id as string, actor)).rejects.toMatchObject({ statusCode: 409 });

    await Delivery.updateOne({ _id: delivery._id }, { $set: { status: "failed", provider: "manual" } });
    await expect(switchDeliveryToManual(delivery.id as string, restaurant.id as string, actor)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("Checkout phone requirement — only when a third-party courier will deliver", () => {
  async function itemFor(restaurantId: mongoose.Types.ObjectId) {
    const category = await createTestCategory(restaurantId);
    return createTestMenuItem(restaurantId, category._id, { price: 20 });
  }
  const address = { line1: "42 Customer Lane", city: "New York", state: "NY", latitude: 40.715, longitude: -73.99 };

  async function order(restaurant: { id?: string; _id: mongoose.Types.ObjectId }, customerId: string, phone?: string, channel: "online" | "pos" = "online") {
    const item = await itemFor(restaurant._id);
    return createOrderForCustomer({
      restaurantId: restaurant._id.toString(),
      customerId,
      channel,
      items: [{ menuItemId: item.id as string, quantity: 1, selectedModifiers: [] }],
      orderType: "delivery",
      paymentMethod: "cash",
      deliveryAddress: { ...address, ...(phone ? { phone } : {}) },
    });
  }

  it("requires a usable number when Uber Direct will deliver, with an actionable message", async () => {
    const { restaurant, customer } = await uberRestaurant({ customerPhone: null });
    await expect(order(restaurant, customer.id as string)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/phone number is needed for courier delivery.*international format/),
    });
    await expect(order(restaurant, customer.id as string, "0300 1234567")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("stores the number normalized; falls back to the account's number when none is given", async () => {
    const { restaurant, customer } = await uberRestaurant({ customerPhone: "+1 (212) 555-0199" });
    const given = await order(restaurant, customer.id as string, "(212) 555-0177");
    expect((await Order.findById(given.id))!.deliveryAddress!.phone).toBe("+12125550177");
    const fromAccount = await order(restaurant, customer.id as string);
    expect((await Order.findById(fromAccount.id))!.deliveryAddress!.phone).toBe("+12125550199");
  });

  it("applies to POS delivery orders too", async () => {
    const { restaurant, customer } = await uberRestaurant({ customerPhone: null });
    await expect(order(restaurant, customer.id as string, undefined, "pos")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("is not required when the restaurant delivers itself, or while Uber Direct has no signing secret", async () => {
    const own = await uberRestaurant({ customerPhone: null });
    await Restaurant.updateOne({ _id: own.restaurant._id }, { $set: { "settings.deliveryProvider": "manual" } });
    await expect(order(own.restaurant, own.customer.id as string)).resolves.toMatchObject({ id: expect.any(String) });

    const noSecret = await uberRestaurant({ customerPhone: null, webhookSecretConfigured: false });
    await expect(order(noSecret.restaurant, noSecret.customer.id as string)).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("tells the storefront whether to ask for it", async () => {
    const { restaurant } = await uberRestaurant();
    const res = await request(app).get(`/api/v1/restaurants/by-slug/${restaurant.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.courierPhoneRequired).toBe(true);
  });
});

// Phase 89 commit gate — marketplace orders can never trigger a courier booking; direct ones still do.
describe("Courier dispatch eligibility — marketplace orders are never dispatched", () => {
  it("the rule itself: only direct delivery orders are eligible", () => {
    expect(courierDispatchIneligibility({ orderType: "delivery", channel: "online" })).toBeNull();
    expect(courierDispatchIneligibility({ orderType: "delivery", channel: "pos" })).toBeNull();
    expect(courierDispatchIneligibility({ orderType: "delivery", channel: "marketplace" })).toMatch(/marketplace's own couriers/);
    expect(courierDispatchIneligibility({ orderType: "pickup", channel: "marketplace" })).toMatch(/marketplace's own couriers/);
    expect(courierDispatchIneligibility({ orderType: "pickup", channel: "online" })).toMatch(/Only delivery orders/);
  });

  // Ingestion maps every marketplace order to "pickup"; these force orderType "delivery" to prove
  // the server-side guard holds even if that mapping ever changed.
  async function marketplaceDeliveryOrder(status: "ready" | "preparing") {
    const { restaurant, customer } = await uberRestaurant();
    const order = await createTestOrder(restaurant._id, customer._id, {
      orderType: "delivery",
      channel: "marketplace",
      status,
      currency: "USD",
      deliveryAddress: { line1: "42 Customer Lane", city: "New York", latitude: 40.715, longitude: -73.99, phone: "+12125550177" },
    });
    return { restaurant, order };
  }

  it("createDeliveryForOrder refuses a marketplace order without calling Uber or creating a delivery", async () => {
    const { restaurant, order } = await marketplaceDeliveryOrder("ready");
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    await expect(createDeliveryForOrder(order.id as string, restaurant.id as string)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/marketplace's own couriers/),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await Delivery.countDocuments({ orderId: order._id })).toBe(0);
  });

  it("the staff Retry can't dispatch a marketplace order either", async () => {
    const { restaurant, order } = await marketplaceDeliveryOrder("ready");
    const stray = await Delivery.create({
      restaurantId: restaurant._id,
      orderId: order._id,
      orderNumber: order.orderNumber,
      provider: "uber_direct",
      status: "failed",
      idempotencyKey: `delivery_create_${order.id}`,
    });
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    await expect(retryDeliveryCreation(stray.id as string, restaurant.id as string)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await Delivery.findById(stray._id))!.status).toBe("failed");
  });

  it("marking a marketplace order ready enqueues no dispatch; marking a direct delivery order ready still does", async () => {
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);
    const dispatchJobs = () => addSpy.mock.calls.filter(([name]) => name === "delivery.dispatch_create");

    const marketplace = await marketplaceDeliveryOrder("preparing");
    await applyOrderStatusTransition({ orderId: marketplace.order.id as string, restaurantId: marketplace.restaurant.id as string, nextStatus: "ready" });
    expect(dispatchJobs()).toHaveLength(0);

    const { restaurant, customer } = await uberRestaurant();
    const direct = await createTestOrder(restaurant._id, customer._id, {
      orderType: "delivery",
      channel: "online",
      status: "preparing",
      currency: "USD",
      deliveryAddress: { line1: "42 Customer Lane", city: "New York", latitude: 40.715, longitude: -73.99, phone: "+12125550177" },
    });
    await applyOrderStatusTransition({ orderId: direct.id as string, restaurantId: restaurant.id as string, nextStatus: "ready" });
    expect(dispatchJobs()).toHaveLength(1);
    expect(dispatchJobs()[0][1]).toMatchObject({ orderId: direct.id });
  });

  it("a direct Uber Direct delivery order is still booked end to end (quote, then booking)", async () => {
    const { restaurant, order } = await uberReadyOrder();
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(AUTH)
      .mockResolvedValueOnce(respond(200, { id: "dqt_direct", fee: 400, currency: "USD" }))
      .mockResolvedValueOnce(respond(200, { id: "del_direct", status: "pending", fee: 400, currency: "USD" }));
    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(delivery).toMatchObject({ provider: "uber_direct", providerDeliveryId: "del_direct", quoteId: "dqt_direct" });
  });
});
