import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { AuditLog } from "../models/AuditLog.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import {
  closeTestConnections,
  createTestCategory,
  createTestMenuItem,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let categoryA: Awaited<ReturnType<typeof createTestCategory>>;
let menuItemA: Awaited<ReturnType<typeof createTestMenuItem>>;
let platformAdminToken: string;
let platformAdminId: string;
let ownerAToken: string;
let ownerAId: string;
let customerToken: string;
let customerId: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant({
    settings: { orderingEnabled: true, pickupEnabled: true, deliveryEnabled: false, minOrderAmount: 0, taxRate: 0, deliveryFee: 0 },
  });
  categoryA = await createTestCategory(restaurantA._id);
  menuItemA = await createTestMenuItem(restaurantA._id, categoryA._id, { price: 10 });

  const platformAdmin = await createTestUser("platform_admin");
  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const customer = await createTestUser("customer");

  platformAdminToken = tokenFor(platformAdmin);
  platformAdminId = platformAdmin.id;
  ownerAToken = tokenFor(ownerA);
  ownerAId = ownerA.id;
  customerToken = tokenFor(customer);
  customerId = customer.id;
});

afterAll(async () => {
  await Promise.all([
    MenuItem.deleteOne({ _id: menuItemA._id }),
    Category.deleteOne({ _id: categoryA._id }),
    Restaurant.deleteOne({ _id: restaurantA._id }),
    AuditLog.deleteMany({ restaurantId: restaurantA._id }),
    User.deleteMany({ _id: { $in: [platformAdminId, ownerAId, customerId] } }),
  ]);
  await closeTestConnections();
});

describe("GET /platform/restaurants/:id — single-restaurant overview (Phase 16)", () => {
  it("platform admin sees profile, owner, readiness, analytics, and recent activity", async () => {
    // createTestRestaurant's fixture ownerId is a placeholder ObjectId unrelated to any real user
    // (see test-utils/fixtures.ts) — real restaurant creation always links these, so point it at
    // the real ownerA fixture user here to exercise the actual owner-lookup path this endpoint uses.
    await Restaurant.findByIdAndUpdate(restaurantA._id, { ownerId: ownerAId });

    const res = await request(app)
      .get(`/api/v1/platform/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${platformAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.id).toBe(restaurantA.id);
    expect(res.body.data.owner.email).toBeTruthy();
    expect(res.body.data.owner.invitePending).toBe(false);
    expect(res.body.data.readiness).toHaveProperty("ready");
    expect(res.body.data.readiness).toHaveProperty("checks");
    expect(res.body.data.analytics).toHaveProperty("ordersToday");
    expect(typeof res.body.data.orderCountLifetime).toBe("number");
    expect(Array.isArray(res.body.data.recentAuditLog)).toBe(true);
  });

  it("returns 404 for a restaurant that doesn't exist", async () => {
    const res = await request(app)
      .get("/api/v1/platform/restaurants/6a0000000000000000000000")
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(404);
  });

  it("a restaurant owner (not platform_admin) cannot access the platform overview endpoint", async () => {
    const res = await request(app)
      .get(`/api/v1/platform/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get(`/api/v1/platform/restaurants/${restaurantA.id}`);
    expect(res.status).toBe(401);
  });
});

describe("GET /platform/restaurants — pagination/search/filter", () => {
  let extraRestaurants: Awaited<ReturnType<typeof createTestRestaurant>>[];

  beforeAll(async () => {
    extraRestaurants = await Promise.all([
      createTestRestaurant({ name: "Pagination Diner", slug: `pagination-diner-${Date.now()}`, status: "suspended" }),
      createTestRestaurant({ name: "Pagination Bistro", slug: `pagination-bistro-${Date.now()}` }),
    ]);
  });

  afterAll(async () => {
    await Restaurant.deleteMany({ _id: { $in: extraRestaurants.map((r) => r._id) } });
  });

  it("is bounded by limit and reports envelope math, not the entire table", async () => {
    const res = await request(app)
      .get("/api/v1/platform/restaurants?limit=1")
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.limit).toBe(1);
    expect(res.body.data.total).toBeGreaterThanOrEqual(3);
  });

  it("search matches by name", async () => {
    const res = await request(app)
      .get("/api/v1/platform/restaurants?search=Pagination Bistro")
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].name).toBe("Pagination Bistro");
  });

  it("status filter narrows to exactly that status", async () => {
    const res = await request(app)
      .get("/api/v1/platform/restaurants?search=Pagination&status=suspended")
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].name).toBe("Pagination Diner");
  });

  it("rejects an un-whitelisted sort field", async () => {
    const res = await request(app)
      .get("/api/v1/platform/restaurants?sort=ownerId")
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(400);
  });

  it("a restaurant owner cannot list platform restaurants at all", async () => {
    const res = await request(app)
      .get("/api/v1/platform/restaurants")
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /platform/users — pagination/search/filter", () => {
  let searchTarget: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    searchTarget = await createTestUser("customer", undefined, {
      name: "Pagination Search Target",
      email: `pagination-search-${Date.now()}@test.local`,
    });
  });

  afterAll(async () => {
    await User.deleteOne({ _id: searchTarget._id });
  });

  it("search matches by name or email", async () => {
    const res = await request(app)
      .get(`/api/v1/platform/users?search=${encodeURIComponent(searchTarget.email)}`)
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].email).toBe(searchTarget.email);
  });

  it("role filter narrows to exactly that role", async () => {
    const res = await request(app)
      .get("/api/v1/platform/users?role=platform_admin")
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.every((u: { role: string }) => u.role === "platform_admin")).toBe(true);
  });

  it("isActive filter narrows correctly", async () => {
    const res = await request(app)
      .get("/api/v1/platform/users?isActive=false")
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.every((u: { isActive: boolean }) => u.isActive === false)).toBe(true);
  });

  it("rejects an out-of-range limit", async () => {
    const res = await request(app)
      .get("/api/v1/platform/users?limit=0")
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(400);
  });

  it("a restaurant owner cannot list platform users at all", async () => {
    const res = await request(app).get("/api/v1/platform/users").set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(403);
  });
});

describe("PATCH /platform/restaurants/:id/status", () => {
  it("requires platform_admin — a restaurant owner cannot suspend any restaurant, including their own", async () => {
    const res = await request(app)
      .patch(`/api/v1/platform/restaurants/${restaurantA.id}/status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status: "suspended" });
    expect(res.status).toBe(403);
  });

  it("suspending a restaurant immediately makes its storefront/ordering unavailable, and reactivating restores it", async () => {
    const suspend = await request(app)
      .patch(`/api/v1/platform/restaurants/${restaurantA.id}/status`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ status: "suspended" });
    expect(suspend.status).toBe(200);
    expect(suspend.body.data.restaurant.status).toBe("suspended");

    // The existing by-slug/createOrder "status: active" filters (unchanged since Phase 1) are
    // what actually enforces this — this endpoint is only the missing admin action on top.
    const bySlug = await request(app).get(`/api/v1/restaurants/by-slug/${restaurantA.slug}`);
    expect(bySlug.status).toBe(404);

    const orderAttempt = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ orderType: "pickup", items: [{ menuItemId: menuItemA.id, quantity: 1, selectedModifiers: [] }] });
    expect(orderAttempt.status).toBe(404);

    const reactivate = await request(app)
      .patch(`/api/v1/platform/restaurants/${restaurantA.id}/status`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ status: "active" });
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.data.restaurant.status).toBe("active");

    const bySlugAfter = await request(app).get(`/api/v1/restaurants/by-slug/${restaurantA.slug}`);
    expect(bySlugAfter.status).toBe(200);
  });

  it("rejects an invalid status value", async () => {
    const res = await request(app)
      .patch(`/api/v1/platform/restaurants/${restaurantA.id}/status`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ status: "deleted" });
    expect(res.status).toBe(400);
  });

  it("records an audit event on the target restaurant", async () => {
    await request(app)
      .patch(`/api/v1/platform/restaurants/${restaurantA.id}/status`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ status: "suspended" });

    const entry = await AuditLog.findOne({ restaurantId: restaurantA._id, action: "restaurant.status_changed" }).sort({
      createdAt: -1,
    });
    expect(entry).not.toBeNull();
    expect(entry!.targetType).toBe("restaurant");
    expect((entry!.metadata as { to: string }).to).toBe("suspended");

    // Leave the restaurant active for any other test in this file that runs after this one.
    await request(app)
      .patch(`/api/v1/platform/restaurants/${restaurantA.id}/status`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ status: "active" });
  });
});

describe("PATCH /platform/users/:id/status", () => {
  it("requires platform_admin", async () => {
    const res = await request(app)
      .patch(`/api/v1/platform/users/${customerId}/status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(403);
  });

  it("a platform_admin cannot deactivate their own account", async () => {
    const res = await request(app)
      .patch(`/api/v1/platform/users/${platformAdminId}/status`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(400);
  });

  it("deactivating a user immediately blocks them from logging in, and reactivating restores login", async () => {
    const staff = await createTestUser("restaurant_staff", restaurantA._id, { email: `platform-toggle-${Date.now()}@test.local` });

    const deactivate = await request(app)
      .patch(`/api/v1/platform/users/${staff.id}/status`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ isActive: false });
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.data.user.isActive).toBe(false);

    const loginAttempt = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: staff.email, password: "Password123!" });
    expect(loginAttempt.status).toBe(403);

    const reactivate = await request(app)
      .patch(`/api/v1/platform/users/${staff.id}/status`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ isActive: true });
    expect(reactivate.status).toBe(200);

    const loginAfter = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: staff.email, password: "Password123!" });
    expect(loginAfter.status).toBe(200);

    await User.deleteOne({ _id: staff._id });
  });

  it("records an audit event scoped to the user's own restaurant", async () => {
    const staff = await createTestUser("restaurant_staff", restaurantA._id, { email: `platform-audit-${Date.now()}@test.local` });

    await request(app)
      .patch(`/api/v1/platform/users/${staff.id}/status`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ isActive: false });

    const entry = await AuditLog.findOne({ restaurantId: restaurantA._id, action: "user.status_changed", targetId: staff._id });
    expect(entry).not.toBeNull();
    expect(entry!.targetType).toBe("user");

    await User.deleteOne({ _id: staff._id });
  });

  it("a customer (no restaurant) can still be deactivated, without requiring a restaurant to attach an audit entry to", async () => {
    const looseCustomer = await createTestUser("customer");
    const res = await request(app)
      .patch(`/api/v1/platform/users/${looseCustomer.id}/status`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.user.isActive).toBe(false);
    await User.deleteOne({ _id: looseCustomer._id });
  });
});

describe("POST /platform/restaurants/:id/resend-owner-invite (Phase 14)", () => {
  it("regenerates the invite token (invalidating the old one) and reports ownerInvitePending in the list", async () => {
    const pendingOwner = await createTestUser("restaurant_owner", undefined, {
      email: `resend-${Date.now()}@test.local`,
      inviteTokenHash: "old-hash-value",
      inviteExpiresAt: new Date(Date.now() + 60_000),
    });
    const pendingRestaurant = await createTestRestaurant({ status: "pending", ownerId: pendingOwner._id });
    await User.findByIdAndUpdate(pendingOwner._id, { $set: { restaurantId: pendingRestaurant._id } });

    const listBefore = await request(app)
      .get(`/api/v1/platform/restaurants?search=${encodeURIComponent(pendingRestaurant.slug)}`)
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(listBefore.body.data.total).toBe(1);
    expect(listBefore.body.data.items[0].ownerInvitePending).toBe(true);

    const resend = await request(app)
      .post(`/api/v1/platform/restaurants/${pendingRestaurant.id}/resend-owner-invite`)
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(resend.status).toBe(200);

    const updated = await User.findById(pendingOwner._id);
    expect(updated!.inviteTokenHash).not.toBe("old-hash-value");

    const entry = await AuditLog.findOne({
      restaurantId: pendingRestaurant._id,
      action: "restaurant.owner_invite_resent",
    });
    expect(entry).not.toBeNull();

    await User.deleteOne({ _id: pendingOwner._id });
    await Restaurant.deleteOne({ _id: pendingRestaurant._id });
  });

  it("refuses once the owner has already accepted their invitation", async () => {
    const acceptedOwner = await createTestUser("restaurant_owner");
    const restaurant = await createTestRestaurant({ ownerId: acceptedOwner._id });
    await User.findByIdAndUpdate(acceptedOwner._id, { $set: { restaurantId: restaurant._id } });

    const res = await request(app)
      .post(`/api/v1/platform/restaurants/${restaurant.id}/resend-owner-invite`)
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(400);

    await User.deleteOne({ _id: acceptedOwner._id });
    await Restaurant.deleteOne({ _id: restaurant._id });
  });

  it("requires platform_admin", async () => {
    const res = await request(app)
      .post(`/api/v1/platform/restaurants/${restaurantA.id}/resend-owner-invite`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(403);
  });
});
