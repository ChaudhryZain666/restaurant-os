// Phase 37 — deliberately its own file, not appended to auth.controller.test.ts: that file's own
// comment (around its accept-invite block) already documents sitting close to authLimiter's
// 30-per-15-min cap within one test-file process, and /auth/verify-email is also authLimiter-gated.
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { generateSecureToken } from "../services/secureToken.service.js";
import { closeTestConnections, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

const userIds: string[] = [];

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await User.deleteMany({ _id: { $in: userIds } });
  await closeTestConnections();
});

function track(id: string) {
  userIds.push(id);
  return id;
}

describe("POST /auth/register — sends a real email-verification token", () => {
  it("stores a fresh, unexpired emailVerificationTokenHash and never returns it to the client", async () => {
    const email = `register-verify-${Date.now()}@test.local`;
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "New Owner", email, password: "Password123!" });

    expect(res.status).toBe(201);
    track(res.body.data.user.id);
    // The response is the account's own public shape — the raw token/hash must never appear in it.
    expect(JSON.stringify(res.body)).not.toMatch(/emailVerification/i);
    expect(res.body.data.user.emailVerified).toBe(false);

    const stored = await User.findById(res.body.data.user.id);
    expect(stored!.emailVerificationTokenHash).toBeTruthy();
    expect(stored!.emailVerificationExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(stored!.emailVerifiedAt).toBeUndefined();
  });
});

describe("POST /auth/verify-email", () => {
  it("rejects a token that doesn't match any account", async () => {
    const res = await request(app).post("/api/v1/auth/verify-email").send({ token: "bogus-token" });
    expect(res.status).toBe(400);
  });

  it("rejects an expired token", async () => {
    const user = await createTestUser("customer");
    track(user.id);
    const { raw, hash } = generateSecureToken();
    await User.findByIdAndUpdate(user.id, {
      emailVerificationTokenHash: hash,
      emailVerificationExpiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app).post("/api/v1/auth/verify-email").send({ token: raw });
    expect(res.status).toBe(400);
    const stillUnverified = await User.findById(user.id);
    expect(stillUnverified!.emailVerifiedAt).toBeUndefined();
  });

  it("accepts a valid token, sets emailVerifiedAt, and clears the token", async () => {
    const user = await createTestUser("customer");
    track(user.id);
    const { raw, hash } = generateSecureToken();
    await User.findByIdAndUpdate(user.id, {
      emailVerificationTokenHash: hash,
      emailVerificationExpiresAt: new Date(Date.now() + 60_000),
    });

    const res = await request(app).post("/api/v1/auth/verify-email").send({ token: raw });
    expect(res.status).toBe(200);

    const stored = await User.findById(user.id);
    expect(stored!.emailVerifiedAt).toBeTruthy();
    expect(stored!.emailVerificationTokenHash).toBeUndefined();
    expect(stored!.emailVerificationExpiresAt).toBeUndefined();
  });

  it("rejects the same token a second time (single-use)", async () => {
    const user = await createTestUser("customer");
    track(user.id);
    const { raw, hash } = generateSecureToken();
    await User.findByIdAndUpdate(user.id, {
      emailVerificationTokenHash: hash,
      emailVerificationExpiresAt: new Date(Date.now() + 60_000),
    });

    const first = await request(app).post("/api/v1/auth/verify-email").send({ token: raw });
    expect(first.status).toBe(200);
    const second = await request(app).post("/api/v1/auth/verify-email").send({ token: raw });
    expect(second.status).toBe(400);
  });

  it("under true concurrency, exactly one of two simultaneous requests for the same token succeeds", async () => {
    const user = await createTestUser("customer");
    track(user.id);
    const { raw, hash } = generateSecureToken();
    await User.findByIdAndUpdate(user.id, {
      emailVerificationTokenHash: hash,
      emailVerificationExpiresAt: new Date(Date.now() + 60_000),
    });

    const [a, b] = await Promise.all([
      request(app).post("/api/v1/auth/verify-email").send({ token: raw }),
      request(app).post("/api/v1/auth/verify-email").send({ token: raw }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
  });
});

describe("POST /auth/resend-verification", () => {
  it("requires authentication", async () => {
    const res = await request(app).post("/api/v1/auth/resend-verification");
    expect(res.status).toBe(401);
  });

  it("issues a fresh token that invalidates the previous one", async () => {
    const user = await createTestUser("customer");
    track(user.id);
    const token = tokenFor(user);

    const { hash: firstHash } = generateSecureToken();
    await User.findByIdAndUpdate(user.id, {
      emailVerificationTokenHash: firstHash,
      emailVerificationExpiresAt: new Date(Date.now() + 60_000),
    });

    const res = await request(app).post("/api/v1/auth/resend-verification").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    const stored = await User.findById(user.id);
    expect(stored!.emailVerificationTokenHash).toBeTruthy();
    expect(stored!.emailVerificationTokenHash).not.toBe(firstHash);
  });

  it("is a harmless no-op for an already-verified account", async () => {
    const user = await createTestUser("customer", undefined, { emailVerifiedAt: new Date() });
    track(user.id);
    const token = tokenFor(user);

    const res = await request(app).post("/api/v1/auth/resend-verification").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const stored = await User.findById(user.id);
    expect(stored!.emailVerificationTokenHash).toBeUndefined();
  });
});

describe("acceptInvite also satisfies email verification (Phase 37)", () => {
  it("an accepted invite is automatically treated as a verified email — clicking a real emailed link IS proof of ownership", async () => {
    const staff = await createTestUser("restaurant_staff");
    track(staff.id);
    const { raw, hash } = generateSecureToken();
    await User.findByIdAndUpdate(staff.id, {
      inviteTokenHash: hash,
      inviteExpiresAt: new Date(Date.now() + 60_000),
    });

    const res = await request(app).post("/api/v1/auth/accept-invite").send({ token: raw, password: "Password123!" });
    expect(res.status).toBe(200);

    const stored = await User.findById(staff.id);
    expect(stored!.emailVerifiedAt).toBeTruthy();
  });
});
