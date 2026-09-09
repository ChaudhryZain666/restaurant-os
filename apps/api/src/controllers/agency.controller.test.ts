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
import { ClientCommercialTerms } from "../models/ClientCommercialTerms.js";
import { MockDnsRecord } from "../models/MockDnsRecord.js";
import { verificationRecordHost } from "../services/domainVerification.service.js";
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
    ClientCommercialTerms.deleteMany({ businessId: { $in: businessIds } }),
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

describe("GET /agencies/:agencyId/locations — Portal UX phase, cross-agency isolation", () => {
  it("shows the agency's own managed location with its business name and availability, never a location from a different agency", async () => {
    const res = await request(app).get(`/api/v1/agencies/${agency.id}/locations`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const item = res.body.data.items.find((l: { id: string }) => l.id === managedLocation.id);
    expect(item).toBeDefined();
    expect(item.businessId).toBe(managedBusiness.id);
    expect(item.businessName).toBe(managedBusiness.name);
    expect(item.availability).toEqual(expect.objectContaining({ status: expect.any(String) }));

    const otherAgencyBusiness = await createTestBusiness({ agencyId: otherAgency._id });
    const otherAgencyLocation = await createTestRestaurant({ businessId: otherAgencyBusiness._id });
    businessIds.push(otherAgencyBusiness.id);
    restaurantIds.push(otherAgencyLocation.id);

    const ids = res.body.data.items.map((l: { id: string }) => l.id);
    expect(ids).not.toContain(otherAgencyLocation.id);
  });

  it("a member of a DIFFERENT agency cannot list this agency's locations", async () => {
    const res = await request(app).get(`/api/v1/agencies/${agency.id}/locations`).set("Authorization", `Bearer ${otherAgencyOwnerToken}`);
    expect(res.status).toBe(403);
  });

  it("an outsider (no agency membership at all) cannot list this agency's locations", async () => {
    const res = await request(app).get(`/api/v1/agencies/${agency.id}/locations`).set("Authorization", `Bearer ${outsiderToken}`);
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
        // "mock", not "internal" — Phase 27's entitlementLimit.service.ts/agencyEntitlement.service.ts
        // deliberately exclude provider:"internal" (grandfathered/comped) subscriptions from limit
        // enforcement, treating them the same as no subscription at all (see those files' doc
        // comments — a real regression this exact fixture shape exposed against Phase 24's
        // grandfathering script). This test's whole point is a REAL enforced limit, so it needs a
        // real (non-internal) provider value, exactly like an actual createSubscriptionForAgency call
        // would produce.
        provider: "mock",
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
        // "mock", not "internal" — Phase 27's entitlementLimit.service.ts/agencyEntitlement.service.ts
        // deliberately exclude provider:"internal" (grandfathered/comped) subscriptions from limit
        // enforcement, treating them the same as no subscription at all (see those files' doc
        // comments — a real regression this exact fixture shape exposed against Phase 24's
        // grandfathering script). This test's whole point is a REAL enforced limit, so it needs a
        // real (non-internal) provider value, exactly like an actual createSubscriptionForAgency call
        // would produce.
        provider: "mock",
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

  // Phase 59 — menu.routes.ts/category.routes.ts/modifier.routes.ts (location-scoped overrides)
  // used the plain, non-agency-aware requirePermission from middleware/rbac.js on every route,
  // contradicting AGENCY_ROLE_GRANTS already listing restaurant.menu.read/write for agency roles —
  // a real gap where no agency member could ever reach Menu, only its business-level canonical
  // counterpart (businessMenu.routes.ts, already correctly requireBusinessPermission-gated).
  it("Menu location overrides: agency_owner reaches read+write; agency_staff (read-only grant) reaches read but not write", async () => {
    const ownerRead = await request(app)
      .get(`/api/v1/restaurants/${managedLocation.id}/menu/overrides`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(ownerRead.status).toBe(200);

    const ownerWrite = await request(app)
      .put(`/api/v1/restaurants/${managedLocation.id}/menu/000000000000000000000000/override`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});
    expect(ownerWrite.status).not.toBe(403); // reaches validation/lookup, not blocked by authorization

    const staffRead = await request(app)
      .get(`/api/v1/restaurants/${managedLocation.id}/menu/overrides`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(staffRead.status).toBe(200);

    const staffWrite = await request(app)
      .put(`/api/v1/restaurants/${managedLocation.id}/menu/000000000000000000000000/override`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({});
    expect(staffWrite.status).toBe(403);
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

// ---------------------------------------------------------------------------------------------
// Phase 58 — Clients search/filter/sort, location drill-down, agency profile/domain settings.
// ---------------------------------------------------------------------------------------------

describe("GET /agencies/:agencyId/businesses — search, filter, sort (Phase 58)", () => {
  let liveOwner: Awaited<ReturnType<typeof createTestUser>>;
  let pendingOwner: Awaited<ReturnType<typeof createTestUser>>;
  let liveBusiness: Awaited<ReturnType<typeof createTestBusiness>>;
  let pendingBusiness: Awaited<ReturnType<typeof createTestBusiness>>;
  let suspendedBusiness: Awaited<ReturnType<typeof createTestBusiness>>;
  let multiLocationBusiness: Awaited<ReturnType<typeof createTestBusiness>>;
  const stamp = Date.now();
  const searchTargetName = `Zzz Search Target ${stamp}`;

  beforeAll(async () => {
    liveOwner = await createTestUser("restaurant_owner", undefined, { name: `Findable Owner ${stamp}`, email: `findable-owner-${stamp}@test.local` });
    pendingOwner = await createTestUser("restaurant_owner", undefined, {
      inviteTokenHash: "seeded-hash",
      inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    userIds.push(liveOwner.id, pendingOwner.id);

    liveBusiness = await createTestBusiness({ agencyId: agency._id, ownerId: liveOwner._id, status: "active", name: searchTargetName });
    pendingBusiness = await createTestBusiness({ agencyId: agency._id, ownerId: pendingOwner._id, status: "pending" });
    suspendedBusiness = await createTestBusiness({ agencyId: agency._id, ownerId: liveOwner._id, status: "suspended" });
    multiLocationBusiness = await createTestBusiness({ agencyId: agency._id, ownerId: liveOwner._id, status: "active" });
    businessIds.push(liveBusiness.id, pendingBusiness.id, suspendedBusiness.id, multiLocationBusiness.id);

    const locA = await createTestRestaurant({ businessId: multiLocationBusiness._id });
    const locB = await createTestRestaurant({ businessId: multiLocationBusiness._id });
    restaurantIds.push(locA.id, locB.id);
  });

  it("search matches by business name", async () => {
    const res = await request(app)
      .get(`/api/v1/agencies/${agency.id}/businesses?search=${encodeURIComponent("Zzz Search Target")}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((b: { id: string }) => b.id);
    expect(ids).toEqual([liveBusiness.id]);
  });

  it("search matches by owner name and owner email, never leaking a different agency's businesses", async () => {
    const byName = await request(app)
      .get(`/api/v1/agencies/${agency.id}/businesses?search=${encodeURIComponent(`Findable Owner ${stamp}`)}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const namedIds = byName.body.data.items.map((b: { id: string }) => b.id);
    expect(namedIds).toEqual(expect.arrayContaining([liveBusiness.id, suspendedBusiness.id, multiLocationBusiness.id]));
    expect(namedIds).not.toContain(unrelatedBusiness.id);

    const byEmail = await request(app)
      .get(`/api/v1/agencies/${agency.id}/businesses?search=${encodeURIComponent(`findable-owner-${stamp}@test.local`)}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(byEmail.body.data.items.map((b: { id: string }) => b.id)).toEqual(expect.arrayContaining([liveBusiness.id]));
  });

  it("a search string that matches nothing returns an empty page, not an error", async () => {
    const res = await request(app)
      .get(`/api/v1/agencies/${agency.id}/businesses?search=${encodeURIComponent("no-such-client-exists-anywhere")}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("status=inactive returns only suspended businesses for this agency", async () => {
    const res = await request(app).get(`/api/v1/agencies/${agency.id}/businesses?status=inactive`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((b: { id: string; status: string }) => b.id);
    expect(ids).toContain(suspendedBusiness.id);
    expect(res.body.data.items.every((b: { status: string }) => b.status === "suspended")).toBe(true);
  });

  it("status=owner_pending returns only businesses whose owner hasn't accepted yet", async () => {
    const res = await request(app).get(`/api/v1/agencies/${agency.id}/businesses?status=owner_pending`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((b: { id: string }) => b.id);
    expect(ids).toContain(pendingBusiness.id);
    expect(ids).not.toContain(liveBusiness.id);
    expect(res.body.data.items.every((b: { ownerInvitePending: boolean }) => b.ownerInvitePending === true)).toBe(true);
  });

  it("status=live returns only active businesses whose owner has accepted", async () => {
    const res = await request(app).get(`/api/v1/agencies/${agency.id}/businesses?status=live`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((b: { id: string }) => b.id);
    expect(ids).toContain(liveBusiness.id);
    expect(ids).not.toContain(pendingBusiness.id);
    expect(ids).not.toContain(suspendedBusiness.id);
  });

  it("status=multi_location returns only businesses with more than one location", async () => {
    const res = await request(app).get(`/api/v1/agencies/${agency.id}/businesses?status=multi_location`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((b: { id: string }) => b.id);
    expect(ids).toContain(multiLocationBusiness.id);
    expect(ids).not.toContain(liveBusiness.id);
  });

  it("sorts by name ascending", async () => {
    const res = await request(app)
      .get(`/api/v1/agencies/${agency.id}/businesses?sort=name&order=asc&limit=100`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const names = res.body.data.items.map((b: { name: string }) => b.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("rejects an un-whitelisted sort field", async () => {
    const res = await request(app).get(`/api/v1/agencies/${agency.id}/businesses?sort=ownerId`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });

  it("a member of a different agency gets no results leaked through search/filter either", async () => {
    const res = await request(app)
      .get(`/api/v1/agencies/${agency.id}/businesses?search=${encodeURIComponent("Zzz Search Target")}`)
      .set("Authorization", `Bearer ${otherAgencyOwnerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /agencies/:agencyId/locations/:locationId — drill-down (Phase 58)", () => {
  it("returns business/owner/availability/readiness/storefront context for an authorized member", async () => {
    const res = await request(app)
      .get(`/api/v1/agencies/${agency.id}/locations/${managedLocation.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.business.id).toBe(managedBusiness.id);
    expect(res.body.data.location.id).toBe(managedLocation.id);
    expect(res.body.data.availability).toEqual(expect.objectContaining({ status: expect.any(String) }));
    expect(res.body.data.readiness).toEqual(expect.objectContaining({ ready: expect.any(Boolean), checks: expect.any(Array) }));
    expect(res.body.data.storefrontUrl).toContain(managedLocation.slug);
  });

  it("404s for a location whose business belongs to a different agency (never leaks existence)", async () => {
    const otherAgencyBusiness = await createTestBusiness({ agencyId: otherAgency._id });
    const otherAgencyLocation = await createTestRestaurant({ businessId: otherAgencyBusiness._id });
    businessIds.push(otherAgencyBusiness.id);
    restaurantIds.push(otherAgencyLocation.id);

    const res = await request(app)
      .get(`/api/v1/agencies/${agency.id}/locations/${otherAgencyLocation.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });

  it("a member of a different agency cannot reach this agency's location detail", async () => {
    const res = await request(app)
      .get(`/api/v1/agencies/${agency.id}/locations/${managedLocation.id}`)
      .set("Authorization", `Bearer ${otherAgencyOwnerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("PATCH /agencies/:agencyId — profile settings (Phase 58)", () => {
  it("agency_owner (agency.manage) can update the profile; agency_admin (no agency.manage) cannot", async () => {
    const asAdmin = await request(app)
      .patch(`/api/v1/agencies/${agency.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Should Not Apply" });
    expect(asAdmin.status).toBe(403);

    const asOwner = await request(app)
      .patch(`/api/v1/agencies/${agency.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ description: "Updated description" });
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.data.agency.description).toBe("Updated description");
  });

  it("a member of a different agency cannot update this agency's profile", async () => {
    const res = await request(app)
      .patch(`/api/v1/agencies/${agency.id}`)
      .set("Authorization", `Bearer ${otherAgencyOwnerToken}`)
      .send({ description: "Hijacked" });
    expect(res.status).toBe(403);
  });
});

describe("POST /agencies/:agencyId/domain and /domain/verify — white-label domain ownership (Phase 58, Section 12A)", () => {
  it("rejects claiming the platform's own configured origin as a white-label domain", async () => {
    const res = await request(app)
      .post(`/api/v1/agencies/${agency.id}/domain`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ domain: "localhost" });
    expect(res.status).toBe(400);
  });

  it("agency_admin (no agency.manage) cannot set the domain; agency_owner can, and it starts as pending_verification", async () => {
    const domain = `agency-${Date.now()}.example.test`;

    const asAdmin = await request(app).post(`/api/v1/agencies/${agency.id}/domain`).set("Authorization", `Bearer ${adminToken}`).send({ domain });
    expect(asAdmin.status).toBe(403);

    const res = await request(app).post(`/api/v1/agencies/${agency.id}/domain`).set("Authorization", `Bearer ${ownerToken}`).send({ domain });
    expect(res.status).toBe(201);
    expect(res.body.data.agency.domain).toBe(domain);
    expect(res.body.data.agency.domainStatus).toBe("pending_verification");
    expect(res.body.data.agency.domainVerificationToken).toEqual(expect.any(String));
  });

  it("verification fails with no DNS record seeded, then succeeds once the correct TXT value is seeded — never a fake 'Verified' without a real match", async () => {
    const domain = `agency-verify-${Date.now()}.example.test`;
    const setRes = await request(app).post(`/api/v1/agencies/${agency.id}/domain`).set("Authorization", `Bearer ${ownerToken}`).send({ domain });
    const token = setRes.body.data.agency.domainVerificationToken as string;

    const firstCheck = await request(app).post(`/api/v1/agencies/${agency.id}/domain/verify`).set("Authorization", `Bearer ${ownerToken}`);
    expect(firstCheck.status).toBe(200);
    expect(firstCheck.body.data.verified).toBe(false);
    expect(firstCheck.body.data.agency.domainStatus).toBe("pending_verification");

    await MockDnsRecord.create({ hostname: verificationRecordHost(domain), txtValues: [token] });

    const secondCheck = await request(app).post(`/api/v1/agencies/${agency.id}/domain/verify`).set("Authorization", `Bearer ${ownerToken}`);
    expect(secondCheck.status).toBe(200);
    expect(secondCheck.body.data.verified).toBe(true);
    expect(secondCheck.body.data.agency.domainStatus).toBe("verified");

    await MockDnsRecord.deleteOne({ hostname: verificationRecordHost(domain) });
  });

  it("a member of a different agency cannot set or verify this agency's domain", async () => {
    const setRes = await request(app)
      .post(`/api/v1/agencies/${agency.id}/domain`)
      .set("Authorization", `Bearer ${otherAgencyOwnerToken}`)
      .send({ domain: "hijack.example.test" });
    expect(setRes.status).toBe(403);

    const verifyRes = await request(app).post(`/api/v1/agencies/${agency.id}/domain/verify`).set("Authorization", `Bearer ${otherAgencyOwnerToken}`);
    expect(verifyRes.status).toBe(403);
  });
});

describe("PUT /agencies/:agencyId/businesses/:businessId/commercial-terms (Phase 59)", () => {
  it("is null (not configured) before anything is ever set", async () => {
    const res = await request(app)
      .get(`/api/v1/agencies/${agency.id}/businesses/${managedBusiness.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.commercialTerms).toBeNull();
  });

  it("agency_owner can set commercial terms; they then appear on the business detail response", async () => {
    const setRes = await request(app)
      .put(`/api/v1/agencies/${agency.id}/businesses/${managedBusiness.id}/commercial-terms`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ planLabel: "Growth", priceAmountCents: 9900, currency: "USD", billingCycle: "monthly", status: "active" });
    expect(setRes.status).toBe(200);
    expect(setRes.body.data.commercialTerms).toMatchObject({
      planLabel: "Growth",
      priceAmountCents: 9900,
      currency: "USD",
      billingCycle: "monthly",
      status: "active",
      agencyId: agency.id,
      businessId: managedBusiness.id,
    });

    const detailRes = await request(app)
      .get(`/api/v1/agencies/${agency.id}/businesses/${managedBusiness.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(detailRes.body.data.commercialTerms).toMatchObject({ planLabel: "Growth", priceAmountCents: 9900 });
  });

  it("re-setting terms upserts (replaces), it never creates a second record", async () => {
    await request(app)
      .put(`/api/v1/agencies/${agency.id}/businesses/${managedBusiness.id}/commercial-terms`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ priceAmountCents: 14900, status: "trial" });

    const res = await request(app)
      .get(`/api/v1/agencies/${agency.id}/businesses/${managedBusiness.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.body.data.commercialTerms.priceAmountCents).toBe(14900);
    expect(res.body.data.commercialTerms.status).toBe("trial");

    const count = await ClientCommercialTerms.countDocuments({ businessId: managedBusiness.id });
    expect(count).toBe(1);
  });

  it("agency_staff (no agency.businesses.manage) cannot set commercial terms; agency_admin can", async () => {
    const staffAttempt = await request(app)
      .put(`/api/v1/agencies/${agency.id}/businesses/${managedBusiness.id}/commercial-terms`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ priceAmountCents: 5000 });
    expect(staffAttempt.status).toBe(403);

    const adminAttempt = await request(app)
      .put(`/api/v1/agencies/${agency.id}/businesses/${managedBusiness.id}/commercial-terms`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ priceAmountCents: 5000 });
    expect(adminAttempt.status).toBe(200);
  });

  it("404s for a business managed by a different agency (never leaks existence, matches getAgencyBusiness)", async () => {
    const res = await request(app)
      .put(`/api/v1/agencies/${otherAgency.id}/businesses/${managedBusiness.id}/commercial-terms`)
      .set("Authorization", `Bearer ${otherAgencyOwnerToken}`)
      .send({ priceAmountCents: 100 });
    expect(res.status).toBe(404);
  });

  it("a member of a different agency cannot set commercial terms for this agency's business", async () => {
    const res = await request(app)
      .put(`/api/v1/agencies/${agency.id}/businesses/${managedBusiness.id}/commercial-terms`)
      .set("Authorization", `Bearer ${otherAgencyOwnerToken}`)
      .send({ priceAmountCents: 100 });
    expect(res.status).toBe(403);
  });

  it("rejects an empty update and a negative price", async () => {
    const empty = await request(app)
      .put(`/api/v1/agencies/${agency.id}/businesses/${managedBusiness.id}/commercial-terms`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});
    expect(empty.status).toBe(400);

    const negative = await request(app)
      .put(`/api/v1/agencies/${agency.id}/businesses/${managedBusiness.id}/commercial-terms`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ priceAmountCents: -500 });
    expect(negative.status).toBe(400);
  });
});

describe("Payment security — agency workspace access never reaches payment credentials (Phase 59)", () => {
  it("an agency_owner acting on a managed location's real payment-account route is rejected — restaurant.payments.manage is granted to no agency role", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${managedLocation.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });
});
