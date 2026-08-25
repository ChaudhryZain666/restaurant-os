import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Agency } from "../models/Agency.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import { AgencyAuditLog } from "../models/AgencyAuditLog.js";
import { Business } from "../models/Business.js";
import { DomainMapping } from "../models/DomainMapping.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import {
  closeTestConnections,
  createTestAgency,
  createTestAgencyMembership,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let agency: Awaited<ReturnType<typeof createTestAgency>>;
let otherAgency: Awaited<ReturnType<typeof createTestAgency>>;
let ownerUser: Awaited<ReturnType<typeof createTestUser>>;
let ownerToken: string;

const agencyIds: string[] = [];
const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];
const membershipIds: string[] = [];

beforeAll(async () => {
  await connectDB();
  agency = await createTestAgency();
  otherAgency = await createTestAgency();
  agencyIds.push(agency.id, otherAgency.id);

  ownerUser = await createTestUser("agency_member");
  userIds.push(ownerUser.id);
  const membership = await createTestAgencyMembership(agency._id, ownerUser._id, { role: "agency_owner" });
  membershipIds.push(membership.id);
  ownerToken = tokenFor(ownerUser, [{ agencyId: agency.id, role: "agency_owner" }]);
});

afterAll(async () => {
  await Promise.all([
    AgencyAuditLog.deleteMany({ agencyId: { $in: agencyIds } }),
    AgencyMembership.deleteMany({ agencyId: { $in: agencyIds } }),
    DomainMapping.deleteMany({ businessId: { $in: businessIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
    // Owner accounts created via createAgencyBusiness aren't individually tracked in userIds
    // above (their id isn't known until the response comes back) — sweep by restaurantId instead.
    User.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Agency.deleteMany({ _id: { $in: agencyIds } }),
  ]);
  await closeTestConnections();
});

describe("Phase 28 — agency-provisioned owner access (provisioningMode: direct)", () => {
  const ownerEmail = `direct-owner-${Date.now()}@test.local`;
  let temporaryPassword: string;
  let ownedRestaurantId: string;
  let ownedUserId: string;

  it("creating a business with provisioningMode:direct returns a temporary password exactly once, and forces a password change", async () => {
    const res = await request(app)
      .post(`/api/v1/agencies/${agency.id}/businesses`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        businessName: "Direct Access Co",
        businessSlug: `direct-access-${Date.now()}`,
        ownerName: "Direct Owner",
        ownerEmail,
        locationName: "Direct Location",
        locationSlug: `direct-location-${Date.now()}`,
        provisioningMode: "direct",
      });
    expect(res.status).toBe(201);
    expect(typeof res.body.data.ownerTemporaryPassword).toBe("string");
    expect(res.body.data.ownerTemporaryPassword.length).toBeGreaterThan(8);
    temporaryPassword = res.body.data.ownerTemporaryPassword;
    ownedRestaurantId = res.body.data.restaurant.id;
    businessIds.push(res.body.data.business.id);
    restaurantIds.push(ownedRestaurantId);

    const createdOwner = await User.findOne({ email: ownerEmail });
    expect(createdOwner).toBeTruthy();
    expect(createdOwner!.mustChangePassword).toBe(true);
    // No invite token was issued for this mode — the owner has real access immediately.
    expect(createdOwner!.inviteTokenHash).toBeUndefined();
    ownedUserId = createdOwner!.id as string;
    userIds.push(ownedUserId);
  });

  it("the temporary password logs the owner in, but the session cannot reach anything except /auth/me and /auth/change-password", async () => {
    const loginRes = await request(app).post("/api/v1/auth/login").send({ email: ownerEmail, password: temporaryPassword });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.user.mustChangePassword).toBe(true);
    const accessToken = loginRes.body.data.accessToken as string;

    const meRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(meRes.status).toBe(200);

    const blockedRes = await request(app)
      .get(`/api/v1/restaurants/${ownedRestaurantId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("changing the password clears mustChangePassword and unblocks the session", async () => {
    const loginRes = await request(app).post("/api/v1/auth/login").send({ email: ownerEmail, password: temporaryPassword });
    const accessToken = loginRes.body.data.accessToken as string;

    const changeRes = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: temporaryPassword, newPassword: "RealPassword123!" });
    expect(changeRes.status).toBe(200);
    expect(changeRes.body.data.user.mustChangePassword).toBe(false);
    const freshAccessToken = changeRes.body.data.accessToken as string;

    const unblockedRes = await request(app)
      .get(`/api/v1/restaurants/${ownedRestaurantId}`)
      .set("Authorization", `Bearer ${freshAccessToken}`);
    expect(unblockedRes.status).toBe(200);
  });

  it("recorded an agency.business_owner_access_created audit entry", async () => {
    const entry = await AgencyAuditLog.findOne({ agencyId: agency._id, action: "agency.business_owner_access_created" });
    expect(entry).toBeTruthy();
  });

  it("the default (invite) provisioning mode still never returns a temporary password", async () => {
    const res = await request(app)
      .post(`/api/v1/agencies/${agency.id}/businesses`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        businessName: "Invite Mode Co",
        businessSlug: `invite-mode-${Date.now()}`,
        ownerName: "Invited Owner",
        ownerEmail: `invited-owner-${Date.now()}@test.local`,
        locationName: "Invite Location",
        locationSlug: `invite-location-${Date.now()}`,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.ownerTemporaryPassword).toBeUndefined();
    businessIds.push(res.body.data.business.id);
    restaurantIds.push(res.body.data.restaurant.id);
  });
});

describe("Phase 28 — GET /agencies/:agencyId/dashboard", () => {
  it("returns real, agency-scoped figures", async () => {
    const res = await request(app).get(`/api/v1/agencies/${agency.id}/dashboard`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.businessCount).toBe("number");
    expect(res.body.data.usage).toHaveProperty("maxBusinesses");
    expect(res.body.data.usage).toHaveProperty("businessCount");
    expect(typeof res.body.data.locationsTotal).toBe("number");
    expect(typeof res.body.data.domainsConfiguredCount).toBe("number");
  });

  it("cross-agency isolation: a different agency's owner cannot read this agency's dashboard", async () => {
    const otherOwner = await createTestUser("agency_member");
    userIds.push(otherOwner.id);
    await createTestAgencyMembership(otherAgency._id, otherOwner._id, { role: "agency_owner" });
    const otherToken = tokenFor(otherOwner, [{ agencyId: otherAgency.id, role: "agency_owner" }]);

    const res = await request(app).get(`/api/v1/agencies/${agency.id}/dashboard`).set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });
});

describe("Phase 28 — agency member invite resend", () => {
  it("resends an invite for a still-pending membership", async () => {
    const invitee = await createTestUser("agency_member", undefined, { inviteTokenHash: "placeholder", inviteExpiresAt: new Date(Date.now() + 86400000) });
    userIds.push(invitee.id);
    const membership = await createTestAgencyMembership(agency._id, invitee._id, { role: "agency_staff", status: "invited", acceptedAt: undefined });
    membershipIds.push(membership.id);

    const res = await request(app)
      .post(`/api/v1/agencies/${agency.id}/members/${membership.id}/resend-invite`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
  });

  it("refuses to resend once the membership has already been accepted", async () => {
    const res = await request(app)
      .post(`/api/v1/agencies/${agency.id}/members/${membershipIds[0]}/resend-invite`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });
});

describe("Phase 28 — GET /agencies/:agencyId/subscription/entitlements includes usage", () => {
  it("returns usage even when the agency has no live subscription", async () => {
    const res = await request(app)
      .get(`/api/v1/agencies/${agency.id}/subscription/entitlements`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.entitlements).toBeNull();
    expect(res.body.data.usage).toHaveProperty("maxBusinesses");
    expect(res.body.data.usage).toHaveProperty("businessCount");
  });
});
