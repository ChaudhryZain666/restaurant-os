import { afterAll, afterEach, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { MenuItemLocationOverride } from "../models/MenuItemLocationOverride.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { Order } from "../models/Order.js";
import { Payment } from "../models/Payment.js";
import { Restaurant } from "../models/Restaurant.js";
import { Table } from "../models/Table.js";
import { User } from "../models/User.js";
import { LoyaltyAccount, LoyaltyTransaction } from "../models/LoyaltyAccount.js";
import { Counter } from "../models/Counter.js";
import {
  closeTestConnections,
  createTestBusiness,
  createTestCategory,
  createTestMenuItem,
  createTestModifierGroup,
  createTestOrder,
  createTestRestaurant,
  createTestTable,
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
    settings: {
      orderingEnabled: true,
      pickupEnabled: true,
      deliveryEnabled: true,
      dineInEnabled: true,
      cashEnabled: true,
      onlinePaymentEnabled: true,
      minOrderAmount: 0,
      taxRate: 0.1,
      deliveryFee: 5,
    },
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
    Payment.deleteMany({ restaurantId: { $in: ids } }),
    Table.deleteMany({ restaurantId: { $in: ids } }),
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

  it("rejects a menu item ID that belongs to a different restaurant entirely (Phase 8 cross-tenant order attempt)", async () => {
    const categoryB = await createTestCategory(restaurantB._id);
    const menuItemB = await createTestMenuItem(restaurantB._id, categoryB._id, { price: 999 });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemB.id, quantity: 1, selectedModifiers: [] }],
      });

    expect(res.status).toBe(400);
    const stored = await Order.find({ restaurantId: restaurantA._id, "items.menuItemId": menuItemB._id });
    expect(stored).toHaveLength(0);
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

describe("dine-in orders (Phase 7)", () => {
  function orderBody(extra: Record<string, unknown>) {
    return {
      orderType: "dine_in",
      items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      ...extra,
    };
  }

  it("creates a dine-in order for a valid table token and records tableId + tableName snapshot", async () => {
    const table = await createTestTable(restaurantA._id, { name: "Table 9", capacity: 4 });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderBody({ tableToken: table.qrToken }));

    expect(res.status).toBe(201);
    expect(res.body.data.order.orderType).toBe("dine_in");
    expect(res.body.data.order.tableId).toBe(table.id);
    expect(res.body.data.order.tableName).toBe("Table 9");
  });

  it("rejects a dine-in order with no tableToken at all", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderBody({}));

    expect(res.status).toBe(400);
  });

  it("rejects an unknown/invalid table token", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderBody({ tableToken: "not-a-real-token" }));

    expect(res.status).toBe(400);
  });

  it("rejects a token belonging to a deactivated table", async () => {
    const table = await createTestTable(restaurantA._id, { isActive: false });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderBody({ tableToken: table.qrToken }));

    expect(res.status).toBe(400);
  });

  it("rejects a table token that belongs to a different restaurant (cross-tenant)", async () => {
    const tableB = await createTestTable(restaurantB._id);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderBody({ tableToken: tableB.qrToken }));

    expect(res.status).toBe(400);
    const stored = await Order.find({ restaurantId: restaurantA._id, tableId: tableB._id });
    expect(stored).toHaveLength(0);
  });

  it("ignores any client-supplied tableId and re-resolves the table server-side from the token alone", async () => {
    const table = await createTestTable(restaurantA._id);
    const decoyTable = await createTestTable(restaurantA._id);

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ ...orderBody({ tableToken: table.qrToken }), tableId: decoyTable.id });

    expect(res.status).toBe(201);
    expect(res.body.data.order.tableId).toBe(table.id);
    expect(res.body.data.order.tableId).not.toBe(decoyTable.id);
  });

  it("rejects dine-in ordering when the restaurant hasn't enabled it", async () => {
    const noDineIn = await createTestRestaurant({
      settings: { orderingEnabled: true, pickupEnabled: true, deliveryEnabled: true, dineInEnabled: false, minOrderAmount: 0, taxRate: 0.1, deliveryFee: 5 },
    });
    const cat = await createTestCategory(noDineIn._id);
    const item = await createTestMenuItem(noDineIn._id, cat._id, { price: 10 });
    const table = await createTestTable(noDineIn._id);

    const res = await request(app)
      .post(`/api/v1/restaurants/${noDineIn.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "dine_in",
        tableToken: table.qrToken,
        items: [{ menuItemId: item.id, quantity: 1, selectedModifiers: [] }],
      });

    expect(res.status).toBe(400);

    await Promise.all([
      Table.deleteOne({ _id: table._id }),
      MenuItem.deleteOne({ _id: item._id }),
      Category.deleteOne({ _id: cat._id }),
      Restaurant.deleteOne({ _id: noDineIn._id }),
    ]);
  });

  it("prices a dine-in order identically to a pickup order for the same items (table context doesn't affect pricing)", async () => {
    const table = await createTestTable(restaurantA._id);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderBody({ tableToken: table.qrToken }));

    expect(res.status).toBe(201);
    // Same item/modifier as the pricing describe block's pickup case, minus quantity 2 — just the
    // base $10 item + $0 (Small) modifier, no delivery fee.
    expect(res.body.data.order.subtotal).toBe(10);
    expect(res.body.data.order.deliveryFee).toBe(0);
  });

  it("supports cash and online payment methods for dine-in, same as pickup/delivery", async () => {
    const table = await createTestTable(restaurantA._id);
    const cashRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderBody({ tableToken: table.qrToken, paymentMethod: "cash" }));
    expect(cashRes.status).toBe(201);
    expect(cashRes.body.data.order.paymentMethod).toBe("cash");
    expect(cashRes.body.data.order.paymentStatus).toBe("unpaid");

    const onlineRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderBody({ tableToken: table.qrToken, paymentMethod: "online" }));
    expect(onlineRes.status).toBe(201);
    expect(onlineRes.body.data.order.paymentMethod).toBe("online");
    expect(onlineRes.body.data.order.paymentStatus).toBe("unpaid");
  });

  it("allows ready -> completed for dine-in orders, same as pickup (not out_for_delivery)", async () => {
    const table = await createTestTable(restaurantA._id);
    const createRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderBody({ tableToken: table.qrToken }));
    const orderId = createRes.body.data.order.id;

    for (const status of ["confirmed", "preparing", "ready", "completed"]) {
      const res = await request(app)
        .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/status`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({ status });
      expect(res.status).toBe(200);
    }
  });

  it("does not require a tableToken for pickup/delivery orders (regression)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.order.tableId).toBeUndefined();
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

describe("loyalty reversal on cancellation/refund (Phase 16) — cancelling can't be used to farm points", () => {
  it("cancelling an order reverses the loyalty points it earned", async () => {
    const customer = await createTestUser("customer");
    const token = tokenFor(customer);

    const create = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });
    expect(create.status).toBe(201);
    const orderId = create.body.data.order.id as string;
    const earned = create.body.data.order.loyaltyPointsEarned as number;
    expect(earned).toBeGreaterThan(0);

    const afterEarn = await LoyaltyAccount.findOne({ restaurantId: restaurantA._id, customerId: customer.id });
    expect(afterEarn!.pointsBalance).toBe(earned);

    const cancel = await request(app).patch(`/api/v1/orders/${orderId}/cancel`).set("Authorization", `Bearer ${token}`);
    expect(cancel.status).toBe(200);

    const afterCancel = await LoyaltyAccount.findOne({ restaurantId: restaurantA._id, customerId: customer.id });
    expect(afterCancel!.pointsBalance).toBe(0);

    const storedOrder = await Order.findById(orderId);
    expect(storedOrder!.loyaltyReversed).toBe(true);

    const reversalTxn = await LoyaltyTransaction.findOne({ orderId, type: "adjustment", points: -earned });
    expect(reversalTxn).not.toBeNull();

    await User.deleteOne({ _id: customer._id });
    await LoyaltyAccount.deleteOne({ restaurantId: restaurantA._id, customerId: customer.id });
    await LoyaltyTransaction.deleteMany({ restaurantId: restaurantA._id, customerId: customer.id });
  });

  it("cancelling an order refunds the loyalty points it redeemed, and claws back only what it itself earned", async () => {
    const customer = await createTestUser("customer");
    const token = tokenFor(customer);

    // Order 1: earns points, never cancelled — this is the baseline balance order 2 must not disturb.
    await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });
    const baselineBalance = (await LoyaltyAccount.findOne({ restaurantId: restaurantA._id, customerId: customer.id }))!.pointsBalance;
    expect(baselineBalance).toBeGreaterThan(0);

    // Order 2: redeems some of order 1's points, also earns its own (smaller, post-discount) points.
    const order2 = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
        redeemPoints: 5,
      });
    expect(order2.status).toBe(201);
    expect(order2.body.data.order.loyaltyPointsRedeemed).toBe(5);
    const order2Id = order2.body.data.order.id as string;

    const cancel = await request(app).patch(`/api/v1/orders/${order2Id}/cancel`).set("Authorization", `Bearer ${token}`);
    expect(cancel.status).toBe(200);

    // Order 2's net effect on the balance (its own redemption + its own earn) is fully undone —
    // the balance returns to exactly what order 1 alone left it at, order 1 itself untouched.
    const finalBalance = (await LoyaltyAccount.findOne({ restaurantId: restaurantA._id, customerId: customer.id }))!.pointsBalance;
    expect(finalBalance).toBe(baselineBalance);

    await User.deleteOne({ _id: customer._id });
    await LoyaltyAccount.deleteOne({ restaurantId: restaurantA._id, customerId: customer.id });
    await LoyaltyTransaction.deleteMany({ restaurantId: restaurantA._id, customerId: customer.id });
  });

  it("a full refund of an online order's payment also reverses the loyalty points it earned", async () => {
    const customer = await createTestUser("customer");
    const token = tokenFor(customer);

    const create = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderType: "pickup",
        paymentMethod: "online",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });
    expect(create.status).toBe(201);
    const orderId = create.body.data.order.id as string;
    const earned = create.body.data.order.loyaltyPointsEarned as number;
    expect(earned).toBeGreaterThan(0);

    const paymentRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ idempotencyKey: `loyalty-refund-${orderId}` });
    const paymentId = paymentRes.body.data.payment.id as string;

    await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/payments/${paymentId}/mock-complete`)
      .set("Authorization", `Bearer ${token}`)
      .send({ outcome: "paid" });

    const refundRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/payments/${paymentId}/refund`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ idempotencyKey: `loyalty-refund-full-${paymentId}`, reason: "Customer complaint" });
    expect(refundRes.status).toBe(201);

    const stored = await Payment.findById(paymentId);
    expect(stored!.status).toBe("refunded");

    const afterRefund = await LoyaltyAccount.findOne({ restaurantId: restaurantA._id, customerId: customer.id });
    expect(afterRefund!.pointsBalance).toBe(0);

    const storedOrder = await Order.findById(orderId);
    expect(storedOrder!.loyaltyReversed).toBe(true);

    await User.deleteOne({ _id: customer._id });
    await LoyaltyAccount.deleteOne({ restaurantId: restaurantA._id, customerId: customer.id });
    await LoyaltyTransaction.deleteMany({ restaurantId: restaurantA._id, customerId: customer.id });
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

describe("online payment method — order/payment consistency (Phase 5)", () => {
  async function placeOnlineOrder() {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        paymentMethod: "online",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });
    return res.body.data.order.id as string;
  }

  it("creates an order with paymentMethod=online, unpaid, defaulting to cash when omitted elsewhere", async () => {
    const orderId = await placeOnlineOrder();
    const stored = await Order.findById(orderId);
    expect(stored!.paymentMethod).toBe("online");
    expect(stored!.paymentStatus).toBe("unpaid");
  });

  it("defaults paymentMethod to cash when not specified, preserving existing behavior", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });
    expect(res.body.data.order.paymentMethod).toBe("cash");
  });

  it("staff cannot accept (confirm) an unpaid online order", async () => {
    const orderId = await placeOnlineOrder();
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status: "confirmed" });

    expect(res.status).toBe(400);
  });

  it("staff CAN still cancel an unpaid pending online order", async () => {
    const orderId = await placeOnlineOrder();
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
  });

  it("staff can accept an online order once it's actually paid", async () => {
    const orderId = await placeOnlineOrder();
    await Order.findByIdAndUpdate(orderId, { $set: { paymentStatus: "paid" } });

    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status: "confirmed" });

    expect(res.status).toBe(200);
  });

  it("the manual payment-status endpoint (cash-only) rejects online orders", async () => {
    const orderId = await placeOnlineOrder();
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/payment-status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ paymentStatus: "paid" });

    expect(res.status).toBe(400);
    const stored = await Order.findById(orderId);
    expect(stored!.paymentStatus).toBe("unpaid");
  });
});

describe("restaurant payment-method gating (Phase 15) — server never trusts the client's chosen method", () => {
  let cashOnlyRestaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
  let onlineOnlyRestaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
  let cashOnlyCategory: Awaited<ReturnType<typeof createTestCategory>>;
  let cashOnlyItem: Awaited<ReturnType<typeof createTestMenuItem>>;
  let onlineOnlyCategory: Awaited<ReturnType<typeof createTestCategory>>;
  let onlineOnlyItem: Awaited<ReturnType<typeof createTestMenuItem>>;

  beforeAll(async () => {
    cashOnlyRestaurant = await createTestRestaurant({
      settings: { orderingEnabled: true, pickupEnabled: true, cashEnabled: true, onlinePaymentEnabled: false, minOrderAmount: 0, taxRate: 0 },
    });
    onlineOnlyRestaurant = await createTestRestaurant({
      settings: { orderingEnabled: true, pickupEnabled: true, cashEnabled: false, onlinePaymentEnabled: true, minOrderAmount: 0, taxRate: 0 },
    });
    cashOnlyCategory = await createTestCategory(cashOnlyRestaurant._id);
    cashOnlyItem = await createTestMenuItem(cashOnlyRestaurant._id, cashOnlyCategory._id, { price: 5 });
    onlineOnlyCategory = await createTestCategory(onlineOnlyRestaurant._id);
    onlineOnlyItem = await createTestMenuItem(onlineOnlyRestaurant._id, onlineOnlyCategory._id, { price: 5 });
  });

  afterAll(async () => {
    const ids = [cashOnlyRestaurant._id, onlineOnlyRestaurant._id];
    await Promise.all([
      Order.deleteMany({ restaurantId: { $in: ids } }),
      MenuItem.deleteMany({ restaurantId: { $in: ids } }),
      Category.deleteMany({ restaurantId: { $in: ids } }),
      Counter.deleteMany({ _id: { $in: ids } }),
      Restaurant.deleteMany({ _id: { $in: ids } }),
    ]);
  });

  it("rejects an online order for a cash-only restaurant, even though the request is otherwise well-formed", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${cashOnlyRestaurant.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ orderType: "pickup", paymentMethod: "online", items: [{ menuItemId: cashOnlyItem.id, quantity: 1, selectedModifiers: [] }] });
    expect(res.status).toBe(400);
  });

  it("allows a cash order for a cash-only restaurant", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${cashOnlyRestaurant.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ orderType: "pickup", paymentMethod: "cash", items: [{ menuItemId: cashOnlyItem.id, quantity: 1, selectedModifiers: [] }] });
    expect(res.status).toBe(201);
  });

  it("rejects a cash order for an online-only restaurant", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${onlineOnlyRestaurant.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ orderType: "pickup", paymentMethod: "cash", items: [{ menuItemId: onlineOnlyItem.id, quantity: 1, selectedModifiers: [] }] });
    expect(res.status).toBe(400);
  });

  it("allows an online order for an online-only restaurant", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${onlineOnlyRestaurant.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ orderType: "pickup", paymentMethod: "online", items: [{ menuItemId: onlineOnlyItem.id, quantity: 1, selectedModifiers: [] }] });
    expect(res.status).toBe(201);
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

describe("order status history (Phase 3 tracking foundation)", () => {
  it("records a statusHistory entry on creation and on every subsequent status change", async () => {
    const createRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });
    const orderId = createRes.body.data.order.id;
    expect(createRes.body.data.order.statusHistory).toEqual([{ status: "pending", at: expect.any(String) }]);

    const confirmRes = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status: "confirmed" });

    expect(confirmRes.body.data.order.statusHistory).toHaveLength(2);
    expect(confirmRes.body.data.order.statusHistory[1].status).toBe("confirmed");
  });

  it("records a cancelled entry when the customer self-cancels", async () => {
    const createRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });
    const orderId = createRes.body.data.order.id;

    const cancelRes = await request(app)
      .patch(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(cancelRes.body.data.order.statusHistory).toHaveLength(2);
    expect(cancelRes.body.data.order.statusHistory[1].status).toBe("cancelled");
  });
});

describe("reorder (POST /orders/:id/reorder)", () => {
  async function placeOrder() {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: menuItemA.id, quantity: 2, selectedModifiers: [{ groupId: sizeGroup.id, optionId: sizeGroup.options[0]._id.toString() }] }],
      });
    return res.body.data.order.id as string;
  }

  it("returns a re-priced preview using CURRENT menu data, not the historical snapshot", async () => {
    const orderId = await placeOrder();

    await MenuItem.findByIdAndUpdate(menuItemA._id, { $set: { price: 15 } });

    const res = await request(app).post(`/api/v1/orders/${orderId}/reorder`).set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.restaurantAvailable).toBe(true);
    expect(res.body.data.unavailableItems).toEqual([]);
    expect(res.body.data.items[0].unitPrice).toBe(15); // current price, not the $10 historical one
    expect(res.body.data.items[0].lineTotal).toBe(30);

    await MenuItem.findByIdAndUpdate(menuItemA._id, { $set: { price: 10 } });
  });

  it("includes restaurantSlug so the customer routes back to the correct restaurant's /r/:slug/cart (Phase 8)", async () => {
    const orderId = await placeOrder();
    const res = await request(app).post(`/api/v1/orders/${orderId}/reorder`).set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.restaurantSlug).toBe(restaurantA.slug);
  });

  it("a different customer cannot reorder someone else's order", async () => {
    const orderId = await placeOrder();
    const otherCustomer = await createTestUser("customer");
    const otherToken = tokenFor(otherCustomer);

    const res = await request(app).post(`/api/v1/orders/${orderId}/reorder`).set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(403);

    await User.deleteOne({ _id: otherCustomer._id });
  });

  it("reports a since-hidden menu item as unavailable instead of silently dropping it", async () => {
    const orderId = await placeOrder();

    await MenuItem.findByIdAndUpdate(menuItemA._id, { $set: { isAvailable: false } });

    const res = await request(app).post(`/api/v1/orders/${orderId}/reorder`).set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.unavailableItems).toHaveLength(1);
    expect(res.body.data.unavailableItems[0].name).toBe(menuItemA.name);

    await MenuItem.findByIdAndUpdate(menuItemA._id, { $set: { isAvailable: true } });
  });

  it("reports restaurantAvailable: false when the restaurant has since paused ordering, but still prices available items", async () => {
    const orderId = await placeOrder();
    await Restaurant.findByIdAndUpdate(restaurantA._id, { $set: { "settings.temporarilyPaused": true } });

    const res = await request(app).post(`/api/v1/orders/${orderId}/reorder`).set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.restaurantAvailable).toBe(false);
    expect(res.body.data.items).toHaveLength(1);

    await Restaurant.findByIdAndUpdate(restaurantA._id, { $set: { "settings.temporarilyPaused": false } });
  });

  it("reports every item as unavailable when the restaurant itself no longer exists/active", async () => {
    const orderId = await placeOrder();
    await Restaurant.findByIdAndUpdate(restaurantA._id, { $set: { status: "suspended" } });

    const res = await request(app).post(`/api/v1/orders/${orderId}/reorder`).set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.restaurantAvailable).toBe(false);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.unavailableItems.length).toBeGreaterThan(0);

    await Restaurant.findByIdAndUpdate(restaurantA._id, { $set: { status: "active" } });
  });
});

describe("GET /orders/mine — pagination", () => {
  let pagingRestaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
  let pagingCustomer: Awaited<ReturnType<typeof createTestUser>>;
  let otherCustomer: Awaited<ReturnType<typeof createTestUser>>;
  let pagingCustomerToken: string;
  let otherCustomerToken: string;
  const TOTAL_ORDERS = 25;

  beforeAll(async () => {
    pagingRestaurant = await createTestRestaurant();
    pagingCustomer = await createTestUser("customer");
    otherCustomer = await createTestUser("customer");
    pagingCustomerToken = tokenFor(pagingCustomer);
    otherCustomerToken = tokenFor(otherCustomer);

    // Staggered createdAt (passed at creation time — timestamps:true only auto-fills a missing
    // value, so an explicit one here is respected) so newest-first ordering is unambiguous to
    // assert against. Created in parallel, not a 25-iteration sequential await loop — this is
    // what was timing out the default 5s hook timeout under load, not anything pagination-related.
    await Promise.all(
      Array.from({ length: TOTAL_ORDERS }, (_, i) =>
        createTestOrder(pagingRestaurant._id, pagingCustomer._id, {
          orderNumber: `ORD-PAGE-${i}`,
          createdAt: new Date(Date.now() - i * 1000),
        })
      )
    );
    // A single order for a different customer — proves pagination never leaks another user's orders.
    await createTestOrder(pagingRestaurant._id, otherCustomer._id, { orderNumber: "ORD-PAGE-OTHER" });
  }, 20_000);

  afterAll(async () => {
    await Order.deleteMany({ restaurantId: pagingRestaurant._id });
    await Restaurant.deleteOne({ _id: pagingRestaurant._id });
    await User.deleteMany({ _id: { $in: [pagingCustomer._id, otherCustomer._id] } });
  });

  it("defaults to page 1 with a bounded page size and correct envelope math", async () => {
    const res = await request(app).get("/api/v1/orders/mine").set("Authorization", `Bearer ${pagingCustomerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.limit).toBe(20);
    expect(res.body.data.total).toBe(TOTAL_ORDERS);
    expect(res.body.data.totalPages).toBe(2);
    expect(res.body.data.hasNextPage).toBe(true);
    expect(res.body.data.hasPreviousPage).toBe(false);
    expect(res.body.data.items).toHaveLength(20);
    // Newest first — order 0 was staggered to be the most recent.
    expect(res.body.data.items[0].orderNumber).toBe("ORD-PAGE-0");
  });

  it("returns the remainder on the next page, with hasNextPage false", async () => {
    const res = await request(app)
      .get("/api/v1/orders/mine?page=2&limit=20")
      .set("Authorization", `Bearer ${pagingCustomerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(TOTAL_ORDERS - 20);
    expect(res.body.data.hasNextPage).toBe(false);
    expect(res.body.data.hasPreviousPage).toBe(true);
  });

  it("respects a custom limit", async () => {
    const res = await request(app)
      .get("/api/v1/orders/mine?page=1&limit=5")
      .set("Authorization", `Bearer ${pagingCustomerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(5);
    expect(res.body.data.totalPages).toBe(Math.ceil(TOTAL_ORDERS / 5));
  });

  it("rejects an out-of-range limit rather than silently clamping it", async () => {
    const res = await request(app)
      .get("/api/v1/orders/mine?limit=500")
      .set("Authorization", `Bearer ${pagingCustomerToken}`);
    expect(res.status).toBe(400);
  });

  it("rejects a non-positive page", async () => {
    const res = await request(app).get("/api/v1/orders/mine?page=0").set("Authorization", `Bearer ${pagingCustomerToken}`);
    expect(res.status).toBe(400);
  });

  it("a different customer's paginated view never includes this customer's orders", async () => {
    const res = await request(app).get("/api/v1/orders/mine").set("Authorization", `Bearer ${otherCustomerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].orderNumber).toBe("ORD-PAGE-OTHER");
  });
});

describe("Phase 20 — canonical business menu order pricing, end to end through the real route", () => {
  let canonicalBusiness: Awaited<ReturnType<typeof createTestBusiness>>;
  let canonicalLocationA: Awaited<ReturnType<typeof createTestRestaurant>>;
  let canonicalLocationB: Awaited<ReturnType<typeof createTestRestaurant>>;
  let canonicalCategory: Awaited<ReturnType<typeof createTestCategory>>;
  let canonicalItem: Awaited<ReturnType<typeof createTestMenuItem>>;
  let canonicalCustomerToken: string;

  beforeAll(async () => {
    canonicalBusiness = await createTestBusiness();
    canonicalLocationA = await createTestRestaurant({
      businessId: canonicalBusiness._id,
      settings: { orderingEnabled: true, pickupEnabled: true, cashEnabled: true, minOrderAmount: 0, taxRate: 0 },
    });
    canonicalLocationB = await createTestRestaurant({
      businessId: canonicalBusiness._id,
      settings: { orderingEnabled: true, pickupEnabled: true, cashEnabled: true, minOrderAmount: 0, taxRate: 0 },
    });
    canonicalCategory = await createTestCategory(canonicalLocationA._id, { businessId: canonicalBusiness._id });
    canonicalItem = await createTestMenuItem(canonicalLocationA._id, canonicalCategory._id, {
      businessId: canonicalBusiness._id,
      price: 10,
    });
    await MenuItem.create({
      businessId: canonicalBusiness._id,
      restaurantId: canonicalLocationB._id,
      categoryId: canonicalCategory._id,
      name: "unused-anchor-doc-to-mark-canonical",
      price: 1,
    });
    await MenuItemLocationOverride.create({
      businessId: canonicalBusiness._id,
      locationId: canonicalLocationA._id,
      menuItemId: canonicalItem._id,
      priceOverride: 14,
    });
    const canonicalCustomer = await createTestUser("customer");
    canonicalCustomerToken = tokenFor(canonicalCustomer);
  });

  afterAll(async () => {
    const ids = [canonicalLocationA._id, canonicalLocationB._id];
    await Promise.all([
      Order.deleteMany({ restaurantId: { $in: ids } }),
      MenuItem.deleteMany({ businessId: canonicalBusiness._id }),
      Category.deleteMany({ businessId: canonicalBusiness._id }),
      MenuItemLocationOverride.deleteMany({ businessId: canonicalBusiness._id }),
      Counter.deleteMany({ _id: { $in: ids } }),
      Restaurant.deleteMany({ _id: { $in: ids } }),
    ]);
  });

  it("charges location A's price override through the real order-creation route, and location B's canonical default through the same route", async () => {
    const resA = await request(app)
      .post(`/api/v1/restaurants/${canonicalLocationA.id}/orders`)
      .set("Authorization", `Bearer ${canonicalCustomerToken}`)
      .send({ orderType: "pickup", items: [{ menuItemId: canonicalItem.id, quantity: 1, selectedModifiers: [] }] });
    expect(resA.status).toBe(201);
    expect(resA.body.data.order.items[0].unitPrice).toBe(14);
    expect(resA.body.data.order.subtotal).toBe(14);

    const resB = await request(app)
      .post(`/api/v1/restaurants/${canonicalLocationB.id}/orders`)
      .set("Authorization", `Bearer ${canonicalCustomerToken}`)
      .send({ orderType: "pickup", items: [{ menuItemId: canonicalItem.id, quantity: 1, selectedModifiers: [] }] });
    expect(resB.status).toBe(201);
    expect(resB.body.data.order.items[0].unitPrice).toBe(10);
  });

  it("cannot submit location A's override price by ordering the same canonical item through location B's route", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${canonicalLocationB.id}/orders`)
      .set("Authorization", `Bearer ${canonicalCustomerToken}`)
      .send({
        orderType: "pickup",
        items: [{ menuItemId: canonicalItem.id, quantity: 1, price: 14, unitPrice: 14, selectedModifiers: [] }],
      });
    expect(res.status).toBe(201);
    // Zod strips unknown price fields, AND location B has no override — either way, canonical
    // default (10), never A's override (14).
    expect(res.body.data.order.items[0].unitPrice).toBe(10);
  });

  it("order snapshot stays immutable after the canonical price changes and a new override is added later", async () => {
    const createRes = await request(app)
      .post(`/api/v1/restaurants/${canonicalLocationA.id}/orders`)
      .set("Authorization", `Bearer ${canonicalCustomerToken}`)
      .send({ orderType: "pickup", items: [{ menuItemId: canonicalItem.id, quantity: 1, selectedModifiers: [] }] });
    expect(createRes.status).toBe(201);
    const orderId = createRes.body.data.order.id;
    const originalUnitPrice = createRes.body.data.order.items[0].unitPrice;
    const originalSubtotal = createRes.body.data.order.subtotal;

    // Mutate the canonical price AND location A's own override after the order already exists.
    await MenuItem.updateOne({ _id: canonicalItem._id }, { $set: { price: 999 } });
    await MenuItemLocationOverride.updateOne(
      { locationId: canonicalLocationA._id, menuItemId: canonicalItem._id },
      { $set: { priceOverride: 500 } }
    );

    const fetchRes = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${canonicalCustomerToken}`);
    expect(fetchRes.status).toBe(200);
    expect(fetchRes.body.data.order.items[0].unitPrice).toBe(originalUnitPrice);
    expect(fetchRes.body.data.order.subtotal).toBe(originalSubtotal);

    // Restore, so this test doesn't corrupt the other tests in this describe block.
    await MenuItem.updateOne({ _id: canonicalItem._id }, { $set: { price: 10 } });
    await MenuItemLocationOverride.updateOne(
      { locationId: canonicalLocationA._id, menuItemId: canonicalItem._id },
      { $set: { priceOverride: 14 } }
    );
  });
});
