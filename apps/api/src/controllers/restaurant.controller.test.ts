import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let platformAdminToken: string;
let ownerAToken: string;
let managerAToken: string;
let staffAToken: string;
let ownerBToken: string;
let unassignedUserId: string;
let platformAdminId: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant({
    settings: { currency: "USD", taxRate: 0.05, orderingEnabled: true, pickupEnabled: true, deliveryEnabled: false },
  });
  restaurantB = await createTestRestaurant();

  const platformAdmin = await createTestUser("platform_admin");
  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const managerA = await createTestUser("restaurant_manager", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  const unassignedUser = await createTestUser("customer");

  platformAdminToken = tokenFor(platformAdmin);
  ownerAToken = tokenFor(ownerA);
  managerAToken = tokenFor(managerA);
  staffAToken = tokenFor(staffA);
  ownerBToken = tokenFor(ownerB);
  unassignedUserId = unassignedUser.id;
  platformAdminId = platformAdmin.id;
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  // Scoped to this file's own fixtures only — a bare `{ role: "platform_admin" }` filter here
  // would delete every platform admin in the database, including the seeded
  // platform-admin@restaurant.local account (this happened; it's what this comment is guarding
  // against — see the Phase 1 audit report for how it was caught).
  await User.deleteMany({
    $or: [{ restaurantId: { $in: ids } }, { _id: { $in: [unassignedUserId, platformAdminId] } }],
  });
  await Restaurant.deleteMany({ _id: { $in: ids } });
  await closeTestConnections();
});

describe("restaurant creation", () => {
  it("platform_admin can create a restaurant and it upgrades the owner", async () => {
    const res = await request(app)
      .post("/api/v1/restaurants")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ name: "New Place", slug: `new-place-${Date.now()}`, ownerId: unassignedUserId });

    expect(res.status).toBe(201);
    expect(res.body.data.restaurant.ownerId).toBe(unassignedUserId);

    const owner = await User.findById(unassignedUserId);
    expect(owner!.role).toBe("restaurant_owner");
    expect(owner!.restaurantId!.toString()).toBe(res.body.data.restaurant.id);

    await Restaurant.deleteOne({ _id: res.body.data.restaurant.id });
  });

  it("rejects a duplicate slug", async () => {
    const res = await request(app)
      .post("/api/v1/restaurants")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ name: "Dupe", slug: restaurantA.slug, ownerId: unassignedUserId });

    expect(res.status).toBe(409);
  });

  it("a non-platform_admin cannot create a restaurant", async () => {
    const res = await request(app)
      .post("/api/v1/restaurants")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Should fail", slug: `should-fail-${Date.now()}`, ownerId: unassignedUserId });

    expect(res.status).toBe(403);
  });
});

describe("restaurant retrieval", () => {
  it("anyone can look up an active restaurant by slug", async () => {
    const res = await request(app).get(`/api/v1/restaurants/by-slug/${restaurantA.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.id).toBe(restaurantA.id);
  });

  it("the owner can fetch their own restaurant via /me", async () => {
    const res = await request(app).get("/api/v1/restaurants/me").set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.id).toBe(restaurantA.id);
  });
});

describe("restaurant settings update (OWNER-only operation)", () => {
  it("owner can update settings, and a partial settings update does not wipe untouched fields", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ settings: { deliveryEnabled: true } });

    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.settings.deliveryEnabled).toBe(true);
    // Untouched settings fields survive the partial update.
    expect(res.body.data.restaurant.settings.currency).toBe("USD");
    expect(res.body.data.restaurant.settings.taxRate).toBe(0.05);
  });

  it("manager cannot update settings (restaurant.settings.manage is owner-only)", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ name: "Manager Renamed" });

    expect(res.status).toBe(403);
  });

  it("staff cannot update settings", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ name: "Staff Renamed" });

    expect(res.status).toBe(403);
  });

  it("restaurant B's owner cannot update restaurant A's settings", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ name: "Hostile Takeover" });

    expect(res.status).toBe(403);

    const stored = await Restaurant.findById(restaurantA._id);
    expect(stored!.name).not.toBe("Hostile Takeover");
  });

  it("cannot change ownerId, slug, or status via the update body", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ ownerId: unassignedUserId, slug: "hijacked-slug", status: "suspended" });

    expect(res.status).toBe(200); // request succeeds — those fields are just silently not there
    const stored = await Restaurant.findById(restaurantA._id);
    expect(stored!.slug).toBe(restaurantA.slug);
    expect(stored!.status).toBe("active");
    expect(stored!.ownerId.toString()).not.toBe(unassignedUserId);
  });
});
