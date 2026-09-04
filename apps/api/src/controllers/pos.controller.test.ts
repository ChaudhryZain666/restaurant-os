import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { Table } from "../models/Table.js";
import { User } from "../models/User.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import {
  closeTestConnections,
  createTestCategory,
  createTestMenuItem,
  createTestModifierGroup,
  createTestRestaurant,
  createTestTable,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantPosDisabled: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerAToken: string;
let staffAToken: string;
let kitchenAToken: string;
let ownerBToken: string;
let posDisabledOwnerToken: string;
let itemA: Awaited<ReturnType<typeof createTestMenuItem>>;
let itemWithModifiers: Awaited<ReturnType<typeof createTestMenuItem>>;
let requiredGroup: Awaited<ReturnType<typeof createTestModifierGroup>>;
let tableA: Awaited<ReturnType<typeof createTestTable>>;
let tableB: Awaited<ReturnType<typeof createTestTable>>;
let existingCustomer: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant({
    settings: {
      orderingEnabled: true,
      pickupEnabled: true,
      deliveryEnabled: true,
      dineInEnabled: true,
      cashEnabled: true,
      onlinePaymentEnabled: false,
      posEnabled: true,
      minOrderAmount: 0,
      taxRate: 0.1,
      deliveryFee: 5,
    },
  });
  restaurantB = await createTestRestaurant({ settings: { posEnabled: true, cashEnabled: true, pickupEnabled: true } });
  restaurantPosDisabled = await createTestRestaurant({ settings: { posEnabled: false, cashEnabled: true, pickupEnabled: true } });

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const kitchenA = await createTestUser("kitchen_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  const posDisabledOwner = await createTestUser("restaurant_owner", restaurantPosDisabled._id);
  existingCustomer = await createTestUser("customer", undefined, { name: "Returning Customer", phone: "+15551234567" });

  ownerAToken = tokenFor(ownerA);
  staffAToken = tokenFor(staffA);
  kitchenAToken = tokenFor(kitchenA);
  ownerBToken = tokenFor(ownerB);
  posDisabledOwnerToken = tokenFor(posDisabledOwner);

  const category = await createTestCategory(restaurantA._id);
  itemA = await createTestMenuItem(restaurantA._id, category._id, { price: 10 });
  itemWithModifiers = await createTestMenuItem(restaurantA._id, category._id, { price: 5 });
  requiredGroup = await createTestModifierGroup(restaurantA._id, itemWithModifiers._id, {
    minSelect: 1,
    maxSelect: 1,
    options: [{ name: "Large", priceAdjustment: 2 }],
  });

  tableA = await createTestTable(restaurantA._id, { name: "A1" });
  tableB = await createTestTable(restaurantB._id, { name: "B1" });
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id, restaurantPosDisabled._id];
  await Promise.all([
    Table.deleteMany({ restaurantId: { $in: ids } }),
    Order.deleteMany({ restaurantId: { $in: ids } }),
    Category.deleteMany({ restaurantId: { $in: ids } }),
    MenuItem.deleteMany({ restaurantId: { $in: ids } }),
    ModifierGroup.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteMany({ _id: existingCustomer._id }),
    User.deleteMany({ email: /@pos\.local$/ }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await closeTestConnections();
});

function posOrder(token: string, restaurantId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/v1/restaurants/${restaurantId}/pos/orders`).set("Authorization", `Bearer ${token}`).send(body);
}

describe("POS authorization", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post(`/api/v1/restaurants/${restaurantA.id}/pos/orders`).send({});
    expect(res.status).toBe(401);
  });

  it("kitchen_staff cannot access POS (lacks restaurant.pos.operate)", async () => {
    const res = await posOrder(kitchenAToken, restaurantA.id, {
      customer: { name: "Walk-in" },
      items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
      orderType: "pickup",
      paymentMethod: "cash",
    });
    expect(res.status).toBe(403);
  });

  it("restaurant B's owner cannot create a POS order under restaurant A (tenant isolation)", async () => {
    const res = await posOrder(ownerBToken, restaurantA.id, {
      customer: { name: "Walk-in" },
      items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
      orderType: "pickup",
      paymentMethod: "cash",
    });
    expect(res.status).toBe(403);
  });

  it("rejects POS orders when the location has posEnabled: false", async () => {
    const res = await posOrder(posDisabledOwnerToken, restaurantPosDisabled.id, {
      customer: { name: "Walk-in" },
      items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
      orderType: "pickup",
      paymentMethod: "cash",
    });
    expect(res.status).toBe(400);
  });
});

describe("POS order creation — walk-in and existing customers", () => {
  it("restaurant_staff creates a real order for a new walk-in customer", async () => {
    const res = await posOrder(staffAToken, restaurantA.id, {
      customer: { name: "Jane Walk-in", phone: "+15559876543" },
      items: [{ menuItemId: itemA.id, quantity: 2, selectedModifiers: [] }],
      orderType: "pickup",
      paymentMethod: "cash",
    });

    expect(res.status).toBe(201);
    const order = res.body.data.order;
    expect(order.channel).toBe("pos");
    expect(order.paymentMethod).toBe("cash");
    // Paid immediately by default — staff collects cash in the same motion as ringing up the sale.
    expect(order.paymentStatus).toBe("paid");
    expect(order.subtotal).toBe(20);
    // Server-computed, never trusted from the request — taxRate 0.1 on a $20 subtotal.
    expect(order.taxAmount).toBeCloseTo(2, 5);
    expect(order.total).toBeCloseTo(22, 5);

    const walkIn = await User.findOne({ name: "Jane Walk-in", role: "customer" });
    expect(walkIn).not.toBeNull();
    expect(walkIn!.phone).toBe("+15559876543");
    expect(walkIn!.id).toBe(order.customerId);
  });

  it("reuses an existing customer account found by the walk-in's email instead of creating a duplicate", async () => {
    const first = await posOrder(staffAToken, restaurantA.id, {
      customer: { name: "Repeat Guest", email: "repeat-guest@example.com" },
      items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
      orderType: "pickup",
      paymentMethod: "cash",
    });
    expect(first.status).toBe(201);

    const second = await posOrder(staffAToken, restaurantA.id, {
      customer: { name: "Repeat Guest", email: "repeat-guest@example.com" },
      items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
      orderType: "pickup",
      paymentMethod: "cash",
    });
    expect(second.status).toBe(201);
    expect(second.body.data.order.customerId).toBe(first.body.data.order.customerId);

    const matches = await User.find({ email: "repeat-guest@example.com" });
    expect(matches.length).toBe(1);
  });

  it("creates an order against an existing customerId", async () => {
    const res = await posOrder(staffAToken, restaurantA.id, {
      customer: { customerId: existingCustomer.id },
      items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
      orderType: "pickup",
      paymentMethod: "cash",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.order.customerId).toBe(existingCustomer.id);
  });

  it("rejects an unknown customerId", async () => {
    const res = await posOrder(staffAToken, restaurantA.id, {
      customer: { customerId: "64b000000000000000000000" },
      items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
      orderType: "pickup",
      paymentMethod: "cash",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a customerId belonging to a staff account, not a real customer", async () => {
    const res = await posOrder(staffAToken, restaurantA.id, {
      customer: { customerId: (await User.findOne({ email: /restaurant_owner/ }))?.id ?? "" },
      items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
      orderType: "pickup",
      paymentMethod: "cash",
    });
    expect(res.status).toBe(400);
  });
});

describe("POS order creation — modifiers, payment, order type", () => {
  it("prices required modifiers server-side, not from client-sent amounts", async () => {
    const res = await posOrder(staffAToken, restaurantA.id, {
      customer: { name: "Modifier Tester" },
      items: [
        {
          menuItemId: itemWithModifiers.id,
          quantity: 1,
          selectedModifiers: [{ groupId: requiredGroup.id, optionId: requiredGroup.options[0]._id.toString() }],
        },
      ],
      orderType: "pickup",
      paymentMethod: "cash",
    });
    expect(res.status).toBe(201);
    // $5 base + $2 modifier = $7 subtotal, regardless of anything the client could have sent.
    expect(res.body.data.order.subtotal).toBe(7);
  });

  it("rejects an item missing its required modifier selection", async () => {
    const res = await posOrder(staffAToken, restaurantA.id, {
      customer: { name: "Missing Modifier" },
      items: [{ menuItemId: itemWithModifiers.id, quantity: 1, selectedModifiers: [] }],
      orderType: "pickup",
      paymentMethod: "cash",
    });
    expect(res.status).toBe(400);
  });

  it("accepts card payment and marks it paid immediately by default", async () => {
    const res = await posOrder(staffAToken, restaurantA.id, {
      customer: { name: "Card Payer" },
      items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
      orderType: "pickup",
      paymentMethod: "card",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.order.paymentMethod).toBe("card");
    expect(res.body.data.order.paymentStatus).toBe("paid");
  });

  it("markPaidImmediately: false leaves the order unpaid (tab)", async () => {
    const res = await posOrder(staffAToken, restaurantA.id, {
      customer: { name: "Tab Customer" },
      items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
      orderType: "pickup",
      paymentMethod: "cash",
      markPaidImmediately: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.order.paymentStatus).toBe("unpaid");
  });

  it("dine-in requires a tableId", async () => {
    const res = await posOrder(staffAToken, restaurantA.id, {
      customer: { name: "No Table" },
      items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
      orderType: "dine_in",
      paymentMethod: "cash",
    });
    expect(res.status).toBe(400);
  });

  it("associates a staff-selected table and the table shows as occupied afterward", async () => {
    const res = await posOrder(staffAToken, restaurantA.id, {
      customer: { name: "Table Guest" },
      items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
      orderType: "dine_in",
      paymentMethod: "cash",
      tableId: tableA.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.order.tableId).toBe(tableA.id);
    expect(res.body.data.order.tableName).toBe(tableA.name);

    const tablesRes = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/tables`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    const found = tablesRes.body.data.tables.find((t: { id: string }) => t.id === tableA.id);
    expect(found.status).toBe("occupied");
    expect(found.activeOrderCount).toBeGreaterThanOrEqual(1);
  });

  it("rejects a table that belongs to a different restaurant (forged tableId / IDOR)", async () => {
    const res = await posOrder(staffAToken, restaurantA.id, {
      customer: { name: "Forged Table" },
      items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
      orderType: "dine_in",
      paymentMethod: "cash",
      tableId: tableB.id,
    });
    expect(res.status).toBe(400);
  });

  it("delivery requires an address", async () => {
    const res = await posOrder(staffAToken, restaurantA.id, {
      customer: { name: "No Address" },
      items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
      orderType: "delivery",
      paymentMethod: "cash",
    });
    expect(res.status).toBe(400);
  });
});
