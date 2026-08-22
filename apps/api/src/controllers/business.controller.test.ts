import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Restaurant } from "../models/Restaurant.js";
import { Business } from "../models/Business.js";
import { User } from "../models/User.js";
import { findDuplicateRestaurantOwners } from "../services/businessLocationMigration.service.js";
import { closeTestConnections, createTestBusiness, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

// businessA has two locations (locationA1, locationA2); businessB is a completely separate
// business with its own single location, used to prove cross-business isolation.
let businessA: Awaited<ReturnType<typeof createTestBusiness>>;
let locationA1: Awaited<ReturnType<typeof createTestRestaurant>>;
let locationA2: Awaited<ReturnType<typeof createTestRestaurant>>;
let businessB: Awaited<ReturnType<typeof createTestBusiness>>;
let locationB1: Awaited<ReturnType<typeof createTestRestaurant>>;

let ownerAToken: string; // businessId=A, no locationIds — implicit access to A1 and A2
let managerAToken: string; // businessId=A, no locationIds — implicit access to A1 and A2
let staffA1OnlyToken: string; // businessId=A, locationIds=[A1] — explicit, A2 must be denied
let ownerBToken: string; // businessId=B — must never reach anything under business A
let platformAdminToken: string;

beforeAll(async () => {
  await connectDB();

  businessA = await createTestBusiness({ name: "Business A" });
  locationA1 = await createTestRestaurant({ name: "Location A1", businessId: businessA._id, ownerId: businessA.ownerId });
  locationA2 = await createTestRestaurant({ name: "Location A2", businessId: businessA._id, ownerId: businessA.ownerId });

  businessB = await createTestBusiness({ name: "Business B" });
  locationB1 = await createTestRestaurant({ name: "Location B1", businessId: businessB._id, ownerId: businessB.ownerId });

  const ownerA = await createTestUser("restaurant_owner", locationA1._id, { businessId: businessA._id });
  const managerA = await createTestUser("restaurant_manager", locationA1._id, { businessId: businessA._id });
  const staffA1Only = await createTestUser("restaurant_staff", locationA1._id, {
    businessId: businessA._id,
    locationIds: [locationA1._id],
  });
  const ownerB = await createTestUser("restaurant_owner", locationB1._id, { businessId: businessB._id });
  const platformAdmin = await createTestUser("platform_admin");

  ownerAToken = tokenFor(ownerA);
  managerAToken = tokenFor(managerA);
  staffA1OnlyToken = tokenFor(staffA1Only);
  ownerBToken = tokenFor(ownerB);
  platformAdminToken = tokenFor(platformAdmin);
});

afterAll(async () => {
  const restaurantIds = [locationA1._id, locationA2._id, locationB1._id];
  const businessIds = [businessA._id, businessB._id];
  await User.deleteMany({ $or: [{ restaurantId: { $in: restaurantIds } }, { businessId: { $in: businessIds } }] });
  await Restaurant.deleteMany({ _id: { $in: restaurantIds } });
  await Business.deleteMany({ _id: { $in: businessIds } });
  await closeTestConnections();
});

describe("GET /businesses/me (Phase 18)", () => {
  it("returns the caller's own business", async () => {
    const res = await request(app).get("/api/v1/businesses/me").set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.business.id).toBe(businessA.id);
  });

  it("404s cleanly for an account with no businessId, rather than throwing", async () => {
    const noBusinessUser = await createTestUser("customer");
    const token = tokenFor(noBusinessUser);
    const res = await request(app).get("/api/v1/businesses/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    await User.deleteOne({ _id: noBusinessUser._id });
  });
});

describe("GET /businesses/:businessId/locations (Phase 18)", () => {
  it("owner sees every location under their own business", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${businessA.id}/locations`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    const names = (res.body.data.locations as Array<{ name: string }>).map((l) => l.name).sort();
    expect(names).toEqual(["Location A1", "Location A2"]);
  });

  it("business B's owner cannot list business A's locations (cross-business isolation)", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${businessA.id}/locations`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });

  it("platform_admin can list any business's locations", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${businessA.id}/locations`)
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.locations).toHaveLength(2);
  });
});

describe("GET /businesses/:businessId/locations/:locationId (Phase 18) — requireLocationAccess end-to-end", () => {
  it("owner (implicit business-wide access) can view either of their business's locations", async () => {
    const resA1 = await request(app)
      .get(`/api/v1/businesses/${businessA.id}/locations/${locationA1.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(resA1.status).toBe(200);
    expect(resA1.body.data.location.id).toBe(locationA1.id);

    const resA2 = await request(app)
      .get(`/api/v1/businesses/${businessA.id}/locations/${locationA2.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(resA2.status).toBe(200);
    expect(resA2.body.data.location.id).toBe(locationA2.id);
  });

  it("manager (implicit business-wide access) can view either location too", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${businessA.id}/locations/${locationA2.id}`)
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(res.status).toBe(200);
  });

  it("staff explicitly scoped to only A1 can view A1", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${businessA.id}/locations/${locationA1.id}`)
      .set("Authorization", `Bearer ${staffA1OnlyToken}`);
    expect(res.status).toBe(200);
  });

  it("staff explicitly scoped to only A1 CANNOT view A2, even though it's the same business (no implicit business-wide access for staff)", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${businessA.id}/locations/${locationA2.id}`)
      .set("Authorization", `Bearer ${staffA1OnlyToken}`);
    expect(res.status).toBe(403);
  });

  it("business B's owner cannot view any of business A's locations", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${businessA.id}/locations/${locationA1.id}`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });

  it("platform_admin can view any location", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${businessA.id}/locations/${locationA1.id}`)
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(200);
  });

  it("a malformed locationId is denied, not a 500", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${businessA.id}/locations/not-a-real-object-id`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(403);
  });

  it("a locationId that doesn't actually belong to the businessId in the URL 404s (internal URL consistency check)", async () => {
    // platform_admin bypasses requireLocationAccess entirely, so this exercises the controller's
    // own belt-and-suspenders check that locationId truly belongs to businessId.
    const res = await request(app)
      .get(`/api/v1/businesses/${businessB.id}/locations/${locationA1.id}`)
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(404);
  });
});

describe("migration pre-flight duplicate-owner guard (Phase 18)", () => {
  it("findDuplicateRestaurantOwners detects an ownerId reused across more than one Restaurant", async () => {
    const sharedOwnerId = new mongoose.Types.ObjectId();
    const dupeR1 = await createTestRestaurant({ ownerId: sharedOwnerId });
    const dupeR2 = await createTestRestaurant({ ownerId: sharedOwnerId });
    try {
      const duplicates = await findDuplicateRestaurantOwners();
      expect(duplicates.map((id) => id.toString())).toContain(sharedOwnerId.toString());
    } finally {
      await Restaurant.deleteMany({ _id: { $in: [dupeR1._id, dupeR2._id] } });
    }
  });

  it("does not flag ordinary, non-duplicated ownerIds", async () => {
    const duplicates = await findDuplicateRestaurantOwners();
    expect(duplicates.map((id) => id.toString())).not.toContain(locationA1.ownerId!.toString());
  });
});
