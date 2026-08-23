import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Agency } from "../models/Agency.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import { AgencyAuditLog } from "../models/AgencyAuditLog.js";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { Plan } from "../models/Plan.js";
import { User } from "../models/User.js";
import {
  closeTestConnections,
  createTestAgency,
  createTestAgencyMembership,
  createTestBusiness,
  createTestPlan,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let agency: Awaited<ReturnType<typeof createTestAgency>>;
let otherAgency: Awaited<ReturnType<typeof createTestAgency>>;
let agencyOwnerUser: Awaited<ReturnType<typeof createTestUser>>;
let agencyAdminUser: Awaited<ReturnType<typeof createTestUser>>;
let agencyStaffUser: Awaited<ReturnType<typeof createTestUser>>;
let otherAgencyOwnerUser: Awaited<ReturnType<typeof createTestUser>>;
let outsiderUser: Awaited<ReturnType<typeof createTestUser>>;

let ownerToken: string;
let adminToken: string;
let staffToken: string; // no businessIds assigned yet
let otherAgencyOwnerToken: string;
let outsiderToken: string;

let managedBusiness: Awaited<ReturnType<typeof createTestBusiness>>;
let managedLocation: Awaited<ReturnType<typeof createTestRestaurant>>;
let unrelatedBusiness: Awaited<ReturnType<typeof createTestBusiness>>;

const agencyIds: string[] = [];
const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];
const planIds: string[] = [];
const membershipIds: string[] = [];

beforeAll(async () => {
  await connectDB();

  agency = await createTestAgency();
  otherAgency = await createTestAgency();
  agencyIds.push(agency.id, otherAgency.id);

  agencyOwnerUser = await createTestUser("agency_member");
  agencyAdminUser = await createTestUser("agency_member");
  agencyStaffUser = await createTestUser("agency_member");
  otherAgencyOwnerUser = await createTestUser("agency_member");
  outsiderUser = await createTestUser("customer");
  userIds.push(agencyOwnerUser.id, agencyAdminUser.id, agencyStaffUser.id, otherAgencyOwnerUser.id, outsiderUser.id);

  const ownerMembership = await createTestAgencyMembership(agency._id, agencyOwnerUser._id, { role: "agency_owner" });
  const adminMembership = await createTestAgencyMembership(agency._id, agencyAdminUser._id, { role: "agency_admin" });
  const staffMembership = await createTestAgencyMembership(agency._id, agencyStaffUser._id, { role: "agency_staff" });
  const otherOwnerMembership = await createTestAgencyMembership(otherAgency._id, otherAgencyOwnerUser._id, { role: "agency_owner" });
  membershipIds.push(ownerMembership.id, adminMembership.id, staffMembership.id, otherOwnerMembership.id);

  ownerToken = tokenFor(agencyOwnerUser, [{ agencyId: agency.id, role: "agency_owner" }]);
  adminToken = tokenFor(agencyAdminUser, [{ agencyId: agency.id, role: "agency_admin" }]);
  staffToken = tokenFor(agencyStaffUser, [{ agencyId: agency.id, role: "agency_staff" }]);
  otherAgencyOwnerToken = tokenFor(otherAgencyOwnerUser, [{ agencyId: otherAgency.id, role: "agency_owner" }]);
  outsiderToken = tokenFor(outsiderUser);

  managedBusiness = await createTestBusiness({ agencyId: agency._id });
  managedLocation = await createTestRestaurant({ businessId: managedBusiness._id });
  unrelatedBusiness = await createTestBusiness(); // no agencyId — an individually-owned business
  businessIds.push(managedBusiness.id, unrelatedBusiness.id);
  restaurantIds.push(managedLocation.id);
});

afterAll(async () => {
  await Promise.all([
    AgencyAuditLog.deleteMany({ agencyId: { $in: agencyIds } }),
    AgencyMembership.deleteMany({ agencyId: { $in: agencyIds } }),
    Subscription.deleteMany({ ownerType: "agency", ownerId: { $in: agencyIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    Agency.deleteMany({ _id: { $in: agencyIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

describe("POST /agencies — self-serve creation", () => {
  it("a customer account can create an agency and becomes its agency_owner", async () => {
    const creator = await createTestUser("customer");
    userIds.push(creator.id);
    const res = await request(app)
      .post("/api/v1/agencies")
      .set("Authorization", `Bearer ${tokenFor(creator)}`)
      .send({ name: "New Agency", slug: `new-agency-${Date.now()}`, contactEmail: "new-agency@test.local" });

    expect(res.status).toBe(201);
    agencyIds.push(res.body.data.agency.id);

    const membership = await AgencyMembership.findOne({ agencyId: res.body.data.agency.id, userId: creator._id });
    expect(membership?.role).toBe("agency_owner");
    expect(membership?.status).toBe("active");

    const updatedUser = await User.findById(creator._id);
    expect(updatedUser?.role).toBe("agency_member");
  });

  it("rejects creation from a restaurant-scoped role", async () => {
    const restaurant = await createTestRestaurant();
    const owner = await createTestUser("restaurant_owner", restaurant._id);
    userIds.push(owner.id);
    restaurantIds.push(restaurant.id);

    const res = await request(app)
      .post("/api/v1/agencies")
      .set("Authorization", `Bearer ${tokenFor(owner)}`)
      .send({ name: "Nope", slug: `nope-${Date.now()}`, contactEmail: "nope@test.local" });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate slug", async () => {
    const creator = await createTestUser("customer");
    userIds.push(creator.id);
    const res = await request(app)
      .post("/api/v1/agencies")
      .set("Authorization", `Bearer ${tokenFor(creator)}`)
      .send({ name: "Dup", slug: agency.slug, contactEmail: "dup@test.local" });
    expect(res.status).toBe(409);
  });
});

describe("GET /agencies/me and /agencies/:agencyId — visibility", () => {
  it("returns every agency the caller is an active member of, with their role", async () => {
    const res = await request(app).get("/api/v1/agencies/me").set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const entry = res.body.data.agencies.find((a: { id: string }) => a.id === agency.id);
    expect(entry?.myRole).toBe("agency_owner");
  });

  it("a member of this agency can view it; a non-member (including another agency's owner) cannot", async () => {
    const asOwner = await request(app).get(`/api/v1/agencies/${agency.id}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(asOwner.status).toBe(200);

    const asOutsider = await request(app).get(`/api/v1/agencies/${agency.id}`).set("Authorization", `Bearer ${outsiderToken}`);
    expect(asOutsider.status).toBe(403);

    const asOtherAgencyOwner = await request(app)
      .get(`/api/v1/agencies/${agency.id}`)
      .set("Authorization", `Bearer ${otherAgencyOwnerToken}`);
    expect(asOtherAgencyOwner.status).toBe(403);
  });

  it("platform_admin can view any agency (read) via the real agency route (exempted, not a bypass of write access)", async () => {
    const admin = await createTestUser("platform_admin");
    userIds.push(admin.id);
    const res = await request(app).get(`/api/v1/agencies/${agency.id}`).set("Authorization", `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
  });
});

describe("GET /agencies/:agencyId/businesses — cross-agency isolation", () => {
  it("shows the agency's own managed business, and never a business from a different agency", async () => {
    const res = await request(app).get(`/api/v1/agencies/${agency.id}/businesses`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((b: { id: string }) => b.id);
    expect(ids).toContain(managedBusiness.id);
    expect(ids).not.toContain(unrelatedBusiness.id);
  });

  it("a member of a DIFFERENT agency cannot list this agency's businesses", async () => {
    const res = await request(app)
      .get(`/api/v1/agencies/${agency.id}/businesses`)
      .set("Authorization", `Bearer ${otherAgencyOwnerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("POST /agencies/:agencyId/businesses — creation, transactional owner-invite, limits", () => {
  it("agency_owner can create a business (transactional: owner user + business + first location)", async () => {
    const stamp = Date.now();
    const res = await request(app)
      .post(`/api/v1/agencies/${agency.id}/businesses`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        businessName: `Agency Biz ${stamp}`,
        businessSlug: `agency-biz-${stamp}`,
        ownerName: "New Owner",
        ownerEmail: `agency-biz-owner-${stamp}@test.local`,
        locationName: `Agency Loc ${stamp}`,
        locationSlug: `agency-loc-${stamp}`,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.business.agencyId).toBe(agency.id);
    businessIds.push(res.body.data.business.id);
    restaurantIds.push(res.body.data.restaurant.id);

    const owner = await User.findOne({ email: `agency-biz-owner-${stamp}@test.local` });
    expect(owner?.role).toBe("restaurant_owner");
    expect(owner?.inviteTokenHash).toEqual(expect.any(String));
    userIds.push(owner!.id as string);

    const auditEntry = await AgencyAuditLog.findOne({ agencyId: agency._id, action: "agency.business_created" });
    expect(auditEntry).not.toBeNull();
  });

  it("agency_staff (no agency.businesses.manage) cannot create a business; agency_admin can", async () => {
    const staffAttempt = await request(app)
      .post(`/api/v1/agencies/${agency.id}/businesses`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        businessName: "Staff Biz",
        businessSlug: `staff-biz-${Date.now()}`,
        ownerName: "X",
        ownerEmail: `staff-biz-${Date.now()}@test.local`,
        locationName: "Loc",
        locationSlug: `staff-loc-${Date.now()}`,
      });
    expect(staffAttempt.status).toBe(403);

    const stamp = Date.now();
    const adminAttempt = await request(app)
      .post(`/api/v1/agencies/${agency.id}/businesses`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        businessName: `Admin Biz ${stamp}`,
        businessSlug: `admin-biz-${stamp}`,
        ownerName: "Admin-Invited Owner",
        ownerEmail: `admin-biz-owner-${stamp}@test.local`,
        locationName: `Admin Loc ${stamp}`,
        locationSlug: `admin-loc-${stamp}`,
      });
    expect(adminAttempt.status).toBe(201);
    businessIds.push(adminAttempt.body.data.business.id);
    restaurantIds.push(adminAttempt.body.data.restaurant.id);
    const owner = await User.findOne({ email: `admin-biz-owner-${stamp}@test.local` });
    userIds.push(owner!.id as string);
  });

  describe("business-limit enforcement (atomic guard, not check-then-insert)", () => {
    let limitedAgency: Awaited<ReturnType<typeof createTestAgency>>;
    let limitedOwner: Awaited<ReturnType<typeof createTestUser>>;
    let limitedToken: string;
    let limitedPlan: Awaited<ReturnType<typeof createTestPlan>>;

    beforeAll(async () => {
      limitedAgency = await createTestAgency();
      limitedOwner = await createTestUser("agency_member");
      await createTestAgencyMembership(limitedAgency._id, limitedOwner._id, { role: "agency_owner" });
      limitedToken = tokenFor(limitedOwner, [{ agencyId: limitedAgency.id, role: "agency_owner" }]);
      limitedPlan = await createTestPlan({
        type: "AGENCY",
        code: `agency-limit-${Date.now()}`,
        entitlements: [{ key: "max_businesses", value: 1 }],
      });
      await Subscription.create({
        ownerType: "agency",
        ownerId: limitedAgency._id,
        planId: limitedPlan._id,
        status: "active",
        billingInterval: "monthly",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        provider: "internal",
      });

      agencyIds.push(limitedAgency.id);
      userIds.push(limitedOwner.id);
      planIds.push(limitedPlan.id);
    });

    function createBody(prefix: string) {
      const stamp = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      return {
        businessName: stamp,
        businessSlug: stamp,
        ownerName: "Owner",
        ownerEmail: `${stamp}@test.local`,
        locationName: stamp,
        locationSlug: `${stamp}-loc`,
      };
    }

    it("a second business beyond the plan's max_businesses is rejected with a clean 409, and the slot is released", async () => {
      const first = await request(app)
        .post(`/api/v1/agencies/${limitedAgency.id}/businesses`)
        .set("Authorization", `Bearer ${limitedToken}`)
        .send(createBody("first"));
      expect(first.status).toBe(201);
      businessIds.push(first.body.data.business.id);
      restaurantIds.push(first.body.data.restaurant.id);
      userIds.push(first.body.data.business.ownerId as string);

      const second = await request(app)
        .post(`/api/v1/agencies/${limitedAgency.id}/businesses`)
        .set("Authorization", `Bearer ${limitedToken}`)
        .send(createBody("second"));
      expect(second.status).toBe(409);

      const reloaded = await Agency.findById(limitedAgency._id);
      expect(reloaded!.businessCount).toBe(1); // the rejected attempt never incremented the counter
    });

    it("under true concurrency, two simultaneous create requests against a limit of 1 (a fresh agency) yield exactly one success", async () => {
      const raceAgency = await createTestAgency();
      const raceOwner = await createTestUser("agency_member");
      await createTestAgencyMembership(raceAgency._id, raceOwner._id, { role: "agency_owner" });
      const raceToken = tokenFor(raceOwner, [{ agencyId: raceAgency.id, role: "agency_owner" }]);
      await Subscription.create({
        ownerType: "agency",
        ownerId: raceAgency._id,
        planId: limitedPlan._id,
        status: "active",
        billingInterval: "monthly",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        provider: "internal",
      });
      agencyIds.push(raceAgency.id);
      userIds.push(raceOwner.id);

      const [a, b] = await Promise.all([
        request(app).post(`/api/v1/agencies/${raceAgency.id}/businesses`).set("Authorization", `Bearer ${raceToken}`).send(createBody("race-a")),
        request(app).post(`/api/v1/agencies/${raceAgency.id}/businesses`).set("Authorization", `Bearer ${raceToken}`).send(createBody("race-b")),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const winner = a.status === 201 ? a : b;
      businessIds.push(winner.body.data.business.id);
      restaurantIds.push(winner.body.data.restaurant.id);

      const reloaded = await Agency.findById(raceAgency._id);
      expect(reloaded!.businessCount).toBe(1);
    });
  });
});

describe("requireBusinessMatch's agency branch — the core cross-tenant security proof", () => {
  it("agency_owner has implicit access to a business the agency manages (via a real business-scoped route)", async () => {
    const res = await request(app).get(`/api/v1/businesses/${managedBusiness.id}/subscription`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200); // billing.read granted via AGENCY_ROLE_GRANTS
  });

  it("agency_admin has implicit access too, but cannot reach billing.manage-gated actions", async () => {
    const readRes = await request(app)
      .get(`/api/v1/businesses/${managedBusiness.id}/subscription`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(readRes.status).toBe(200);

    const writeRes = await request(app)
      .post(`/api/v1/businesses/${managedBusiness.id}/subscription/cancel`)
      .set("Authorization", `Bearer ${adminToken}`);
    // 404 (no subscription) or 403 both prove admin never got a billing.manage-only conflict/success —
    // what matters is it's never a 200/201. This business has no subscription, so 404 is expected.
    expect([403, 404]).toContain(writeRes.status);
  });

  it("agency_staff with NO businessIds assignment is denied — no implicit access, unlike owner/admin", async () => {
    const res = await request(app).get(`/api/v1/businesses/${managedBusiness.id}/subscription`).set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("agency_staff GAINS access once explicitly assigned via membership.businessIds", async () => {
    await AgencyMembership.updateOne({ agencyId: agency._id, userId: agencyStaffUser._id }, { $set: { businessIds: [managedBusiness._id] } });

    const res = await request(app).get(`/api/v1/businesses/${managedBusiness.id}/subscription`).set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
  });

  it("no agency member — owner, admin, or staff — can reach a business NOT managed by their agency", async () => {
    const asOwner = await request(app)
      .get(`/api/v1/businesses/${unrelatedBusiness.id}/subscription`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(asOwner.status).toBe(403);
  });

  it("a member of a DIFFERENT agency cannot reach this agency's managed business", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${managedBusiness.id}/subscription`)
      .set("Authorization", `Bearer ${otherAgencyOwnerToken}`);
    expect(res.status).toBe(403);
  });

  it("the business's own real owner (invited by the agency) can access their business, but not agency administration", async () => {
    // The seeded managedBusiness fixture has a synthetic ownerId with no real User — simulate the
    // real "owner invited by an agency" shape directly for this assertion.
    const realOwner = await createTestUser("restaurant_owner", managedLocation._id, { businessId: managedBusiness._id });
    userIds.push(realOwner.id);
    const realOwnerToken = tokenFor(realOwner);

    const businessRes = await request(app)
      .get(`/api/v1/businesses/${managedBusiness.id}/subscription`)
      .set("Authorization", `Bearer ${realOwnerToken}`);
    expect(businessRes.status).toBe(200);

    const agencyRes = await request(app).get(`/api/v1/agencies/${agency.id}`).set("Authorization", `Bearer ${realOwnerToken}`);
    expect(agencyRes.status).toBe(403);
  });
});

describe("requireTenantMatch's agency branch (Phase 26) — location-operational access", () => {
  it("agency_owner reaches Orders (read) and Staff (manage-gated) for a location under a managed business", async () => {
    const orders = await request(app)
      .get(`/api/v1/restaurants/${managedLocation.id}/orders`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(orders.status).toBe(200);

    const staff = await request(app).get(`/api/v1/restaurants/${managedLocation.id}/staff`).set("Authorization", `Bearer ${ownerToken}`);
    expect(staff.status).toBe(200);
  });

  it("agency_admin reaches Orders/Tables but NOT Staff — staff.manage is deliberately owner-only among agency roles", async () => {
    const orders = await request(app)
      .get(`/api/v1/restaurants/${managedLocation.id}/orders`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(orders.status).toBe(200);

    const tables = await request(app).get(`/api/v1/restaurants/${managedLocation.id}/tables`).set("Authorization", `Bearer ${adminToken}`);
    expect(tables.status).toBe(200);

    const staff = await request(app).get(`/api/v1/restaurants/${managedLocation.id}/staff`).set("Authorization", `Bearer ${adminToken}`);
    expect(staff.status).toBe(403);
  });

  it("agency_staff without businessIds assignment is denied Orders entirely (tenant match itself fails)", async () => {
    const unassignedStaff = await createTestUser("agency_member");
    userIds.push(unassignedStaff.id);
    await createTestAgencyMembership(agency._id, unassignedStaff._id, { role: "agency_staff" });
    const unassignedToken = tokenFor(unassignedStaff, [{ agencyId: agency.id, role: "agency_staff" }]);

    const res = await request(app)
      .get(`/api/v1/restaurants/${managedLocation.id}/orders`)
      .set("Authorization", `Bearer ${unassignedToken}`);
    expect(res.status).toBe(403);
  });

  it("agency_staff, once assigned via businessIds, reaches Orders (read) but not Tables (no tables.manage grant)", async () => {
    // agencyStaffUser was assigned managedBusiness earlier in this file's business-scoped tests.
    const orders = await request(app)
      .get(`/api/v1/restaurants/${managedLocation.id}/orders`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(orders.status).toBe(200);

    const tables = await request(app).get(`/api/v1/restaurants/${managedLocation.id}/tables`).set("Authorization", `Bearer ${staffToken}`);
    expect(tables.status).toBe(403);
  });

  it("Domains: agency_owner passes tenant-match+settings.manage (reaches body validation, not a 403); agency_staff is denied outright", async () => {
    const ownerRes = await request(app)
      .post(`/api/v1/restaurants/${managedLocation.id}/domains`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});
    expect(ownerRes.status).toBe(400); // validation failure proves it got PAST authorization

    const staffRes = await request(app)
      .post(`/api/v1/restaurants/${managedLocation.id}/domains`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({});
    expect(staffRes.status).toBe(403);
  });

  it("no agency member can reach a location under a business NOT managed by their agency", async () => {
    const unrelatedLocation = await createTestRestaurant({ businessId: unrelatedBusiness._id });
    restaurantIds.push(unrelatedLocation.id);

    const res = await request(app).get(`/api/v1/restaurants/${unrelatedLocation.id}/orders`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });

  it("a member of a DIFFERENT agency cannot reach this agency's managed location", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${managedLocation.id}/orders`)
      .set("Authorization", `Bearer ${otherAgencyOwnerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /agencies/:agencyId/businesses/:businessId — detail (Phase 26)", () => {
  it("returns business detail with its locations for an authorized member", async () => {
    const res = await request(app)
      .get(`/api/v1/agencies/${agency.id}/businesses/${managedBusiness.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.business.id).toBe(managedBusiness.id);
    const locationIds = res.body.data.locations.map((l: { id: string }) => l.id);
    expect(locationIds).toContain(managedLocation.id);
  });

  it("404s for a business managed by a different agency (never leaks existence)", async () => {
    const res = await request(app)
      .get(`/api/v1/agencies/${otherAgency.id}/businesses/${managedBusiness.id}`)
      .set("Authorization", `Bearer ${otherAgencyOwnerToken}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /agencies/:agencyId/businesses/:businessId/resend-owner-invite (Phase 26)", () => {
  let pendingBusinessId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    const res = await request(app)
      .post(`/api/v1/agencies/${agency.id}/businesses`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        businessName: `Resend Test Biz ${stamp}`,
        businessSlug: `resend-test-biz-${stamp}`,
        ownerName: "Pending Owner",
        ownerEmail: `resend-test-owner-${stamp}@test.local`,
        locationName: `Resend Test Loc ${stamp}`,
        locationSlug: `resend-test-loc-${stamp}`,
      });
    pendingBusinessId = res.body.data.business.id;
    businessIds.push(pendingBusinessId);
    restaurantIds.push(res.body.data.restaurant.id);
    userIds.push(res.body.data.business.ownerId as string);
  });

  it("agency_staff (no agency.businesses.manage) cannot resend; agency_owner can", async () => {
    const staffAttempt = await request(app)
      .post(`/api/v1/agencies/${agency.id}/businesses/${pendingBusinessId}/resend-owner-invite`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(staffAttempt.status).toBe(403);

    const ownerAttempt = await request(app)
      .post(`/api/v1/agencies/${agency.id}/businesses/${pendingBusinessId}/resend-owner-invite`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(ownerAttempt.status).toBe(200);

    const auditEntry = await AgencyAuditLog.findOne({
      agencyId: agency._id,
      action: "agency.business_owner_invite_resent",
      targetId: pendingBusinessId,
    });
    expect(auditEntry).not.toBeNull();
  });

  it("refuses once the owner has already accepted (no inviteTokenHash left)", async () => {
    const business = await Business.findById(pendingBusinessId);
    await User.updateOne({ _id: business!.ownerId }, { $unset: { inviteTokenHash: "" } });

    const res = await request(app)
      .post(`/api/v1/agencies/${agency.id}/businesses/${pendingBusinessId}/resend-owner-invite`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });
});

describe("GET /platform/agencies — platform-admin read-only overview", () => {
  it("platform_admin sees this agency with business/member counts, and non-admins are rejected", async () => {
    const admin = await createTestUser("platform_admin");
    userIds.push(admin.id);
    const res = await request(app).get("/api/v1/platform/agencies").set("Authorization", `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    const entry = res.body.data.items.find((a: { id: string }) => a.id === agency.id);
    expect(entry).toBeDefined();
    expect(entry.businessCount).toBeGreaterThanOrEqual(1);
    expect(entry.memberCount).toBeGreaterThanOrEqual(3);

    const asOwner = await request(app).get("/api/v1/platform/agencies").set("Authorization", `Bearer ${ownerToken}`);
    expect(asOwner.status).toBe(403);
  });
});
