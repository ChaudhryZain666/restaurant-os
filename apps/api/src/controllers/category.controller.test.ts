import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
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
let ownerAToken: string;
let managerAToken: string;
let staffAToken: string;
let ownerBToken: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const managerA = await createTestUser("restaurant_manager", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);

  ownerAToken = tokenFor(ownerA);
  managerAToken = tokenFor(managerA);
  staffAToken = tokenFor(staffA);
  ownerBToken = tokenFor(ownerB);
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    Category.deleteMany({ restaurantId: { $in: ids } }),
    MenuItem.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteMany({ restaurantId: { $in: ids } }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await closeTestConnections();
});

describe("categories", () => {
  it("owner can create a category on their own restaurant", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/categories`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Appetizers" });

    expect(res.status).toBe(201);
    expect(res.body.data.category.restaurantId).toBe(restaurantA.id);
  });

  it("manager can create a category (restaurant.categories.write)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/categories`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ name: "Entrees" });

    expect(res.status).toBe(201);
  });

  it("staff cannot create a category (lacks restaurant.categories.write)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/categories`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ name: "Should fail" });

    expect(res.status).toBe(403);
  });

  it("restaurant B's owner cannot create a category under restaurant A (IDOR)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/categories`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ name: "Cross-tenant attempt" });

    expect(res.status).toBe(403);
  });

  it("cannot reassign a category to another restaurant via the update body", async () => {
    const category = await createTestCategory(restaurantA._id);

    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/categories/${category.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Renamed", restaurantId: restaurantB.id });

    expect(res.status).toBe(200);
    expect(res.body.data.category.restaurantId).toBe(restaurantA.id);

    const stored = await Category.findById(category.id);
    expect(stored!.restaurantId!.toString()).toBe(restaurantA.id);
  });

  it("cannot delete a category that still has menu items", async () => {
    const category = await createTestCategory(restaurantA._id);
    await createTestMenuItem(restaurantA._id, category._id);

    const res = await request(app)
      .delete(`/api/v1/restaurants/${restaurantA.id}/categories/${category.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`);

    expect(res.status).toBe(409);
  });

  it("restaurant B cannot delete restaurant A's category by guessing its ID", async () => {
    const category = await createTestCategory(restaurantA._id);

    const res = await request(app)
      .delete(`/api/v1/restaurants/${restaurantA.id}/categories/${category.id}`)
      .set("Authorization", `Bearer ${ownerBToken}`);

    expect(res.status).toBe(403);

    const stillExists = await Category.findById(category.id);
    expect(stillExists).not.toBeNull();
  });

  it("owner can rename a category (admin UI's new Rename control uses this same PATCH)", async () => {
    const category = await createTestCategory(restaurantA._id, { name: "Old Name" });

    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/categories/${category.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.data.category.name).toBe("New Name");
    const stored = await Category.findById(category.id);
    expect(stored!.name).toBe("New Name");
  });

  it("sortOrder and isActive updates persist and affect listing order/visibility", async () => {
    const category = await createTestCategory(restaurantA._id, { sortOrder: 5, isActive: true });

    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/categories/${category.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ sortOrder: 1, isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.category.sortOrder).toBe(1);
    expect(res.body.data.category.isActive).toBe(false);

    // The public menu bundle's categories list is filtered to isActive: true.
    const menuRes = await request(app).get(`/api/v1/restaurants/${restaurantA.id}/menu`);
    expect(menuRes.body.data.categories.some((c: { id: string }) => c.id === category.id)).toBe(false);
  });
});

describe("Phase 21 — legacy category writes are retired (410) once the business is migrated", () => {
  it("createCategory/updateCategory/deleteCategory all 410 for a migrated business, but stay 200 for an unmigrated one", async () => {
    const business = await createTestBusiness();
    const migratedRestaurant = await createTestRestaurant({ businessId: business._id });
    const canonicalCategory = await createTestCategory(migratedRestaurant._id, { businessId: business._id });
    // businessHasCanonicalMenu checks MenuItem, not Category — a canonical MenuItem must exist too.
    await createTestMenuItem(migratedRestaurant._id, canonicalCategory._id, { businessId: business._id });
    const migratedOwner = await createTestUser("restaurant_owner", migratedRestaurant._id, { businessId: business._id });
    const migratedOwnerToken = tokenFor(migratedOwner);

    const createRes = await request(app)
      .post(`/api/v1/restaurants/${migratedRestaurant.id}/categories`)
      .set("Authorization", `Bearer ${migratedOwnerToken}`)
      .send({ name: "Should be retired" });
    expect(createRes.status).toBe(410);
    expect(createRes.body.error.code).toBe("MENU_MIGRATED");

    const updateRes = await request(app)
      .patch(`/api/v1/restaurants/${migratedRestaurant.id}/categories/${canonicalCategory.id}`)
      .set("Authorization", `Bearer ${migratedOwnerToken}`)
      .send({ name: "Should be retired" });
    expect(updateRes.status).toBe(410);

    const deleteRes = await request(app)
      .delete(`/api/v1/restaurants/${migratedRestaurant.id}/categories/${canonicalCategory.id}`)
      .set("Authorization", `Bearer ${migratedOwnerToken}`);
    expect(deleteRes.status).toBe(410);

    // Confirm nothing was actually deleted — the canonical category is a shared business document.
    const stillExists = await Category.findById(canonicalCategory.id);
    expect(stillExists).not.toBeNull();

    // The exact same operation against restaurantA (never migrated) still works normally.
    const unmigratedRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/categories`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Still works" });
    expect(unmigratedRes.status).toBe(201);

    await Promise.all([
      MenuItem.deleteMany({ businessId: business._id }),
      Category.deleteMany({ businessId: business._id }),
      User.deleteOne({ _id: migratedOwner._id }),
      Restaurant.deleteOne({ _id: migratedRestaurant._id }),
    ]);
  });
});
