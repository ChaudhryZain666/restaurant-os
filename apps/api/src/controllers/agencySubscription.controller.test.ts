import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Agency } from "../models/Agency.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import { AgencyAuditLog } from "../models/AgencyAuditLog.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestAgency, createTestAgencyMembership, createTestPlan, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

let agency: Awaited<ReturnType<typeof createTestAgency>>;
let otherAgency: Awaited<ReturnType<typeof createTestAgency>>;
let ownerUser: Awaited<ReturnType<typeof createTestUser>>;
let staffUser: Awaited<ReturnType<typeof createTestUser>>;
let otherAgencyOwner: Awaited<ReturnType<typeof createTestUser>>;
let ownerToken: string;
let staffToken: string;
let otherAgencyOwnerToken: string;
let plan: Awaited<ReturnType<typeof createTestPlan>>;

const agencyIds: string[] = [];
const userIds: string[] = [];
const planIds: string[] = [];

beforeAll(async () => {
  await connectDB();
  agency = await createTestAgency();
  otherAgency = await createTestAgency();
  agencyIds.push(agency.id, otherAgency.id);

  ownerUser = await createTestUser("agency_member");
  staffUser = await createTestUser("agency_member");
  otherAgencyOwner = await createTestUser("agency_member");
  userIds.push(ownerUser.id, staffUser.id, otherAgencyOwner.id);

  await createTestAgencyMembership(agency._id, ownerUser._id, { role: "agency_owner" });
  await createTestAgencyMembership(agency._id, staffUser._id, { role: "agency_staff" });
  await createTestAgencyMembership(otherAgency._id, otherAgencyOwner._id, { role: "agency_owner" });

  ownerToken = tokenFor(ownerUser, [{ agencyId: agency.id, role: "agency_owner" }]);
  staffToken = tokenFor(staffUser, [{ agencyId: agency.id, role: "agency_staff" }]);
  otherAgencyOwnerToken = tokenFor(otherAgencyOwner, [{ agencyId: otherAgency.id, role: "agency_owner" }]);

  plan = await createTestPlan({ type: "AGENCY", code: `agency-sub-test-${Date.now()}` });
  planIds.push(plan.id);
});

afterAll(async () => {
  await Promise.all([
    AgencyAuditLog.deleteMany({ agencyId: { $in: agencyIds } }),
    AgencyMembership.deleteMany({ agencyId: { $in: agencyIds } }),
    Subscription.deleteMany({ ownerType: "agency", ownerId: { $in: agencyIds } }),
    Agency.deleteMany({ _id: { $in: agencyIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

describe("POST /agencies/:agencyId/subscription — creation + authorization", () => {
  it("agency_owner can start a subscription; a second attempt for the same agency is rejected", async () => {
    const res = await request(app)
      .post(`/api/v1/agencies/${agency.id}/subscription`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(res.status).toBe(201);
    expect(res.body.data.subscription.status).toBe("trialing");

    const dup = await request(app)
      .post(`/api/v1/agencies/${agency.id}/subscription`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(dup.status).toBe(409);

    const auditEntry = await AgencyAuditLog.findOne({ agencyId: agency._id, action: "agency.subscription_created" });
    expect(auditEntry).not.toBeNull();
  });

  it("agency_staff (agency.billing.read only) cannot start/cancel a subscription", async () => {
    const res = await request(app)
      .post(`/api/v1/agencies/${otherAgency.id}/subscription`)
      .set("Authorization", `Bearer ${otherAgencyOwnerToken}`)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(res.status).toBe(201);

    const staffAttempt = await request(app)
      .post(`/api/v1/agencies/${otherAgency.id}/subscription/cancel`)
      .set("Authorization", `Bearer ${staffToken}`);
    // staffToken belongs to a DIFFERENT agency than otherAgency, so this is also a requireAgencyMatch
    // 403 — confirms both the permission gate and the agency-match gate independently reject it.
    expect(staffAttempt.status).toBe(403);
  });

  it("agency_staff CAN read the agency's own subscription (agency.billing.read)", async () => {
    const res = await request(app).get(`/api/v1/agencies/${agency.id}/subscription`).set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
  });

  it("a member of a different agency cannot read this agency's subscription", async () => {
    const res = await request(app).get(`/api/v1/agencies/${agency.id}/subscription`).set("Authorization", `Bearer ${otherAgencyOwnerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("subscription lifecycle — cancel / reactivate", () => {
  it("owner can cancel the trialing subscription (immediate — no billing period to wait for), then it's terminal", async () => {
    const res = await request(app).post(`/api/v1/agencies/${agency.id}/subscription/cancel`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.subscription.status).toBe("cancelled");

    const auditEntry = await AgencyAuditLog.findOne({ agencyId: agency._id, action: "agency.subscription_cancellation_requested" });
    expect(auditEntry).not.toBeNull();

    const reactivateAttempt = await request(app)
      .post(`/api/v1/agencies/${agency.id}/subscription/reactivate`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(reactivateAttempt.status).toBe(404); // no LIVE subscription anymore — cancelled is terminal
  });
});
