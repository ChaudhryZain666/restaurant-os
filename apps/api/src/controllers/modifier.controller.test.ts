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
  createTestBusiness,
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

describe("Phase 68 — canonical modifier-group counts", () => {
  it("returns a per-menu-item count scoped to the calling business, and 0 items get no entry", async () => {
    const business = await createTestBusiness();
    const restaurant = await createTestRestaurant({ businessId: business._id });
    const category = await createTestCategory(restaurant._id, { businessId: business._id });
    const itemWithGroups = await createTestMenuItem(restaurant._id, category._id, { businessId: business._id });
    const itemWithNoGroups = await createTestMenuItem(restaurant._id, category._id, { businessId: business._id });
    await createTestModifierGroup(restaurant._id, itemWithGroups._id, { businessId: business._id });
    await createTestModifierGroup(restaurant._id, itemWithGroups._id, { businessId: business._id });
    const owner = await createTestUser("restaurant_owner", restaurant._id, { businessId: business._id });
    const ownerToken = tokenFor(owner);

    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/menu/modifier-counts`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.counts[itemWithGroups.id]).toBe(2);
    expect(res.body.data.counts[itemWithNoGroups.id]).toBeUndefined();
    // A different business's own canonical groups (restaurantA/menuItemA from the top-level
    // beforeAll) must never leak into this business's counts.
    expect(res.body.data.counts[menuItemA.id]).toBeUndefined();

    await Promise.all([
      ModifierGroup.deleteMany({ businessId: business._id }),
      MenuItem.deleteMany({ businessId: business._id }),
      Category.deleteMany({ businessId: business._id }),
      User.deleteOne({ _id: owner._id }),
      Restaurant.deleteOne({ _id: restaurant._id }),
    ]);
  });

  it("restaurant B's owner cannot read restaurant A's business modifier-group counts (cross-tenant)", async () => {
    const businessA = await createTestBusiness();
    const restaurantForB = await createTestRestaurant();
    const ownerForB = await createTestUser("restaurant_owner", restaurantForB._id);
    const ownerForBToken = tokenFor(ownerForB);

    const res = await request(app)
      .get(`/api/v1/businesses/${businessA.id}/menu/modifier-counts`)
      .set("Authorization", `Bearer ${ownerForBToken}`);

    expect(res.status).toBe(403);

    await Promise.all([User.deleteOne({ _id: ownerForB._id }), Restaurant.deleteOne({ _id: restaurantForB._id })]);
  });
});

describe("Phase 21 — legacy modifier-group writes are retired (410) once the business is migrated", () => {
  it("createModifierGroup/updateModifierGroup/deleteModifierGroup all 410 for a migrated business, but stay 200 for an unmigrated one", async () => {
    const business = await createTestBusiness();
    const migratedRestaurant = await createTestRestaurant({ businessId: business._id });
    const canonicalCategory = await createTestCategory(migratedRestaurant._id, { businessId: business._id });
    const canonicalItem = await createTestMenuItem(migratedRestaurant._id, canonicalCategory._id, { businessId: business._id });
    const canonicalGroup = await createTestModifierGroup(migratedRestaurant._id, canonicalItem._id, { businessId: business._id });
    const migratedOwner = await createTestUser("restaurant_owner", migratedRestaurant._id, { businessId: business._id });
    const migratedOwnerToken = tokenFor(migratedOwner);

    const createRes = await request(app)
      .post(`/api/v1/restaurants/${migratedRestaurant.id}/menu/${canonicalItem.id}/modifiers`)
      .set("Authorization", `Bearer ${migratedOwnerToken}`)
      .send({ name: "Should be retired", minSelect: 0, maxSelect: 1, options: [{ name: "X", priceAdjustment: 0 }] });
    expect(createRes.status).toBe(410);
    expect(createRes.body.error.code).toBe("MENU_MIGRATED");

    const updateRes = await request(app)
      .patch(`/api/v1/restaurants/${migratedRestaurant.id}/menu/${canonicalItem.id}/modifiers/${canonicalGroup.id}`)
      .set("Authorization", `Bearer ${migratedOwnerToken}`)
      .send({ name: "Should be retired" });
    expect(updateRes.status).toBe(410);

    const deleteRes = await request(app)
      .delete(`/api/v1/restaurants/${migratedRestaurant.id}/menu/${canonicalItem.id}/modifiers/${canonicalGroup.id}`)
      .set("Authorization", `Bearer ${migratedOwnerToken}`);
    expect(deleteRes.status).toBe(410);

    const stillExists = await ModifierGroup.findById(canonicalGroup.id);
    expect(stillExists).not.toBeNull();

    // The exact same operation against restaurantA (never migrated) still works normally.
    const unmigratedRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu/${menuItemA.id}/modifiers`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Still works", minSelect: 0, maxSelect: 1, options: [{ name: "X", priceAdjustment: 0 }] });
    expect(unmigratedRes.status).toBe(201);

    await Promise.all([
      ModifierGroup.deleteMany({ businessId: business._id }),
      MenuItem.deleteMany({ businessId: business._id }),
      Category.deleteMany({ businessId: business._id }),
      User.deleteOne({ _id: migratedOwner._id }),
      Restaurant.deleteOne({ _id: migratedRestaurant._id }),
    ]);
  });
});
