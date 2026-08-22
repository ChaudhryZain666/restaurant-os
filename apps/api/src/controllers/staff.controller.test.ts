import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { generateSecureToken } from "../services/secureToken.service.js";
import { closeTestConnections, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerAToken: string;
let managerAToken: string;
let staffAToken: string;
let ownerBToken: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const managerA = await createTestUser("restaurant_manager", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);

  ownerAToken = tokenFor(ownerA);
  managerAToken = tokenFor(managerA);
  staffAToken = tokenFor(staffA);
  ownerBToken = tokenFor(ownerB);
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await User.deleteMany({ restaurantId: { $in: ids } });
  await Restaurant.deleteMany({ _id: { $in: ids } });
  await closeTestConnections();
});

function invitePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "New Staffer",
    email: `staffer-${Date.now()}-${Math.random()}@test.local`,
    role: "restaurant_staff",
    ...overrides,
  };
}

describe("staff management (restaurant.staff.manage — owner only)", () => {
  it("owner can invite a staff member", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(invitePayload({ role: "restaurant_manager" }));

    expect(res.status).toBe(201);
    expect(res.body.data.staff.role).toBe("restaurant_manager");
    expect(res.body.data.staff.isActive).toBe(true);
    expect(res.body.data.staff.invitePending).toBe(true);
    expect(res.body.data.staff.passwordHash).toBeUndefined();
    expect(res.body.data.staff.inviteTokenHash).toBeUndefined();
  });

  it("an invited-but-not-yet-accepted account cannot log in with any password", async () => {
    const email = `not-accepted-${Date.now()}@test.local`;
    const invite = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(invitePayload({ email }));
    expect(invite.status).toBe(201);

    // No password was ever set for this account, so nothing — including a guess of common
    // passwords — should ever authenticate it. 401, not 403: this isn't deactivation, the
    // account just has no usable credential yet.
    const attempt = await request(app).post("/api/v1/auth/login").send({ email, password: "Password123!" });
    expect(attempt.status).toBe(401);
  });

  it("manager cannot invite staff (restaurant.staff.manage is owner-only)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send(invitePayload());
    expect(res.status).toBe(403);
  });

  it("staff cannot invite staff", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send(invitePayload());
    expect(res.status).toBe(403);
  });

  it("rejects an invite with a duplicate email", async () => {
    const payload = invitePayload();
    const first = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(payload);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(payload);
    expect(second.status).toBe(409);
  });

  it("rejects an invite trying to assign role=restaurant_owner", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(invitePayload({ role: "restaurant_owner" }));
    expect(res.status).toBe(400);
  });

  it("rejects an invite trying to assign role=platform_admin", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(invitePayload({ role: "platform_admin" }));
    expect(res.status).toBe(400);
  });

  it("restaurant B's owner cannot invite staff into restaurant A (tenant isolation)", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send(invitePayload());
    expect(res.status).toBe(403);
  });

  it("lists only staff-role users for the restaurant, never the owner", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    const roles = res.body.data.staff.map((s: { role: string }) => s.role);
    expect(roles).not.toContain("restaurant_owner");
    expect(roles.length).toBeGreaterThan(0);
  });

  it("owner can deactivate a staff member, and that account can no longer log in", async () => {
    const email = `deactivate-me-${Date.now()}@test.local`;
    const invite = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(invitePayload({ email }));
    const staffId = invite.body.data.staff.id;

    // Accept the invite so this account has a real, known password — the raw invite token is
    // never returned by the API (only its hash is stored), so it's set directly on the test
    // fixture here, exactly as the real invite email would have encoded it.
    const { raw, hash } = generateSecureToken();
    await User.findByIdAndUpdate(staffId, {
      inviteTokenHash: hash,
      inviteExpiresAt: new Date(Date.now() + 60_000),
    });
    const accept = await request(app)
      .post("/api/v1/auth/accept-invite")
      .send({ token: raw, password: "Password123!" });
    expect(accept.status).toBe(200);

    const deactivate = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/staff/${staffId}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ isActive: false });
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.data.staff.isActive).toBe(false);
    expect(deactivate.body.data.staff.invitePending).toBe(false);

    const loginAttempt = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "Password123!" });
    expect(loginAttempt.status).toBe(403);
  });

  it("restaurant B's owner cannot deactivate restaurant A's staff by guessing the id", async () => {
    const invite = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(invitePayload());
    const staffId = invite.body.data.staff.id;

    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/staff/${staffId}`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(403);
  });
});

describe("staff invite resend (Phase 16)", () => {
  it("owner can resend a pending staff invite, which invalidates the original token", async () => {
    const email = `resend-me-${Date.now()}@test.local`;
    const invite = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(invitePayload({ email }));
    const staffId = invite.body.data.staff.id;
    const originalHash = (await User.findById(staffId))!.inviteTokenHash;

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff/${staffId}/resend-invite`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.staff.invitePending).toBe(true);

    const stored = await User.findById(staffId);
    expect(stored!.inviteTokenHash).toBeTruthy();
    expect(stored!.inviteTokenHash).not.toBe(originalHash);
  });

  it("rejects resending an invite that's already been accepted", async () => {
    const email = `already-accepted-${Date.now()}@test.local`;
    const invite = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(invitePayload({ email }));
    const staffId = invite.body.data.staff.id;
    // Simulate acceptance directly (the real /auth/accept-invite flow is covered elsewhere) —
    // clearing inviteTokenHash is the exact condition resendStaffInvite checks.
    await User.findByIdAndUpdate(staffId, { $unset: { inviteTokenHash: "", inviteExpiresAt: "" } });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff/${staffId}/resend-invite`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(400);
  });

  it("manager cannot resend a staff invite (restaurant.staff.manage is owner-only)", async () => {
    const invite = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(invitePayload());
    const staffId = invite.body.data.staff.id;

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff/${staffId}/resend-invite`)
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(res.status).toBe(403);
  });

  it("restaurant B's owner cannot resend restaurant A's staff invite (tenant isolation)", async () => {
    const invite = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(invitePayload());
    const staffId = invite.body.data.staff.id;

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff/${staffId}/resend-invite`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });
});

describe("staff location assignment (Phase 18)", () => {
  it("a newly invited staff member's locationIds defaults to just the inviting restaurant", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(invitePayload());
    expect(res.status).toBe(201);

    const staff = await User.findById(res.body.data.staff.id);
    expect(staff!.locationIds.map((id) => id.toString())).toEqual([restaurantA.id]);
  });

  it("an owner can PATCH a staff member's locationIds to add a second location", async () => {
    const restaurantC = await createTestRestaurant();
    try {
      const invite = await request(app)
        .post(`/api/v1/restaurants/${restaurantA.id}/staff`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send(invitePayload());
      const staffId = invite.body.data.staff.id;

      const res = await request(app)
        .patch(`/api/v1/restaurants/${restaurantA.id}/staff/${staffId}`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({ locationIds: [restaurantA.id, restaurantC.id] });

      expect(res.status).toBe(200);
      const staff = await User.findById(staffId);
      expect(staff!.locationIds.map((id) => id.toString()).sort()).toEqual([restaurantA.id, restaurantC.id].sort());
    } finally {
      await Restaurant.deleteOne({ _id: restaurantC._id });
    }
  });
});
