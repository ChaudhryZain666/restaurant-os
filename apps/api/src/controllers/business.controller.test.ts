import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Restaurant } from "../models/Restaurant.js";
import { Business } from "../models/Business.js";
import { User } from "../models/User.js";
import { findDuplicateRestaurantOwners } from "../services/businessLocationMigration.service.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
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

describe("GET /businesses/:businessId/locations/:locationId (Phase 18/19) — requireTenantMatch('locationId') end-to-end", () => {
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

describe("listBusinessLocations staff-visibility fix (Phase 19)", () => {
  it("staff scoped to only A1 sees just A1 in the list, not sibling A2", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${businessA.id}/locations`)
      .set("Authorization", `Bearer ${staffA1OnlyToken}`);
    expect(res.status).toBe(200);
    const names = (res.body.data.locations as Array<{ name: string }>).map((l) => l.name);
    expect(names).toEqual(["Location A1"]);
  });

  it("manager still sees every location under the business (unchanged)", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${businessA.id}/locations`)
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.locations).toHaveLength(2);
  });
});

describe("requireTenantMatch's businessId fallback reaches REAL restaurant-scoped routes (Phase 19)", () => {
  it("a manager can operate Location A2 (their business's second location) through the real orders route, not just the /businesses proof routes", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${locationA2.id}/orders`)
      .set("Authorization", `Bearer ${managerAToken}`);
    // 200 with an empty list is the correct "reached and authorized" signal here — the important
    // thing is NOT 403, proving requireTenantMatch's businessId fallback actually works on a route
    // nobody added any new logic to.
    expect(res.status).toBe(200);
  });

  it("the owner can update Location A2's settings through the real, permission-gated PATCH route", async () => {
    // Owner, not manager: restaurant.settings.manage is owner-only (restaurant_manager doesn't
    // hold it), so this proves requireTenantMatch's businessId fallback correctly stacks with an
    // UNRELATED, unchanged permission check on a real route — not just tenant-match in isolation.
    const res = await request(app)
      .patch(`/api/v1/restaurants/${locationA2.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ description: "Updated via Phase 19 business-wide access test" });
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.description).toBe("Updated via Phase 19 business-wide access test");
  });

  it("a manager CANNOT update Location A2's settings — requireTenantMatch grants tenant access, but restaurant.settings.manage is still owner-only (unrelated permission check, unchanged)", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${locationA2.id}`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ description: "Should not be allowed" });
    expect(res.status).toBe(403);
  });

  it("staff scoped only to A1 is still denied on A2's real orders route (no accidental business-wide grant for staff)", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${locationA2.id}/orders`)
      .set("Authorization", `Bearer ${staffA1OnlyToken}`);
    expect(res.status).toBe(403);
  });

  it("business B's owner is still denied on business A's location through a real route (cross-business isolation preserved)", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${locationA1.id}/orders`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });
});

describe("POST /businesses/:businessId/locations (Phase 19) — owner-facing location creation", () => {
  const cleanupIds: string[] = [];

  afterAll(async () => {
    await Restaurant.deleteMany({ _id: { $in: cleanupIds } });
  });

  it("owner can create a second location under their own business, no new owner/user created", async () => {
    const slug = `owner-created-loc-${Date.now()}`;
    const res = await request(app)
      .post(`/api/v1/businesses/${businessA.id}/locations`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Owner-Created Location", slug });

    expect(res.status).toBe(201);
    cleanupIds.push(res.body.data.restaurant.id);
    expect(res.body.data.restaurant.businessId).toBe(businessA.id);
    expect(res.body.data.restaurant.ownerId).toBe(businessA.ownerId.toString());

    const userCount = await User.countDocuments({ restaurantId: res.body.data.restaurant.id });
    expect(userCount).toBe(0);
  });

  it("manager cannot create a location (restaurant.settings.manage is owner-only)", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${businessA.id}/locations`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ name: "Should Fail", slug: `should-fail-${Date.now()}` });
    expect(res.status).toBe(403);
  });

  it("staff cannot create a location", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${businessA.id}/locations`)
      .set("Authorization", `Bearer ${staffA1OnlyToken}`)
      .send({ name: "Should Fail", slug: `should-fail-staff-${Date.now()}` });
    expect(res.status).toBe(403);
  });

  it("business B's owner cannot create a location under business A", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${businessA.id}/locations`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ name: "Should Fail", slug: `should-fail-cross-${Date.now()}` });
    expect(res.status).toBe(403);
  });

  it("rejects a duplicate slug", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${businessA.id}/locations`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Dupe", slug: locationA1.slug });
    expect(res.status).toBe(409);
  });

  it("404s for a businessId that has no corresponding Business document (defensive check — requireBusinessMatch alone can't catch an orphaned reference)", async () => {
    // platform_admin can't reach this: requireBusinessMatch exempts them, but the unrelated,
    // unchanged requirePermission("restaurant.settings.manage") check right after does not (a
    // platform_admin doesn't hold restaurant-scoped permissions), so they 403 before ever reaching
    // the controller. The only way to actually exercise the controller's own Business.findById
    // check is a caller whose OWN businessId (matching requireBusinessMatch) points at a Business
    // that doesn't exist — an orphaned-reference edge case nothing in the app can normally create
    // today (Business documents are never deleted), but the check exists defensively.
    const orphanedBusinessId = new mongoose.Types.ObjectId();
    const orphanedOwner = await createTestUser("restaurant_owner", undefined, { businessId: orphanedBusinessId });
    const orphanedOwnerToken = tokenFor(orphanedOwner);
    try {
      const res = await request(app)
        .post(`/api/v1/businesses/${orphanedBusinessId.toString()}/locations`)
        .set("Authorization", `Bearer ${orphanedOwnerToken}`)
        .send({ name: "Ghost", slug: `ghost-${Date.now()}` });
      expect(res.status).toBe(404);
    } finally {
      await User.deleteOne({ _id: orphanedOwner._id });
    }
  });
});

describe("POST /businesses/:businessId/locations — cloneFromLocationId (Phase 19)", () => {
  const cleanupRestaurantIds: mongoose.Types.ObjectId[] = [];

  afterAll(async () => {
    await Category.deleteMany({ restaurantId: { $in: cleanupRestaurantIds } });
    await MenuItem.deleteMany({ restaurantId: { $in: cleanupRestaurantIds } });
    await ModifierGroup.deleteMany({ restaurantId: { $in: cleanupRestaurantIds } });
    await Restaurant.deleteMany({ _id: { $in: cleanupRestaurantIds } });
  });

  it("copies A1's menu into a brand-new location as fully independent documents", async () => {
    const category = await createTestCategory(locationA1._id, { name: "Clone Test Category" });
    const item = await createTestMenuItem(locationA1._id, category._id, { name: "Clone Test Item", price: 12.5 });
    await createTestModifierGroup(locationA1._id, item._id, {
      name: "Clone Test Modifiers",
      options: [{ name: "Extra cheese", priceAdjustment: 1.5, isActive: true, sortOrder: 0 }],
    });

    const slug = `cloned-location-${Date.now()}`;
    const res = await request(app)
      .post(`/api/v1/businesses/${businessA.id}/locations`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Cloned Location", slug, cloneFromLocationId: locationA1.id });

    expect(res.status).toBe(201);
    const newRestaurantId = new mongoose.Types.ObjectId(res.body.data.restaurant.id);
    cleanupRestaurantIds.push(newRestaurantId);

    const clonedCategory = await Category.findOne({ restaurantId: newRestaurantId, name: "Clone Test Category" });
    expect(clonedCategory).not.toBeNull();
    expect(clonedCategory!._id.toString()).not.toBe(category._id.toString());

    const clonedItem = await MenuItem.findOne({ restaurantId: newRestaurantId, name: "Clone Test Item" });
    expect(clonedItem).not.toBeNull();
    expect(clonedItem!.price).toBe(12.5);
    expect(clonedItem!.categoryId.toString()).toBe(clonedCategory!._id.toString());

    const clonedGroup = await ModifierGroup.findOne({ restaurantId: newRestaurantId, name: "Clone Test Modifiers" });
    expect(clonedGroup).not.toBeNull();
    expect(clonedGroup!.menuItemId.toString()).toBe(clonedItem!._id.toString());
    expect(clonedGroup!.options[0].name).toBe("Extra cheese");

    // Provenance fields are set but select:false by default — must explicitly select them.
    const clonedItemWithProvenance = await MenuItem.findById(clonedItem!._id).select("+clonedFromMenuItemId");
    expect(clonedItemWithProvenance!.clonedFromMenuItemId?.toString()).toBe(item._id.toString());

    // Editing the clone must never affect the source (fully independent, no ongoing sync).
    await MenuItem.findByIdAndUpdate(clonedItem!._id, { price: 99 });
    const sourceStillUnchanged = await MenuItem.findById(item._id);
    expect(sourceStillUnchanged!.price).toBe(12.5);
  });

  it("rejects a cloneFromLocationId that doesn't belong to the same business (never clones a stranger's menu)", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${businessA.id}/locations`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Should Fail", slug: `clone-cross-business-${Date.now()}`, cloneFromLocationId: locationB1.id });
    expect(res.status).toBe(400);
  });

  it("creating a location with no menu to clone from still succeeds with an empty menu (the default, unaffected by this feature)", async () => {
    const slug = `no-clone-location-${Date.now()}`;
    const res = await request(app)
      .post(`/api/v1/businesses/${businessA.id}/locations`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "No Clone Location", slug });
    expect(res.status).toBe(201);
    const newRestaurantId = new mongoose.Types.ObjectId(res.body.data.restaurant.id);
    cleanupRestaurantIds.push(newRestaurantId);
    const itemCount = await MenuItem.countDocuments({ restaurantId: newRestaurantId });
    expect(itemCount).toBe(0);
  });
});

describe("POST /businesses/self-serve (Phase 37) — individual owner self-provisioning", () => {
  const cleanupUserIds: mongoose.Types.ObjectId[] = [];
  const cleanupBusinessIds: mongoose.Types.ObjectId[] = [];
  const cleanupRestaurantIds: mongoose.Types.ObjectId[] = [];

  afterAll(async () => {
    await Restaurant.deleteMany({ _id: { $in: cleanupRestaurantIds } });
    await Business.deleteMany({ _id: { $in: cleanupBusinessIds } });
    await User.deleteMany({ _id: { $in: cleanupUserIds } });
  });

  it("a verified customer becomes the real owner of a brand-new business + restaurant", async () => {
    const customer = await createTestUser("customer", undefined, { emailVerifiedAt: new Date() });
    cleanupUserIds.push(customer._id);
    const token = tokenFor(customer);
    const slug = `selfserve-${Date.now()}`;

    const res = await request(app)
      .post("/api/v1/businesses/self-serve")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My First Restaurant", slug });

    expect(res.status).toBe(201);
    cleanupBusinessIds.push(new mongoose.Types.ObjectId(res.body.data.business.id));
    cleanupRestaurantIds.push(new mongoose.Types.ObjectId(res.body.data.restaurant.id));

    expect(res.body.data.business.ownerId).toBe(customer.id);
    expect(res.body.data.restaurant.businessId).toBe(res.body.data.business.id);
    expect(res.body.data.restaurant.ownerId).toBe(customer.id);
    // A brand-new restaurant must never be publicly orderable before its owner sets anything up.
    expect(res.body.data.restaurant.status).toBe("pending");

    const storedUser = await User.findById(customer._id);
    expect(storedUser!.role).toBe("restaurant_owner");
    expect(storedUser!.businessId?.toString()).toBe(res.body.data.business.id);
    expect(storedUser!.restaurantId?.toString()).toBe(res.body.data.restaurant.id);
  });

  it("rejects an unverified email — the platform must not provision real ownership structure before email ownership is confirmed", async () => {
    const customer = await createTestUser("customer"); // emailVerifiedAt left unset
    cleanupUserIds.push(customer._id);
    const token = tokenFor(customer);

    const res = await request(app)
      .post("/api/v1/businesses/self-serve")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Should Fail", slug: `unverified-${Date.now()}` });

    expect(res.status).toBe(403);
    const stillNoBusiness = await User.findById(customer._id);
    expect(stillNoBusiness!.businessId).toBeUndefined();
  });

  it("rejects a caller who already has a business — this is a create-my-FIRST-business endpoint, not a re-provisioning one", async () => {
    const res = await request(app)
      .post("/api/v1/businesses/self-serve")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Should Fail", slug: `already-has-one-${Date.now()}` });
    expect(res.status).toBe(409);
  });

  it("rejects a duplicate slug and creates nothing (no orphaned Business left behind)", async () => {
    const customer = await createTestUser("customer", undefined, { emailVerifiedAt: new Date() });
    cleanupUserIds.push(customer._id);
    const token = tokenFor(customer);

    const res = await request(app)
      .post("/api/v1/businesses/self-serve")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Dupe", slug: locationA1.slug });

    expect(res.status).toBe(409);
    const orphanedBusiness = await Business.findOne({ ownerId: customer._id });
    expect(orphanedBusiness).toBeNull();
    const storedUser = await User.findById(customer._id);
    expect(storedUser!.businessId).toBeUndefined();
  });
});
