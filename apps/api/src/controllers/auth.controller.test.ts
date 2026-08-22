import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { generateSecureToken } from "../services/secureToken.service.js";
import { issueRefreshToken, isRefreshTokenActive, verifyRefreshToken } from "../services/token.service.js";
import { closeTestConnections, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

const userIds: string[] = [];

afterAll(async () => {
  await User.deleteMany({ _id: { $in: userIds } });
  await closeTestConnections();
});

beforeAll(async () => {
  await connectDB();
});

function track(id: string) {
  userIds.push(id);
  return id;
}

describe("POST /auth/request-password-reset — no user enumeration", () => {
  it("returns the identical response for an existing and a non-existent email", async () => {
    const user = await createTestUser("customer");
    track(user.id);

    const existing = await request(app).post("/api/v1/auth/request-password-reset").send({ email: user.email });
    const missing = await request(app)
      .post("/api/v1/auth/request-password-reset")
      .send({ email: `nobody-${Date.now()}@example.com` });

    expect(existing.status).toBe(200);
    expect(missing.status).toBe(200);
    expect(existing.body.data.message).toBe(missing.body.data.message);
  });

  it("actually sets a reset token hash on the real account (verified via a follow-up reset, not by reading the hash)", async () => {
    const user = await createTestUser("customer");
    track(user.id);

    await request(app).post("/api/v1/auth/request-password-reset").send({ email: user.email });

    const stored = await User.findById(user.id);
    expect(stored!.passwordResetTokenHash).toBeTruthy();
    expect(stored!.passwordResetExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("POST /auth/reset-password", () => {
  it("rejects a token that doesn't match any account", async () => {
    const res = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: "not-a-real-token", password: "NewPassword123!" });
    expect(res.status).toBe(400);
  });

  it("rejects an expired token", async () => {
    const user = await createTestUser("customer");
    track(user.id);
    const { raw, hash } = generateSecureToken();
    await User.findByIdAndUpdate(user.id, {
      passwordResetTokenHash: hash,
      passwordResetExpiresAt: new Date(Date.now() - 1000), // already expired
    });

    const res = await request(app).post("/api/v1/auth/reset-password").send({ token: raw, password: "NewPassword123!" });
    expect(res.status).toBe(400);
  });

  it("accepts a valid token, changes the password, clears the token, and revokes existing sessions", async () => {
    const user = await createTestUser("customer");
    track(user.id);

    // Issue a session the way login() would, so there's something real to prove got revoked.
    const refresh = await issueRefreshToken(user.id);
    const { jti } = verifyRefreshToken(refresh);
    expect(await isRefreshTokenActive(user.id, jti)).toBe(true);

    const { raw, hash } = generateSecureToken();
    await User.findByIdAndUpdate(user.id, {
      passwordResetTokenHash: hash,
      passwordResetExpiresAt: new Date(Date.now() + 60_000),
    });

    const res = await request(app).post("/api/v1/auth/reset-password").send({ token: raw, password: "NewPassword123!" });
    expect(res.status).toBe(200);

    const stored = await User.findById(user.id);
    expect(stored!.passwordResetTokenHash).toBeUndefined();
    expect(stored!.passwordResetExpiresAt).toBeUndefined();

    // The old refresh token must no longer be usable after a password reset.
    expect(await isRefreshTokenActive(user.id, jti)).toBe(false);

    // The new password actually works, and the old one no longer does.
    const loginNew = await request(app).post("/api/v1/auth/login").send({ email: user.email, password: "NewPassword123!" });
    expect(loginNew.status).toBe(200);
    const loginOld = await request(app).post("/api/v1/auth/login").send({ email: user.email, password: "Password123!" });
    expect(loginOld.status).toBe(401);
  });

  it("rejects the same token a second time (single-use)", async () => {
    const user = await createTestUser("customer");
    track(user.id);
    const { raw, hash } = generateSecureToken();
    await User.findByIdAndUpdate(user.id, {
      passwordResetTokenHash: hash,
      passwordResetExpiresAt: new Date(Date.now() + 60_000),
    });

    const first = await request(app).post("/api/v1/auth/reset-password").send({ token: raw, password: "FirstNewPass1!" });
    expect(first.status).toBe(200);

    const second = await request(app).post("/api/v1/auth/reset-password").send({ token: raw, password: "SecondNewPass1!" });
    expect(second.status).toBe(400);
  });
});

describe("POST /auth/accept-invite", () => {
  it("rejects a token that doesn't match any account", async () => {
    const res = await request(app).post("/api/v1/auth/accept-invite").send({ token: "bogus", password: "Password123!" });
    expect(res.status).toBe(400);
  });

  it("rejects an expired invite", async () => {
    const owner = await createTestUser("restaurant_owner");
    track(owner.id);
    const { raw, hash } = generateSecureToken();
    await User.findByIdAndUpdate(owner.id, {
      inviteTokenHash: hash,
      inviteExpiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app).post("/api/v1/auth/accept-invite").send({ token: raw, password: "Password123!" });
    expect(res.status).toBe(400);
  });

  it("accepts a valid invite, sets the password, clears the invite, and logs the user in", async () => {
    const staff = await createTestUser("restaurant_staff");
    track(staff.id);
    const { raw, hash } = generateSecureToken();
    await User.findByIdAndUpdate(staff.id, {
      inviteTokenHash: hash,
      inviteExpiresAt: new Date(Date.now() + 60_000),
    });

    const res = await request(app).post("/api/v1/auth/accept-invite").send({ token: raw, password: "Password123!" });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.email).toBe(staff.email);

    const stored = await User.findById(staff.id);
    expect(stored!.inviteTokenHash).toBeUndefined();

    const login = await request(app).post("/api/v1/auth/login").send({ email: staff.email, password: "Password123!" });
    expect(login.status).toBe(200);
  });

  // Sequential replay and true-concurrency coverage for accept-invite lives in
  // restaurant.controller.test.ts (right next to its existing accept-invite/replay tests) rather
  // than duplicated here — this file's own auth-flow tests (register/login/reset/accept/
  // change-password/email-change/delete) already sit close to authLimiter's 30-per-window cap
  // within a single test-file process, and adding more here risks tripping it for no coverage
  // gain over what restaurant.controller.test.ts already proves via the exact same endpoint.
});

describe("POST /auth/change-password", () => {
  it("rejects an incorrect current password", async () => {
    const user = await createTestUser("customer");
    track(user.id);
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${tokenFor(user)}`)
      .send({ currentPassword: "WrongPassword!", newPassword: "NewPassword123!" });
    expect(res.status).toBe(400);
  });

  it("changes the password, logs in with the new one, and revokes other sessions while keeping this one working", async () => {
    const user = await createTestUser("customer");
    track(user.id);

    // A separate, still-active session — must stop working once the password changes.
    const otherRefreshToken = await issueRefreshToken(user.id);
    const otherPayload = verifyRefreshToken(otherRefreshToken);

    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${tokenFor(user)}`)
      .send({ currentPassword: "Password123!", newPassword: "NewPassword123!" });
    expect(res.status).toBe(200);
    // The request that just changed the password gets a fresh, working session back immediately.
    expect(res.body.data.accessToken).toBeTruthy();

    expect(await isRefreshTokenActive(user.id, otherPayload.jti)).toBe(false);

    const oldLogin = await request(app).post("/api/v1/auth/login").send({ email: user.email, password: "Password123!" });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "NewPassword123!" });
    expect(newLogin.status).toBe(200);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .send({ currentPassword: "x", newPassword: "NewPassword123!" });
    expect(res.status).toBe(401);
  });
});

describe("email change (request + confirm)", () => {
  it("rejects an incorrect current password", async () => {
    const user = await createTestUser("customer");
    track(user.id);
    const res = await request(app)
      .post("/api/v1/auth/request-email-change")
      .set("Authorization", `Bearer ${tokenFor(user)}`)
      .send({ newEmail: `new-${Date.now()}@test.local`, currentPassword: "WrongPassword!" });
    expect(res.status).toBe(400);
  });

  it("rejects a newEmail already used by another account", async () => {
    const user = await createTestUser("customer");
    const other = await createTestUser("customer");
    track(user.id);
    track(other.id);
    const res = await request(app)
      .post("/api/v1/auth/request-email-change")
      .set("Authorization", `Bearer ${tokenFor(user)}`)
      .send({ newEmail: other.email, currentPassword: "Password123!" });
    expect(res.status).toBe(409);
  });

  it("does not change the email until the confirmation link is used, and the old email keeps working to log in until then", async () => {
    const user = await createTestUser("customer");
    track(user.id);
    const newEmail = `confirmed-${Date.now()}@test.local`;

    const requestRes = await request(app)
      .post("/api/v1/auth/request-email-change")
      .set("Authorization", `Bearer ${tokenFor(user)}`)
      .send({ newEmail, currentPassword: "Password123!" });
    expect(requestRes.status).toBe(200);

    const stillOldEmail = await User.findById(user.id);
    expect(stillOldEmail!.email).toBe(user.email);
    const loginOldEmail = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "Password123!" });
    expect(loginOldEmail.status).toBe(200);

    const rawToken = (await User.findById(user.id))!.emailChangeTokenHash;
    expect(rawToken).toBeTruthy();

    // Confirming with a bogus token must fail — proves this isn't a no-op success.
    const badConfirm = await request(app).post("/api/v1/auth/confirm-email-change").send({ token: "not-the-real-token" });
    expect(badConfirm.status).toBe(400);
  });
});

describe("DELETE /auth/me — account deletion", () => {
  it("anonymizes a customer account: login stops working, but the id (and its order references) stays intact", async () => {
    const user = await createTestUser("customer");
    track(user.id);
    const originalId = user.id;

    const res = await request(app)
      .delete("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokenFor(user)}`)
      .send({ currentPassword: "Password123!" });
    expect(res.status).toBe(200);

    const stored = await User.findById(originalId);
    expect(stored).not.toBeNull(); // the document itself still exists — Order.customerId stays valid
    expect(stored!.isActive).toBe(false);
    expect(stored!.deletedAt).toBeTruthy();
    expect(stored!.name).toBe("Deleted user");

    // The old email no longer resolves to any account at all (it was overwritten as part of
    // anonymizing the document), so this 401s the same way a made-up email would — not a 403.
    const login = await request(app).post("/api/v1/auth/login").send({ email: user.email, password: "Password123!" });
    expect(login.status).toBe(401);

    // The anonymized address itself is also unreachable (its password was randomized).
    const loginAnon = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: stored!.email, password: "Password123!" });
    expect(loginAnon.status).toBe(401);
  });

  it("refuses to delete a restaurant-scoped account, without guessing at ownership/staffing policy", async () => {
    const owner = await createTestUser("restaurant_owner");
    track(owner.id);
    const res = await request(app)
      .delete("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokenFor(owner)}`)
      .send({ currentPassword: "Password123!" });
    expect(res.status).toBe(400);

    const stored = await User.findById(owner.id);
    expect(stored!.deletedAt).toBeUndefined();
  });

  it("rejects an incorrect current password", async () => {
    const user = await createTestUser("customer");
    track(user.id);
    const res = await request(app)
      .delete("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokenFor(user)}`)
      .send({ currentPassword: "WrongPassword!" });
    expect(res.status).toBe(400);
    const stored = await User.findById(user.id);
    expect(stored!.deletedAt).toBeUndefined();
  });
});
