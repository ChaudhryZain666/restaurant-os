import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { Order } from "../models/Order.js";
import { Promotion } from "../models/Promotion.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { Payment } from "../models/Payment.js";
import { LoyaltyAccount, LoyaltyTransaction } from "../models/LoyaltyAccount.js";
import { Counter } from "../models/Counter.js";
import {
  closeTestConnections,
  createTestCategory,
  createTestMenuItem,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

// Real Springfield, IL coordinates (matches demo data) — an arbitrary but stable reference point.
const RESTAURANT_LAT = 39.7817;
const RESTAURANT_LNG = -89.6501;
// ~1.8km away — inside an 8km radius.
const NEARBY_LAT = 39.7658;
const NEARBY_LNG = -89.6501;
// Austin, TX — far outside any sane delivery radius from Springfield, IL.
const FAR_LAT = 30.2672;
const FAR_LNG = -97.7431;

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let categoryA: Awaited<ReturnType<typeof createTestCategory>>;
let menuItemA: Awaited<ReturnType<typeof createTestMenuItem>>;
let ownerAToken: string;
let customerToken: string;
let customerId: string;

beforeAll(async () => {
  await connectDB();

  restaurantA = await createTestRestaurant({
    latitude: RESTAURANT_LAT,
    longitude: RESTAURANT_LNG,
    settings: {
      orderingEnabled: true,
      pickupEnabled: true,
      deliveryEnabled: true,
      cashEnabled: true,
      onlinePaymentEnabled: true,
      minOrderAmount: 0,
      taxRate: 0.1,
      deliveryFee: 3.99,
      deliveryRadiusKm: 8,
    },
  });
  restaurantB = await createTestRestaurant({
    latitude: RESTAURANT_LAT,
    longitude: RESTAURANT_LNG,
    settings: {
      orderingEnabled: true,
      pickupEnabled: true,
      deliveryEnabled: true,
      minOrderAmount: 0,
      taxRate: 0.1,
      deliveryFee: 999, // deliberately different from A's fee, to prove B's config never leaks into A's checks
      deliveryRadiusKm: 1,
    },
  });
  categoryA = await createTestCategory(restaurantA._id);
  menuItemA = await createTestMenuItem(restaurantA._id, categoryA._id, { price: 20 });

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const customer = await createTestUser("customer");
  ownerAToken = tokenFor(ownerA);
  customerToken = tokenFor(customer);
  customerId = customer.id;
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    Payment.deleteMany({ restaurantId: { $in: ids } }),
    Order.deleteMany({ restaurantId: { $in: ids } }),
    Promotion.deleteMany({ restaurantId: { $in: ids } }),
    MenuItem.deleteMany({ restaurantId: { $in: ids } }),
    Category.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteMany({ restaurantId: { $in: ids } }),
    LoyaltyAccount.deleteMany({ restaurantId: { $in: ids } }),
    LoyaltyTransaction.deleteMany({ restaurantId: { $in: ids } }),
    Counter.deleteMany({ _id: { $in: ids } }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await User.deleteOne({ _id: customerId });
  await closeTestConnections();
});

function deliveryAddress(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    line1: "123 Main St",
    city: "Springfield",
    state: "IL",
    postalCode: "62701",
    latitude: NEARBY_LAT,
    longitude: NEARBY_LNG,
    ...overrides,
  };
}

function orderBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    orderType: "delivery",
    items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [] }],
    deliveryAddress: deliveryAddress(),
    ...overrides,
  };
}

describe("POST /restaurants/:id/delivery/check", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/delivery/check`)
      .send({ latitude: NEARBY_LAT, longitude: NEARBY_LNG });
    expect(res.status).toBe(401);
  });

  it("reports eligible:true with distance and fee for a nearby address", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/delivery/check`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ latitude: NEARBY_LAT, longitude: NEARBY_LNG });

    expect(res.status).toBe(200);
    expect(res.body.data.eligible).toBe(true);
    expect(res.body.data.deliveryFee).toBe(3.99);
    expect(res.body.data.distanceKm).toBeGreaterThan(0);
    expect(res.body.data.distanceKm).toBeLessThan(8);
  });

  it("reports eligible:false with a reason for an address outside the radius", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/delivery/check`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ latitude: FAR_LAT, longitude: FAR_LNG });

    expect(res.status).toBe(200);
    expect(res.body.data.eligible).toBe(false);
    expect(res.body.data.reason).toBeTruthy();
    expect(res.body.data.deliveryFee).toBeUndefined();
  });

  it("rejects out-of-range latitude/longitude", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/delivery/check`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ latitude: 999, longitude: NEARBY_LNG });
    expect(res.status).toBe(400);
  });

  it("404s for a restaurant that doesn't exist", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/6a0000000000000000000000/delivery/check`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ latitude: NEARBY_LAT, longitude: NEARBY_LNG });
    expect(res.status).toBe(404);
  });

  it("uses restaurant B's own (much smaller) radius and fee — a check against A never leaks B's config or vice versa", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantB.id}/delivery/check`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ latitude: NEARBY_LAT, longitude: NEARBY_LNG }); // ~1.8km away, outside B's 1km radius

    expect(res.status).toBe(200);
    expect(res.body.data.eligible).toBe(false);
    expect(res.body.data.deliveryFee).not.toBe(999);
  });
});

describe("delivery order creation — server-side eligibility (Phase 9)", () => {
  it("creates a delivery order for an address within range, snapshotting address/distance and using the server-computed fee", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderBody());

    expect(res.status).toBe(201);
    const order = res.body.data.order;
    expect(order.deliveryFee).toBe(3.99);
    expect(order.deliveryDistanceKm).toBeGreaterThan(0);
    expect(order.deliveryDistanceKm).toBeLessThan(8);
    expect(order.deliveryAddress.line1).toBe("123 Main St");
    expect(order.deliveryAddress.latitude).toBe(NEARBY_LAT);
    // subtotal 20, tax 10% => 2, delivery fee 3.99 => total 25.99
    expect(order.total).toBeCloseTo(25.99, 2);
  });

  it("rejects a delivery order for an address outside the restaurant's radius", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderBody({ deliveryAddress: deliveryAddress({ latitude: FAR_LAT, longitude: FAR_LNG }) }));

    expect(res.status).toBe(400);
    const stored = await Order.find({ restaurantId: restaurantA._id, "deliveryAddress.latitude": FAR_LAT });
    expect(stored).toHaveLength(0);
  });

  it("rejects a delivery order when the restaurant hasn't enabled delivery, even with valid coordinates", async () => {
    const noDelivery = await createTestRestaurant({
      latitude: RESTAURANT_LAT,
      longitude: RESTAURANT_LNG,
      settings: { orderingEnabled: true, pickupEnabled: true, deliveryEnabled: false, minOrderAmount: 0, taxRate: 0.1, deliveryFee: 3, deliveryRadiusKm: 8 },
    });
    const cat = await createTestCategory(noDelivery._id);
    const item = await createTestMenuItem(noDelivery._id, cat._id, { price: 10 });

    const res = await request(app)
      .post(`/api/v1/restaurants/${noDelivery.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "delivery",
        items: [{ menuItemId: item.id, quantity: 1, selectedModifiers: [] }],
        deliveryAddress: deliveryAddress(),
      });

    expect(res.status).toBe(400);
    await Promise.all([
      MenuItem.deleteOne({ _id: item._id }),
      Category.deleteOne({ _id: cat._id }),
      Restaurant.deleteOne({ _id: noDelivery._id }),
    ]);
  });

  it("rejects a delivery order when the restaurant has no coordinates configured yet", async () => {
    const noCoords = await createTestRestaurant({
      settings: { orderingEnabled: true, pickupEnabled: true, deliveryEnabled: true, minOrderAmount: 0, taxRate: 0.1, deliveryFee: 3, deliveryRadiusKm: 8 },
    });
    const cat = await createTestCategory(noCoords._id);
    const item = await createTestMenuItem(noCoords._id, cat._id, { price: 10 });

    const res = await request(app)
      .post(`/api/v1/restaurants/${noCoords.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "delivery",
        items: [{ menuItemId: item.id, quantity: 1, selectedModifiers: [] }],
        deliveryAddress: deliveryAddress(),
      });

    expect(res.status).toBe(400);
    await Promise.all([
      MenuItem.deleteOne({ _id: item._id }),
      Category.deleteOne({ _id: cat._id }),
      Restaurant.deleteOne({ _id: noCoords._id }),
    ]);
  });

  it("rejects a delivery address missing latitude/longitude entirely", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "delivery",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [] }],
        deliveryAddress: { line1: "123 Main St", city: "Springfield" },
      });
    expect(res.status).toBe(400);
  });

  it("ignores a client-supplied deliveryFee — only the server-computed fee is ever applied", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ ...orderBody(), deliveryFee: 0.01 });

    expect(res.status).toBe(201);
    expect(res.body.data.order.deliveryFee).toBe(3.99);
  });

  it("ignores a client-supplied deliveryDistanceKm — only the server-computed distance is ever stored", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ ...orderBody(), deliveryDistanceKm: 0 });

    expect(res.status).toBe(201);
    expect(res.body.data.order.deliveryDistanceKm).toBeGreaterThan(0);
  });

  it("cannot use restaurant A's URL together with an address only in range of restaurant B's tighter radius to bypass A's real distance", async () => {
    // Address is ~1.8km from both A and B's shared reference point, which is within A's 8km
    // radius but outside B's 1km radius — placing against A must use A's own radius, not B's.
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderBody());

    expect(res.status).toBe(201);
    expect(res.body.data.order.deliveryFee).toBe(3.99); // A's fee, never B's 999
  });

  it("does not require or charge a delivery fee for pickup orders (regression)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ orderType: "pickup", items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [] }] });

    expect(res.status).toBe(201);
    expect(res.body.data.order.deliveryFee).toBe(0);
    expect(res.body.data.order.deliveryAddress).toBeUndefined();
  });

  it("applies a promo code's discount before the delivery fee (subtotal - discount, then + tax + delivery fee)", async () => {
    const create = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/promotions`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ code: `DEL${Date.now().toString(36).toUpperCase()}`, name: "5 off", type: "fixed", value: 5 });
    const promoCode = create.body.data.promotion.code;

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ ...orderBody(), promoCode });

    expect(res.status).toBe(201);
    // subtotal 20, promo -5 => taxable 15, tax 10% => 1.5, + delivery fee 3.99 => total 20.49
    expect(res.body.data.order.promoDiscount).toBe(5);
    expect(res.body.data.order.total).toBeCloseTo(20.49, 2);
  });

  it("a promo code from a different restaurant cannot be combined with a delivery order here", async () => {
    const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
    const create = await request(app)
      .post(`/api/v1/restaurants/${restaurantB.id}/promotions`)
      .set("Authorization", `Bearer ${tokenFor(ownerB)}`)
      .send({ code: `XT${Date.now().toString(36).toUpperCase()}`, name: "B only", type: "fixed", value: 5 });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ ...orderBody(), promoCode: create.body.data.promotion.code });

    expect(res.status).toBe(400);
  });

  it("the payment amount for an online delivery order includes the delivery fee, matching the order total exactly", async () => {
    const createRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ ...orderBody(), paymentMethod: "online" });
    expect(createRes.status).toBe(201);
    const order = createRes.body.data.order;
    expect(order.total).toBeCloseTo(25.99, 2);

    const paymentRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: `key-delivery-${order.id}`, amount: 0.01 }); // not a real field — ignored

    expect(paymentRes.status).toBe(201);
    expect(paymentRes.body.data.payment.amount).toBe(order.total);
  });
});

describe("cross-tenant delivery configuration manipulation (Phase 8/9 tenant isolation)", () => {
  it("restaurant B's owner cannot alter restaurant A's delivery radius/fee via A's settings endpoint", async () => {
    const ownerB2 = await createTestUser("restaurant_owner", restaurantB._id);
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${tokenFor(ownerB2)}`)
      .send({ settings: { deliveryRadiusKm: 999, deliveryFee: 0.01 } });

    expect(res.status).toBe(403);
    const stored = await Restaurant.findById(restaurantA._id);
    expect(stored!.settings.deliveryRadiusKm).toBe(8);
    expect(stored!.settings.deliveryFee).toBe(3.99);
  });

  it("a plain customer cannot alter any restaurant's delivery settings", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ settings: { deliveryRadiusKm: 999 } });

    expect(res.status).toBe(403);
    const stored = await Restaurant.findById(restaurantA._id);
    expect(stored!.settings.deliveryRadiusKm).toBe(8);
  });
});
