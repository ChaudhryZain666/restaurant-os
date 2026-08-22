import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { CategoryLocationOverride } from "../models/CategoryLocationOverride.js";
import { MenuItemLocationOverride } from "../models/MenuItemLocationOverride.js";
import { ModifierGroupLocationOverride } from "../models/ModifierGroupLocationOverride.js";
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
import { resolveMenuForLocation } from "../services/menuResolution.service.js";

const app = createApp();

let business: Awaited<ReturnType<typeof createTestBusiness>>;
let locationA: Awaited<ReturnType<typeof createTestRestaurant>>;
let locationB: Awaited<ReturnType<typeof createTestRestaurant>>;
let otherBusiness: Awaited<ReturnType<typeof createTestBusiness>>;
let otherLocation: Awaited<ReturnType<typeof createTestRestaurant>>;

let ownerToken: string;
let managerToken: string;
let staffAToken: string; // scoped to locationA only
let kitchenStaffToken: string;
let crossBusinessOwnerToken: string;
let platformAdminToken: string;

beforeAll(async () => {
  await connectDB();

  business = await createTestBusiness();
  locationA = await createTestRestaurant({ businessId: business._id });
  locationB = await createTestRestaurant({ businessId: business._id });
  otherBusiness = await createTestBusiness();
  otherLocation = await createTestRestaurant({ businessId: otherBusiness._id });

  // A canonical MenuItem must already exist for businessHasCanonicalMenu to be true — seeded
  // directly (not via the new create endpoints, so these tests don't depend on the very thing
  // they're testing).
  const seedCategory = await createTestCategory(locationA._id, { businessId: business._id, name: "Seed Category" });
  await createTestMenuItem(locationA._id, seedCategory._id, { businessId: business._id, name: "Seed Item" });

  const owner = await createTestUser("restaurant_owner", locationA._id, { businessId: business._id });
  const manager = await createTestUser("restaurant_manager", locationA._id, { businessId: business._id });
  const staffA = await createTestUser("restaurant_staff", locationA._id, {
    businessId: business._id,
    locationIds: [locationA._id],
  });
  const kitchenStaff = await createTestUser("kitchen_staff", locationA._id, {
    businessId: business._id,
    locationIds: [locationA._id],
  });
  const crossBusinessOwner = await createTestUser("restaurant_owner", otherLocation._id, { businessId: otherBusiness._id });
  const platformAdmin = await createTestUser("platform_admin");

  ownerToken = tokenFor(owner);
  managerToken = tokenFor(manager);
  staffAToken = tokenFor(staffA);
  kitchenStaffToken = tokenFor(kitchenStaff);
  crossBusinessOwnerToken = tokenFor(crossBusinessOwner);
  platformAdminToken = tokenFor(platformAdmin);
});

afterAll(async () => {
  const businessIds = [business._id, otherBusiness._id];
  await Promise.all([
    MenuItem.deleteMany({ businessId: { $in: businessIds } }),
    Category.deleteMany({ businessId: { $in: businessIds } }),
    ModifierGroup.deleteMany({ businessId: { $in: businessIds } }),
    CategoryLocationOverride.deleteMany({ businessId: { $in: businessIds } }),
    MenuItemLocationOverride.deleteMany({ businessId: { $in: businessIds } }),
    ModifierGroupLocationOverride.deleteMany({ businessId: { $in: businessIds } }),
    User.deleteMany({ businessId: { $in: businessIds } }),
    Restaurant.deleteMany({ businessId: { $in: businessIds } }),
  ]);
  await closeTestConnections();
});

describe("POST/PATCH/DELETE /businesses/:businessId/categories — canonical authorization", () => {
  it("owner can create, update, and delete a canonical category", async () => {
    const createRes = await request(app)
      .post(`/api/v1/businesses/${business.id}/categories`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Owner Canonical Category" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.category.businessId).toBe(business.id);
    const categoryId = createRes.body.data.category.id;

    const updateRes = await request(app)
      .patch(`/api/v1/businesses/${business.id}/categories/${categoryId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Renamed" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.category.name).toBe("Renamed");

    const deleteRes = await request(app)
      .delete(`/api/v1/businesses/${business.id}/categories/${categoryId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(deleteRes.status).toBe(204);
  });

  it("manager can create a canonical category (implicit business-wide access)", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/categories`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "Manager Canonical Category" });
    expect(res.status).toBe(201);
  });

  it("staff (no restaurant.categories.write) cannot create a canonical category", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/categories`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ name: "Should fail" });
    expect(res.status).toBe(403);
  });

  it("kitchen_staff cannot create a canonical category", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/categories`)
      .set("Authorization", `Bearer ${kitchenStaffToken}`)
      .send({ name: "Should fail" });
    expect(res.status).toBe(403);
  });

  it("an owner of a different business cannot create a canonical category on this business", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/categories`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`)
      .send({ name: "Cross-business attempt" });
    expect(res.status).toBe(403);
  });

  it("platform_admin is exempt from the business-match check but still lacks the write permission", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/categories`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ name: "Should fail" });
    expect(res.status).toBe(403);
  });

  it("cannot delete a canonical category that still has menu items (businessId-scoped guard)", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    await createTestMenuItem(locationA._id, category._id, { businessId: business._id });

    const res = await request(app)
      .delete(`/api/v1/businesses/${business.id}/categories/${category.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(409);
  });
});

describe("POST/PATCH/DELETE /businesses/:businessId/menu and .../modifiers — canonical authorization", () => {
  it("owner can create a canonical menu item and a canonical modifier group on it", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });

    const itemRes = await request(app)
      .post(`/api/v1/businesses/${business.id}/menu`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Canonical Burger", price: 10, categoryId: category.id });
    expect(itemRes.status).toBe(201);
    const itemId = itemRes.body.data.item.id;

    const groupRes = await request(app)
      .post(`/api/v1/businesses/${business.id}/menu/${itemId}/modifiers`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Size", minSelect: 1, maxSelect: 1, options: [{ name: "Small", priceAdjustment: 0 }] });
    expect(groupRes.status).toBe(201);
    expect(groupRes.body.data.modifierGroup.businessId).toBe(business.id);
  });

  it("staff cannot create a canonical menu item", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/menu`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ name: "Should fail", price: 1, categoryId: category.id });
    expect(res.status).toBe(403);
  });

  it("rejects a categoryId that belongs to a different business", async () => {
    const foreignCategory = await createTestCategory(otherLocation._id, { businessId: otherBusiness._id });
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/menu`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Should fail", price: 1, categoryId: foreignCategory.id });
    expect(res.status).toBe(400);
  });
});

describe("PUT/DELETE .../override — per-location override authorization and behavior", () => {
  it("owner can override a canonical item's price at location A, location B stays on canonical", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id, price: 10 });

    const putRes = await request(app)
      .put(`/api/v1/restaurants/${locationA.id}/menu/${item.id}/override`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ priceOverride: 15 });
    expect(putRes.status).toBe(200);
    expect(putRes.body.data.override.priceOverride).toBe(15);

    const resolvedA = await resolveMenuForLocation(business.id, locationA.id, { includeHidden: false });
    expect(resolvedA.items.find((i) => i.id === item.id)?.price).toBe(15);
    const resolvedB = await resolveMenuForLocation(business.id, locationB.id, { includeHidden: false });
    expect(resolvedB.items.find((i) => i.id === item.id)?.price).toBe(10);
  });

  it("DELETE override restores the canonical value (reset to canonical)", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id, price: 20 });

    await request(app)
      .put(`/api/v1/restaurants/${locationA.id}/menu/${item.id}/override`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ priceOverride: 25 });

    const deleteRes = await request(app)
      .delete(`/api/v1/restaurants/${locationA.id}/menu/${item.id}/override`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(deleteRes.status).toBe(204);

    const resolved = await resolveMenuForLocation(business.id, locationA.id, { includeHidden: false });
    expect(resolved.items.find((i) => i.id === item.id)?.price).toBe(20);
  });

  it("DELETE on a nonexistent override is idempotent (204, not an error)", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id });

    const res = await request(app)
      .delete(`/api/v1/restaurants/${locationA.id}/menu/${item.id}/override`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(204);
  });

  it("a staff member scoped only to location A cannot override an item at location B", async () => {
    const category = await createTestCategory(locationB._id, { businessId: business._id });
    const item = await createTestMenuItem(locationB._id, category._id, { businessId: business._id });

    const res = await request(app)
      .put(`/api/v1/restaurants/${locationB.id}/menu/${item.id}/override`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ priceOverride: 99 });
    // staff lacks restaurant.menu.write in the first place, and even if it held that permission,
    // requireTenantMatch's staff branch is locationIds-membership only — either way this must fail.
    expect(res.status).toBe(403);
  });

  it("rejects an override PUT with no fields set (nothing to override)", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id });

    const res = await request(app)
      .put(`/api/v1/restaurants/${locationA.id}/menu/${item.id}/override`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("category and modifier-group overrides work the same way", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id, isActive: true });
    const catOverrideRes = await request(app)
      .put(`/api/v1/restaurants/${locationA.id}/categories/${category.id}/override`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ isActive: false });
    expect(catOverrideRes.status).toBe(200);

    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id });
    const group = await createTestModifierGroup(locationA._id, item._id, {
      businessId: business._id,
      options: [{ name: "Large", priceAdjustment: 2, isActive: true, sortOrder: 0 }],
    });
    const optionId = group.options[0]._id.toString();

    const groupOverrideRes = await request(app)
      .put(`/api/v1/restaurants/${locationA.id}/menu/${item.id}/modifiers/${group.id}/override`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ optionOverrides: [{ optionId, priceAdjustmentOverride: 5 }] });
    expect(groupOverrideRes.status).toBe(200);

    const resolved = await resolveMenuForLocation(business.id, locationA.id, { includeHidden: true });
    expect(resolved.categories.find((c) => c.id === category.id)?.isActive).toBe(false);
    const resolvedGroup = resolved.modifierGroups.find((g) => g.id === group.id);
    expect(resolvedGroup?.options.find((o) => o.id === optionId)?.priceAdjustment).toBe(5);
  });

  it("rejects an optionOverrides entry whose optionId doesn't belong to the group", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id });
    const group = await createTestModifierGroup(locationA._id, item._id, { businessId: business._id });

    const res = await request(app)
      .put(`/api/v1/restaurants/${locationA.id}/menu/${item.id}/modifiers/${group.id}/override`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ optionOverrides: [{ optionId: "aaaaaaaaaaaaaaaaaaaaaaaa", priceAdjustmentOverride: 1 }] });
    expect(res.status).toBe(400);
  });
});

describe("GET /restaurants/:restaurantId/menu/overrides — combined override read", () => {
  it("returns every override row across all three collections for this location only", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id, price: 10 });

    await request(app)
      .put(`/api/v1/restaurants/${locationA.id}/categories/${category.id}/override`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ sortOrderOverride: 9 });
    await request(app)
      .put(`/api/v1/restaurants/${locationA.id}/menu/${item.id}/override`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ priceOverride: 12 });

    const res = await request(app)
      .get(`/api/v1/restaurants/${locationA.id}/menu/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.categoryOverrides.some((o: { categoryId: string }) => o.categoryId === category.id)).toBe(true);
    expect(res.body.data.menuItemOverrides.some((o: { menuItemId: string }) => o.menuItemId === item.id)).toBe(true);

    // A sibling location's overrides never leak into this response.
    const bRes = await request(app)
      .get(`/api/v1/restaurants/${locationB.id}/menu/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(bRes.body.data.menuItemOverrides.some((o: { menuItemId: string }) => o.menuItemId === item.id)).toBe(false);
  });
});

describe("Concurrency — override PUT is a safe atomic upsert under concurrent requests", () => {
  it("two concurrent PUTs for the same item/location never throw a duplicate-key error and leave exactly one override row", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id, price: 10 });

    const [resA, resB] = await Promise.all([
      request(app)
        .put(`/api/v1/restaurants/${locationA.id}/menu/${item.id}/override`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ priceOverride: 11 }),
      request(app)
        .put(`/api/v1/restaurants/${locationA.id}/menu/${item.id}/override`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ priceOverride: 13 }),
    ]);
    expect([resA.status, resB.status]).toEqual([200, 200]);

    const rows = await MenuItemLocationOverride.find({ locationId: locationA._id, menuItemId: item._id });
    expect(rows).toHaveLength(1);
    expect([11, 13]).toContain(rows[0].priceOverride);
  });
});
