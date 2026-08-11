import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
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
let menuItemA: Awaited<ReturnType<typeof createTestMenuItem>>;
let menuItemB: Awaited<ReturnType<typeof createTestMenuItem>>;
let ownerAToken: string;
let ownerBToken: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();
  const categoryA = await createTestCategory(restaurantA._id);
  const categoryB = await createTestCategory(restaurantB._id);
  menuItemA = await createTestMenuItem(restaurantA._id, categoryA._id);
  menuItemB = await createTestMenuItem(restaurantB._id, categoryB._id);

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  ownerAToken = tokenFor(ownerA);
  ownerBToken = tokenFor(ownerB);
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    ModifierGroup.deleteMany({ restaurantId: { $in: ids } }),
    MenuItem.deleteMany({ restaurantId: { $in: ids } }),
    Category.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteMany({ restaurantId: { $in: ids } }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await closeTestConnections();
});

describe("modifier groups", () => {
  it("owner can create a modifier group on their own menu item", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/${menuItemA.id}/modifiers`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Size", minSelect: 1, maxSelect: 1, options: [{ name: "Small", priceAdjustment: 0 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.modifierGroup.menuItemId).toBe(menuItemA.id);
  });

  it("cannot create a modifier group on another restaurant's menu item (IDOR via menuItemId)", async () => {
    // restaurantA in the URL, but menuItemB (belongs to restaurant B) as the target path segment
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/${menuItemB.id}/modifiers`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Sneaky", minSelect: 0, maxSelect: 1, options: [{ name: "X", priceAdjustment: 0 }] });

    expect(res.status).toBe(404);
  });

  it("restaurant B cannot create a modifier group under restaurant A's menu item", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/${menuItemA.id}/modifiers`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ name: "Cross-tenant", minSelect: 0, maxSelect: 1, options: [{ name: "X", priceAdjustment: 0 }] });

    expect(res.status).toBe(403);
  });

  it("update ignores an attempt to change priceAdjustment to a negative number", async () => {
    const group = await createTestModifierGroup(restaurantA._id, menuItemA._id, {
      options: [{ name: "Regular", priceAdjustment: 1 }],
    });

    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/menu/${menuItemA.id}/modifiers/${group.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ options: [{ name: "Regular", priceAdjustment: -5 }] });

    expect(res.status).toBe(400);
  });

  it("rejects creating a group where minSelect exceeds maxSelect (would be permanently unorderable)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/${menuItemA.id}/modifiers`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Impossible", minSelect: 3, maxSelect: 1, options: [{ name: "X", priceAdjustment: 0 }] });

    expect(res.status).toBe(400);
  });

  it("rejects an update that would leave minSelect greater than maxSelect", async () => {
    const group = await createTestModifierGroup(restaurantA._id, menuItemA._id, { minSelect: 0, maxSelect: 1 });

    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/menu/${menuItemA.id}/modifiers/${group.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ minSelect: 2 });

    expect(res.status).toBe(400);
  });
});
