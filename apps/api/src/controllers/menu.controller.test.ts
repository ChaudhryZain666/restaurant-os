import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import {
  closeTestConnections,
  createTestBusiness,
  createTestCategory,
  createTestMenuItem,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let categoryA: Awaited<ReturnType<typeof createTestCategory>>;
let categoryB: Awaited<ReturnType<typeof createTestCategory>>;
let ownerAToken: string;
let ownerBToken: string;
let menuItemId: string;

beforeAll(async () => {
  await connectDB();

  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();
  categoryA = await createTestCategory(restaurantA._id);
  categoryB = await createTestCategory(restaurantB._id);

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  ownerAToken = tokenFor(ownerA);
  ownerBToken = tokenFor(ownerB);

  const item = await createTestMenuItem(restaurantA._id, categoryA._id, { name: "Original Name", price: 10 });
  menuItemId = item.id;
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    MenuItem.deleteMany({ restaurantId: { $in: ids } }),
    Category.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteMany({ restaurantId: { $in: ids } }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await closeTestConnections();
});

describe("public menu bundle — cross-tenant isolation (Phase 8)", () => {
  it("restaurant A's public menu never includes restaurant B's items or categories", async () => {
    const itemB = await createTestMenuItem(restaurantB._id, categoryB._id, { name: "Restaurant B Exclusive" });

    const res = await request(app).get(`/api/v1/restaurants/${restaurantA.id}/menu`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.every((i: { id: string }) => i.id !== itemB.id)).toBe(true);
    expect(res.body.data.categories.every((c: { id: string }) => c.id !== categoryB.id)).toBe(true);
    // Sanity: restaurant A's own item IS there, proving this isn't just an empty response.
    expect(res.body.data.items.some((i: { id: string }) => i.id === menuItemId)).toBe(true);
  });
});

describe("PATCH /restaurants/:restaurantId/menu/:id tenant boundary (Phase 0 audit finding #1)", () => {
  it("cannot reassign a menu item to another restaurant via a restaurantId in the body", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/menu/${menuItemId}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Updated Name", restaurantId: restaurantB.id });

    expect(res.status).toBe(200);
    // The response reflects the legitimate field update...
    expect(res.body.data.item.name).toBe("Updated Name");
    // ...but restaurantId is untouched, regardless of what the client sent.
    expect(res.body.data.item.restaurantId).toBe(restaurantA.id);

    const stored = await MenuItem.findById(menuItemId);
    expect(stored!.restaurantId!.toString()).toBe(restaurantA.id);
    expect(stored!.name).toBe("Updated Name");
  });

  it("rejects a negative price instead of saving it", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/menu/${menuItemId}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ price: -5 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");

    const stored = await MenuItem.findById(menuItemId);
    expect(stored!.price).not.toBe(-5);
  });
});

describe("menu item / category tenant boundary (Phase 1)", () => {
  it("cannot create a menu item under another restaurant's category", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Sneaky Item", price: 5, categoryId: categoryB.id });

    expect(res.status).toBe(400);
  });

  it("cannot move an existing menu item to another restaurant's category", async () => {
    const item = await createTestMenuItem(restaurantA._id, categoryA._id);

    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/menu/${item.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ categoryId: categoryB.id });

    expect(res.status).toBe(400);

    const stored = await MenuItem.findById(item.id);
    expect(stored!.categoryId.toString()).toBe(categoryA.id);
  });
});

describe("GET /restaurants/:restaurantId/menu/items (staff, includes hidden items) — Phase 2", () => {
  it("includes an unavailable item that the public /menu listing omits", async () => {
    const hiddenItem = await createTestMenuItem(restaurantA._id, categoryA._id, {
      name: "Hidden Special",
      isAvailable: false,
    });

    const staffRes = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/menu/items`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(staffRes.status).toBe(200);
    expect(staffRes.body.data.items.some((i: { id: string }) => i.id === hiddenItem.id)).toBe(true);

    const publicRes = await request(app).get(`/api/v1/restaurants/${restaurantA.id}/menu`);
    expect(publicRes.body.data.items.some((i: { id: string }) => i.id === hiddenItem.id)).toBe(false);
  });

  it("rejects staff from another restaurant", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/menu/items`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated access", async () => {
    const res = await request(app).get(`/api/v1/restaurants/${restaurantA.id}/menu/items`);
    expect(res.status).toBe(401);
  });
});

describe("Phase 21 — legacy menu-item writes are retired (410) once the business is migrated; canonical reads still resolve", () => {
  it("createMenuItem/updateMenuItem/deleteMenuItem all 410 for a migrated business, and both listMenu and listAllMenuItems resolve the canonical menu correctly", async () => {
    const business = await createTestBusiness();
    const migratedRestaurant = await createTestRestaurant({ businessId: business._id });
    const canonicalCategory = await createTestCategory(migratedRestaurant._id, { businessId: business._id, name: "Canonical Category" });
    const canonicalItem = await createTestMenuItem(migratedRestaurant._id, canonicalCategory._id, {
      businessId: business._id,
      name: "Canonical Item",
      price: 9,
    });
    const migratedOwner = await createTestUser("restaurant_owner", migratedRestaurant._id, { businessId: business._id });
    const migratedOwnerToken = tokenFor(migratedOwner);

    const createRes = await request(app)
      .post(`/api/v1/restaurants/${migratedRestaurant.id}/menu`)
      .set("Authorization", `Bearer ${migratedOwnerToken}`)
      .send({ name: "Should be retired", price: 1, categoryId: canonicalCategory.id });
    expect(createRes.status).toBe(410);
    expect(createRes.body.error.code).toBe("MENU_MIGRATED");

    const updateRes = await request(app)
      .patch(`/api/v1/restaurants/${migratedRestaurant.id}/menu/${canonicalItem.id}`)
      .set("Authorization", `Bearer ${migratedOwnerToken}`)
      .send({ name: "Should be retired" });
    expect(updateRes.status).toBe(410);

    const deleteRes = await request(app)
      .delete(`/api/v1/restaurants/${migratedRestaurant.id}/menu/${canonicalItem.id}`)
      .set("Authorization", `Bearer ${migratedOwnerToken}`);
    expect(deleteRes.status).toBe(410);

    const stillExists = await MenuItem.findById(canonicalItem.id);
    expect(stillExists).not.toBeNull();

    // Reads go through resolveMenuForLocation and correctly resolve the canonical menu — this is
    // the previously-untested canonical branch of both listMenu and listAllMenuItems.
    const publicRes = await request(app).get(`/api/v1/restaurants/${migratedRestaurant.id}/menu`);
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.data.items.some((i: { id: string; name: string }) => i.id === canonicalItem.id && i.name === "Canonical Item")).toBe(
      true
    );

    const staffRes = await request(app)
      .get(`/api/v1/restaurants/${migratedRestaurant.id}/menu/items`)
      .set("Authorization", `Bearer ${migratedOwnerToken}`);
    expect(staffRes.status).toBe(200);
    expect(staffRes.body.data.items.some((i: { id: string }) => i.id === canonicalItem.id)).toBe(true);

    // The exact same operation against restaurantA (never migrated) still works normally.
    const unmigratedRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/menu`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Still works", price: 1, categoryId: categoryA.id });
    expect(unmigratedRes.status).toBe(201);

    await Promise.all([
      MenuItem.deleteMany({ businessId: business._id }),
      Category.deleteMany({ businessId: business._id }),
      User.deleteOne({ _id: migratedOwner._id }),
      Restaurant.deleteOne({ _id: migratedRestaurant._id }),
    ]);
  });
});
