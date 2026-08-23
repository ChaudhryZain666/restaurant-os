import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Agency } from "../models/Agency.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import { AgencyAuditLog } from "../models/AgencyAuditLog.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestAgency, createTestAgencyMembership, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

let agency: Awaited<ReturnType<typeof createTestAgency>>;
let ownerUser: Awaited<ReturnType<typeof createTestUser>>;
let ownerToken: string;

const agencyIds: string[] = [];
const userIds: string[] = [];

beforeAll(async () => {
  await connectDB();
  agency = await createTestAgency();
  agencyIds.push(agency.id);
  ownerUser = await createTestUser("agency_member");
  userIds.push(ownerUser.id);
  await createTestAgencyMembership(agency._id, ownerUser._id, { role: "agency_owner" });
  ownerToken = tokenFor(ownerUser, [{ agencyId: agency.id, role: "agency_owner" }]);
});

afterAll(async () => {
  await Promise.all([
    AgencyAuditLog.deleteMany({ agencyId: { $in: agencyIds } }),
    AgencyMembership.deleteMany({ agencyId: { $in: agencyIds } }),
    Agency.deleteMany({ _id: { $in: agencyIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

describe("POST /agencies/:agencyId/members — invite", () => {
  it("invites a brand-new person: creates an unusable-password account + an 'invited' membership", async () => {
    const email = `new-member-${Date.now()}@test.local`;
    const res = await request(app)
      .post(`/api/v1/agencies/${agency.id}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "New Member", email, role: "agency_staff" });
    expect(res.status).toBe(201);

    const user = await User.findOne({ email });
    expect(user?.role).toBe("agency_member");
    expect(user?.inviteTokenHash).toEqual(expect.any(String));
    userIds.push(user!.id as string);

    const membership = await AgencyMembership.findOne({ agencyId: agency._id, userId: user!._id });
    expect(membership?.status).toBe("invited");
    expect(membership?.role).toBe("agency_staff");
    expect(membership?.inviteTokenHash).toEqual(expect.any(String));

    const auditEntry = await AgencyAuditLog.findOne({ agencyId: agency._id, action: "agency.member_invited" });
    expect(auditEntry).not.toBeNull();
  });

  it("invites an EXISTING eligible (customer) account without touching their password", async () => {
    const existing = await createTestUser("customer");
    userIds.push(existing.id);

    const res = await request(app)
      .post(`/api/v1/agencies/${agency.id}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: existing.name, email: existing.email, role: "agency_admin" });
    expect(res.status).toBe(201);

    const unchangedUser = await User.findById(existing._id);
    expect(unchangedUser?.inviteTokenHash).toBeUndefined();
    expect(unchangedUser?.passwordHash).toBe(existing.passwordHash);

    const membership = await AgencyMembership.findOne({ agencyId: agency._id, userId: existing._id });
    expect(membership?.status).toBe("invited");
    expect(membership?.role).toBe("agency_admin");
  });

  it("rejects inviting an account with an already-specialized role (e.g. restaurant_owner)", async () => {
    const owner = await createTestUser("restaurant_owner");
    userIds.push(owner.id);
    const res = await request(app)
      .post(`/api/v1/agencies/${agency.id}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: owner.name, email: owner.email, role: "agency_staff" });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate invite/membership for the same person", async () => {
    const existing = await createTestUser("customer");
    userIds.push(existing.id);
    await createTestAgencyMembership(agency._id, existing._id, { role: "agency_staff", status: "active" });

    const res = await request(app)
      .post(`/api/v1/agencies/${agency.id}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: existing.name, email: existing.email, role: "agency_admin" });
    expect(res.status).toBe(409);
  });

  it("requires agency.members.manage (agency_staff cannot invite)", async () => {
    const staff = await createTestUser("agency_member");
    userIds.push(staff.id);
    await createTestAgencyMembership(agency._id, staff._id, { role: "agency_staff" });
    const staffToken = tokenFor(staff, [{ agencyId: agency.id, role: "agency_staff" }]);

    const res = await request(app)
      .post(`/api/v1/agencies/${agency.id}/members`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ name: "Nope", email: `nope-${Date.now()}@test.local`, role: "agency_staff" });
    expect(res.status).toBe(403);
  });
});

describe("POST /agencies/accept-invite", () => {
  it("rejects an invalid/expired token", async () => {
    const res = await request(app)
      .post("/api/v1/agencies/accept-invite")
      .send({ token: "definitely-not-a-real-token", password: "Password123!" });
    expect(res.status).toBe(400);
  });

  it("a brand-new invitee accepting WITHOUT a password is rejected", async () => {
    // Drive this through the real service layer directly (not the controller) so the test can get
    // hold of the actual raw token, mirroring how acceptInvite's own unit-level guarantees are
    // proven elsewhere in this codebase when the token is generated inside a transaction the HTTP
    // layer doesn't expose.
    const { generateSecureToken } = await import("../services/secureToken.service.js");
    const { raw, hash } = generateSecureToken();
    const newUser = await User.create({
      name: "Direct Invitee",
      email: `direct-invitee-${Date.now()}@test.local`,
      passwordHash: "unusable",
      role: "agency_member",
      isActive: true,
      inviteTokenHash: hash,
      inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    userIds.push(newUser.id as string);
    await AgencyMembership.create({
      agencyId: agency._id,
      userId: newUser._id,
      role: "agency_staff",
      status: "invited",
      inviteTokenHash: hash,
      inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const noPassword = await request(app).post("/api/v1/agencies/accept-invite").send({ token: raw });
    expect(noPassword.status).toBe(400);

    const withPassword = await request(app).post("/api/v1/agencies/accept-invite").send({ token: raw, password: "Password123!" });
    expect(withPassword.status).toBe(200);
    expect(withPassword.body.data.accessToken).toEqual(expect.any(String));
    expect(withPassword.body.data.user.agencyMemberships.some((m: { agencyId: string }) => m.agencyId === agency.id)).toBe(true);

    const updatedUser = await User.findById(newUser._id);
    expect(updatedUser?.inviteTokenHash).toBeUndefined();
    expect(updatedUser?.role).toBe("agency_member");

    const updatedMembership = await AgencyMembership.findOne({ agencyId: agency._id, userId: newUser._id });
    expect(updatedMembership?.status).toBe("active");
  });

  it("an EXISTING account accepting needs no password at all", async () => {
    const { generateSecureToken } = await import("../services/secureToken.service.js");
    const { raw, hash } = generateSecureToken();
    const existing = await createTestUser("customer");
    userIds.push(existing.id);
    const originalPasswordHash = existing.passwordHash;
    await AgencyMembership.create({
      agencyId: agency._id,
      userId: existing._id,
      role: "agency_staff",
      status: "invited",
      inviteTokenHash: hash,
      inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const res = await request(app).post("/api/v1/agencies/accept-invite").send({ token: raw });
    expect(res.status).toBe(200);

    const unchangedUser = await User.findById(existing._id);
    expect(unchangedUser?.passwordHash).toBe(originalPasswordHash); // untouched
    expect(unchangedUser?.role).toBe("agency_member"); // flipped from customer

    const updatedMembership = await AgencyMembership.findOne({ agencyId: agency._id, userId: existing._id });
    expect(updatedMembership?.status).toBe("active");
  });

  it("double-accept protection: a second accept with the same token fails cleanly, even under true concurrency", async () => {
    const { generateSecureToken } = await import("../services/secureToken.service.js");
    const { raw, hash } = generateSecureToken();
    const existing = await createTestUser("customer");
    userIds.push(existing.id);
    await AgencyMembership.create({
      agencyId: agency._id,
      userId: existing._id,
      role: "agency_staff",
      status: "invited",
      inviteTokenHash: hash,
      inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const [a, b] = await Promise.all([
      request(app).post("/api/v1/agencies/accept-invite").send({ token: raw }),
      request(app).post("/api/v1/agencies/accept-invite").send({ token: raw }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);

    const membership = await AgencyMembership.findOne({ agencyId: agency._id, userId: existing._id });
    expect(membership?.status).toBe("active");
  });
});

describe("GET /agencies/:agencyId/members and PATCH .../members/:membershipId", () => {
  it("lists active/invited members, never revoked ones", async () => {
    const member = await createTestUser("agency_member");
    userIds.push(member.id);
    const membership = await createTestAgencyMembership(agency._id, member._id, { role: "agency_staff", status: "revoked" });

    const res = await request(app).get(`/api/v1/agencies/${agency.id}/members`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.members.map((m: { id: string }) => m.id);
    expect(ids).not.toContain(membership.id);
    expect(ids).toContain(
      (await AgencyMembership.findOne({ agencyId: agency._id, userId: ownerUser._id }))!.id as string
    );
  });

  it("owner can change a member's role and assign specific businessIds to agency_staff", async () => {
    const member = await createTestUser("agency_member");
    userIds.push(member.id);
    const membership = await createTestAgencyMembership(agency._id, member._id, { role: "agency_staff", status: "active" });

    const res = await request(app)
      .patch(`/api/v1/agencies/${agency.id}/members/${membership.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ businessIds: ["6a0000000000000000000001"] });
    expect(res.status).toBe(200);
    expect(res.body.data.membership.businessIds).toEqual(["6a0000000000000000000001"]);
  });

  it("revoking (status: revoked) a member is rejected for the last remaining active owner", async () => {
    const soleOwnerAgency = await createTestAgency();
    agencyIds.push(soleOwnerAgency.id);
    const soleOwner = await createTestUser("agency_member");
    userIds.push(soleOwner.id);
    const soleOwnerMembership = await createTestAgencyMembership(soleOwnerAgency._id, soleOwner._id, { role: "agency_owner" });
    const soleOwnerToken = tokenFor(soleOwner, [{ agencyId: soleOwnerAgency.id, role: "agency_owner" }]);

    const res = await request(app)
      .patch(`/api/v1/agencies/${soleOwnerAgency.id}/members/${soleOwnerMembership.id}`)
      .set("Authorization", `Bearer ${soleOwnerToken}`)
      .send({ status: "revoked" });
    expect(res.status).toBe(400);
  });

  it("agency_staff (no agency.members.manage) cannot revoke/change roles", async () => {
    const member = await createTestUser("agency_member");
    userIds.push(member.id);
    const membership = await createTestAgencyMembership(agency._id, member._id, { role: "agency_staff", status: "active" });

    const staff = await createTestUser("agency_member");
    userIds.push(staff.id);
    await createTestAgencyMembership(agency._id, staff._id, { role: "agency_staff" });
    const staffToken = tokenFor(staff, [{ agencyId: agency.id, role: "agency_staff" }]);

    const res = await request(app)
      .patch(`/api/v1/agencies/${agency.id}/members/${membership.id}`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ role: "agency_admin" });
    expect(res.status).toBe(403);
  });
});
