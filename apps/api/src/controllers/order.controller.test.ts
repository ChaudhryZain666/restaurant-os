import { afterAll, afterEach, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { LoyaltyAccount, LoyaltyTransaction } from "../models/LoyaltyAccount.js";
import { Counter } from "../models/Counter.js";
import {
  closeTestConnections,
  createTestCategory,
  createTestMenuItem,
  createTestModifierGroup,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let categoryA: Awaited<ReturnType<typeof createTestCategory>>;
let menuItemA: Awaited<ReturnType<typeof createTestMenuItem>>;
let sizeGroup: Awaited<ReturnType<typeof createTestModifierGroup>>;
let ownerAToken: string;
let ownerBToken: string;
let customerToken: string;
let customerId: string;

beforeAll(async () => {
  await connectDB();

  restaurantA = await createTestRestaurant({
    settings: { orderingEnabled: true, pickupEnabled: true, deliveryEnabled: true, minOrderAmount: 0, taxRate: 0.1, deliveryFee: 5 },
  });
  restaurantB = await createTestRestaurant();
  categoryA = await createTestCategory(restaurantA._id);
  menuItemA = await createTestMenuItem(restaurantA._id, categoryA._id, { price: 10 });
  sizeGroup = await createTestModifierGroup(restaurantA._id, menuItemA._id, {
    name: "Size",
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Small", priceAdjustment: 0 },
      { name: "Large", priceAdjustment: 2 },
    ],
  });

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  const customer = await createTestUser("customer");
  ownerAToken = tokenFor(ownerA);
  ownerBToken = tokenFor(ownerB);
  customerToken = tokenFor(customer);
  customerId = customer.id;
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    Order.deleteMany({ restaurantId: { $in: ids } }),
    ModifierGroup.deleteMany({ restaurantId: { $in: ids } }),
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

function largeOption() {
  return sizeGroup.options.find((o) => o.name === "Large")!;
}

describe("order pricing (server-authoritative)", () => {
  it("computes subtotal/tax/total from database prices, ignoring any client-submitted price", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [
          {
            menuItemId: menuItemA.id,
            quantity: 2,
            // price/unitPrice are not fields in the schema at all — zod strips them even if sent.
            price: 1,
            unitPrice: 1,
            selectedModifiers: [{ groupId: sizeGroup.id, optionId: largeOption()._id.toString() }],
          },
        ],
      });

    expect(res.status).toBe(201);
    const order = res.body.data.order;
    // (10 + 2) * 2 = 24 subtotal, never 1 * 2 = 2
    expect(order.subtotal).toBe(24);
    expect(order.taxAmount).toBeCloseTo(2.4);
    expect(order.deliveryFee).toBe(0); // pickup order
    expect(order.total).toBeCloseTo(26.4);
    expect(order.items[0].unitPrice).toBe(10);
    expect(order.items[0].selectedModifiers[0].priceAdjustment).toBe(2);
    expect(order.orderNumber).toMatch(/^ORD-\d+$/);
  });

  it("rejects a selection count outside a modifier group's min/max", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [
          {
            menuItemId: menuItemA.id,
            quantity: 1,
            selectedModifiers: [
              { groupId: sizeGroup.id, optionId: largeOption()._id.toString() },
              { groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() },
            ],
          },
        ],
      });

    expect(res.status).toBe(400);
  });

  it("rejects an order missing a required (minSelect >= 1) modifier group", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [] }],
      });

    expect(res.status).toBe(400);
  });

  it("rejects a modifier group ID that belongs to a different restaurant's item", async () => {
    const categoryB = await createTestCategory(restaurantB._id);
    const menuItemB = await createTestMenuItem(restaurantB._id, categoryB._id, { price: 5 });
    const groupB = await createTestModifierGroup(restaurantB._id, menuItemB._id, { minSelect: 0, maxSelect: 1 });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [
          {
            menuItemId: menuItemA.id,
            quantity: 1,
            selectedModifiers: [{ groupId: groupB.id, optionId: groupB.options[0]._id.toString() }],
          },
        ],
      });

    expect(res.status).toBe(400);
  });

  it("rejects delivery orders without a deliveryAddress", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "delivery",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });

    expect(res.status).toBe(400);
  });

  it("enforces minOrderAmount", async () => {
    const pickyRestaurant = await createTestRestaurant({
      settings: { orderingEnabled: true, pickupEnabled: true, deliveryEnabled: false, minOrderAmount: 100, taxRate: 0, deliveryFee: 0 },
    });
    const cat = await createTestCategory(pickyRestaurant._id);
    const item = await createTestMenuItem(pickyRestaurant._id, cat._id, { price: 10 });

    const res = await request(app)
      .post(`/api/v1/restaurants/${pickyRestaurant.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ orderType: "pickup", items: [{ menuItemId: item.id, quantity: 1, selectedModifiers: [] }] });

    expect(res.status).toBe(400);

    await Promise.all([
      MenuItem.deleteOne({ _id: item._id }),
      Category.deleteOne({ _id: cat._id }),
      Restaurant.deleteOne({ _id: pickyRestaurant._id }),
    ]);
  });

  it("generates sequential, unique order numbers per restaurant", async () => {
    const make = () =>
      request(app)
        .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
        .set("Authorization", `Bearer ${customerToken}`)
        .send({
          orderType: "pickup",
          items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
        });

    const [res1, res2] = [await make(), await make()];
    expect(res1.body.data.order.orderNumber).not.toBe(res2.body.data.order.orderNumber);
  });
});

describe("order status state machine", () => {
  async function placeOrder() {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });
    return res.body.data.order.id as string;
  }

  it("allows the documented forward transitions", async () => {
    const orderId = await placeOrder();
    for (const status of ["confirmed", "preparing", "ready", "completed"]) {
      const res = await request(app)
        .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/status`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({ status });
      expect(res.status).toBe(200);
      expect(res.body.data.order.status).toBe(status);
    }
  });

  it("rejects skipping states (pending -> completed)", async () => {
    const orderId = await placeOrder();
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status: "completed" });

    expect(res.status).toBe(400);
  });

  it("rejects transitions out of a terminal state (completed -> preparing)", async () => {
    const orderId = await placeOrder();
    for (const status of ["confirmed", "preparing", "ready", "completed"]) {
      await request(app)
        .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/status`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({ status });
    }
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status: "preparing" });

    expect(res.status).toBe(400);
  });
});

describe("cross-tenant order access", () => {
  it("restaurant B cannot list restaurant A's orders", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });

  it("restaurant B cannot change restaurant A's order status by guessing the order ID", async () => {
    const createRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });
    const orderId = createRes.body.data.order.id;

    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantB.id}/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ status: "confirmed" });

    // Blocked at the tenant-match layer (restaurantB in the URL doesn't match orderId's owner
    // either way) — either 403 (tenant mismatch) or 404 (filter excludes it) is an acceptable
    // "did not succeed" outcome; what matters is the order is provably untouched.
    expect([403, 404]).toContain(res.status);

    const stored = await Order.findById(orderId);
    expect(stored!.status).toBe("pending");
  });

  it("a customer cannot view another customer's order", async () => {
    const otherCustomer = await createTestUser("customer");
    const otherToken = tokenFor(otherCustomer);

    const createRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });
    const orderId = createRes.body.data.order.id;

    const res = await request(app).get(`/api/v1/orders/${orderId}`).set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(403);

    await User.deleteOne({ _id: otherCustomer._id });
  });
});

describe("restaurant ordering pause (Phase 2)", () => {
  afterEach(async () => {
    await Restaurant.findByIdAndUpdate(restaurantA._id, {
      $set: { "settings.temporarilyPaused": false, "settings.pausedReason": undefined },
    });
  });

  it("rejects placing an order while the restaurant is temporarily paused", async () => {
    await Restaurant.findByIdAndUpdate(restaurantA._id, {
      $set: { "settings.temporarilyPaused": true, "settings.pausedReason": "Kitchen is slammed" },
    });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("Kitchen is slammed");
  });

  it("owner can toggle temporarilyPaused via settings PATCH and it round-trips", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ settings: { temporarilyPaused: true, pausedReason: "86 the kitchen" } });

    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.settings.temporarilyPaused).toBe(true);
    expect(res.body.data.restaurant.settings.pausedReason).toBe("86 the kitchen");
    expect(res.body.data.availability).toEqual({ status: "paused", reason: "86 the kitchen" });
  });

  it("GET /restaurants/by-slug reports availability status of closed when orderingEnabled is false", async () => {
    await Restaurant.findByIdAndUpdate(restaurantA._id, { $set: { "settings.orderingEnabled": false } });
    const res = await request(app).get(`/api/v1/restaurants/by-slug/${restaurantA.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.availability.status).toBe("closed");
    await Restaurant.findByIdAndUpdate(restaurantA._id, { $set: { "settings.orderingEnabled": true } });
  });
});

describe("order cancellation (customer self-service)", () => {
  async function placeOrder() {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });
    return res.body.data.order.id as string;
  }

  it("the owning customer can cancel their own pending order", async () => {
    const orderId = await placeOrder();
    const res = await request(app)
      .patch(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.order.status).toBe("cancelled");
  });

  it("a different customer cannot cancel someone else's order", async () => {
    const orderId = await placeOrder();
    const otherCustomer = await createTestUser("customer");
    const otherToken = tokenFor(otherCustomer);

    const res = await request(app).patch(`/api/v1/orders/${orderId}/cancel`).set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(403);

    const stored = await Order.findById(orderId);
    expect(stored!.status).toBe("pending");
    await User.deleteOne({ _id: otherCustomer._id });
  });

  it("cannot cancel once the restaurant has already confirmed the order", async () => {
    const orderId = await placeOrder();
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status: "confirmed" });

    const res = await request(app)
      .patch(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(400);
    const stored = await Order.findById(orderId);
    expect(stored!.status).toBe("confirmed");
  });

  it("cannot cancel an already-cancelled order", async () => {
    const orderId = await placeOrder();
    await request(app).patch(`/api/v1/orders/${orderId}/cancel`).set("Authorization", `Bearer ${customerToken}`);
    const res = await request(app).patch(`/api/v1/orders/${orderId}/cancel`).set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(400);
  });
});

describe("order payment status (staff)", () => {
  async function placeOrder() {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });
    return res.body.data.order.id as string;
  }

  it("staff can mark an order as paid", async () => {
    const orderId = await placeOrder();
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/payment-status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ paymentStatus: "paid" });

    expect(res.status).toBe(200);
    expect(res.body.data.order.paymentStatus).toBe("paid");
  });

  it("rejects an invalid paymentStatus value", async () => {
    const orderId = await placeOrder();
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/payment-status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ paymentStatus: "refunded" });

    expect(res.status).toBe(400);
  });

  it("restaurant B staff cannot mark restaurant A's order as paid", async () => {
    const orderId = await placeOrder();
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantB.id}/orders/${orderId}/payment-status`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ paymentStatus: "paid" });

    expect([403, 404]).toContain(res.status);
    const stored = await Order.findById(orderId);
    expect(stored!.paymentStatus).toBe("unpaid");
  });
});

describe("staff order views include customer contact info", () => {
  it("listRestaurantOrders attaches customerName/customerPhone", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${ownerAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orders.length).toBeGreaterThan(0);
    expect(res.body.data.orders[0].customerName).toEqual(expect.any(String));
  });

  it("getOrder as staff attaches customerName", async () => {
    const createRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });
    const orderId = createRes.body.data.order.id;

    const res = await request(app).get(`/api/v1/orders/${orderId}`).set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.order.customerName).toEqual(expect.any(String));
  });
});
