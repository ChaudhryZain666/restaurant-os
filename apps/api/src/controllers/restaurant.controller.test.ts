import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { generateSecureToken } from "../services/secureToken.service.js";
import {
  closeTestConnections,
  createTestCategory,
  createTestMenuItem,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let platformAdminToken: string;
let ownerAToken: string;
let managerAToken: string;
let staffAToken: string;
let ownerBToken: string;
let unassignedUserId: string;
let platformAdminId: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant({
    settings: { currency: "USD", taxRate: 0.05, orderingEnabled: true, pickupEnabled: true, deliveryEnabled: false },
  });
  restaurantB = await createTestRestaurant();

  const platformAdmin = await createTestUser("platform_admin");
  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const managerA = await createTestUser("restaurant_manager", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  const unassignedUser = await createTestUser("customer");

  platformAdminToken = tokenFor(platformAdmin);
  ownerAToken = tokenFor(ownerA);
  managerAToken = tokenFor(managerA);
  staffAToken = tokenFor(staffA);
  ownerBToken = tokenFor(ownerB);
  unassignedUserId = unassignedUser.id;
  platformAdminId = platformAdmin.id;
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  // Scoped to this file's own fixtures only — a bare `{ role: "platform_admin" }` filter here
  // would delete every platform admin in the database, including the seeded
  // platform-admin@restaurant.local account (this happened; it's what this comment is guarding
  // against — see the Phase 1 audit report for how it was caught).
  await User.deleteMany({
    $or: [{ restaurantId: { $in: ids } }, { _id: { $in: [unassignedUserId, platformAdminId] } }],
  });
  await Restaurant.deleteMany({ _id: { $in: ids } });
  await closeTestConnections();
});

describe("restaurant creation (Phase 14 provisioning)", () => {
  const cleanupIds: string[] = [];
  const cleanupEmails: string[] = [];

  afterAll(async () => {
    await Restaurant.deleteMany({ _id: { $in: cleanupIds } });
    await User.deleteMany({ email: { $in: cleanupEmails } });
  });

  it("platform_admin can create a restaurant, provisioning its owner atomically and pending", async () => {
    const ownerEmail = `new-owner-${Date.now()}@test.local`;
    cleanupEmails.push(ownerEmail);
    const res = await request(app)
      .post("/api/v1/restaurants")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: "New Place",
        slug: `new-place-${Date.now()}`,
        timezone: "America/New_York",
        currency: "USD",
        owner: { name: "New Owner", email: ownerEmail },
      });

    expect(res.status).toBe(201);
    cleanupIds.push(res.body.data.restaurant.id);
    // Not publicly live the moment it's created — see restaurantReadiness/publish tests below.
    expect(res.body.data.restaurant.status).toBe("pending");
    expect(res.body.data.restaurant.settings.timezone).toBe("America/New_York");

    const owner = await User.findById(res.body.data.restaurant.ownerId);
    expect(owner!.role).toBe("restaurant_owner");
    expect(owner!.restaurantId!.toString()).toBe(res.body.data.restaurant.id);
    // Unusable password + invite token set — the exact same shape inviteStaff already uses, so
    // the owner accepts through the existing /auth/accept-invite flow.
    expect((owner as unknown as { inviteTokenHash?: string }).inviteTokenHash).toBeDefined();
  });

  it("rejects a duplicate slug", async () => {
    const res = await request(app)
      .post("/api/v1/restaurants")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ name: "Dupe", slug: restaurantA.slug, owner: { name: "X Test", email: `dupe-slug-${Date.now()}@test.local` } });

    expect(res.status).toBe(409);
  });

  it("rejects an owner email that already belongs to an account", async () => {
    const existingUser = await User.findById(unassignedUserId);
    const res = await request(app)
      .post("/api/v1/restaurants")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ name: "Dupe Owner", slug: `dupe-owner-${Date.now()}`, owner: { name: "X Test", email: existingUser!.email } });

    expect(res.status).toBe(409);
  });

  it("a non-platform_admin cannot create a restaurant", async () => {
    const res = await request(app)
      .post("/api/v1/restaurants")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Should fail", slug: `should-fail-${Date.now()}`, owner: { name: "X Test", email: `should-fail-${Date.now()}@test.local` } });

    expect(res.status).toBe(403);
  });

  it("the new owner can accept their invite through the real /auth/accept-invite endpoint and log in", async () => {
    const ownerEmail = `accept-flow-${Date.now()}@test.local`;
    cleanupEmails.push(ownerEmail);
    const createRes = await request(app)
      .post("/api/v1/restaurants")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ name: "Accept Flow", slug: `accept-flow-${Date.now()}`, owner: { name: "Accept Owner", email: ownerEmail } });
    cleanupIds.push(createRes.body.data.restaurant.id);

    // The raw invite token only ever reaches the owner's real inbox (never the API response) —
    // this test controls it directly by overwriting the stored hash with a token it knows, using
    // the exact same generateSecureToken/hashToken helpers the controller itself uses, so it can
    // exercise the real end-to-end /auth/accept-invite flow rather than only asserting DB state.
    const { raw, hash } = generateSecureToken();
    await User.findOneAndUpdate({ email: ownerEmail }, { $set: { inviteTokenHash: hash } });

    const accept = await request(app)
      .post("/api/v1/auth/accept-invite")
      .send({ token: raw, password: "OwnerPass123!" });
    expect(accept.status).toBe(200);
    expect(accept.body.data.user.role).toBe("restaurant_owner");

    const login = await request(app).post("/api/v1/auth/login").send({ email: ownerEmail, password: "OwnerPass123!" });
    expect(login.status).toBe(200);
  });

  it("a used invite token cannot be replayed", async () => {
    const ownerEmail = `replay-${Date.now()}@test.local`;
    cleanupEmails.push(ownerEmail);
    const createRes = await request(app)
      .post("/api/v1/restaurants")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ name: "Replay Test", slug: `replay-${Date.now()}`, owner: { name: "Replay Owner", email: ownerEmail } });
    cleanupIds.push(createRes.body.data.restaurant.id);

    const { raw, hash } = generateSecureToken();
    await User.findOneAndUpdate({ email: ownerEmail }, { $set: { inviteTokenHash: hash } });

    const first = await request(app).post("/api/v1/auth/accept-invite").send({ token: raw, password: "First123!" });
    expect(first.status).toBe(200);

    const replay = await request(app).post("/api/v1/auth/accept-invite").send({ token: raw, password: "Second123!" });
    expect(replay.status).toBe(400);
  });

  it("under true concurrency, exactly one of two simultaneous accept-invite requests for the same token succeeds", async () => {
    const ownerEmail = `invite-race-${Date.now()}@test.local`;
    cleanupEmails.push(ownerEmail);
    const createRes = await request(app)
      .post("/api/v1/restaurants")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ name: "Invite Race Test", slug: `invite-race-${Date.now()}`, owner: { name: "Race Owner", email: ownerEmail } });
    cleanupIds.push(createRes.body.data.restaurant.id);

    const { raw, hash } = generateSecureToken();
    await User.findOneAndUpdate({ email: ownerEmail }, { $set: { inviteTokenHash: hash } });

    const [a, b] = await Promise.all([
      request(app).post("/api/v1/auth/accept-invite").send({ token: raw, password: "PasswordA1!" }),
      request(app).post("/api/v1/auth/accept-invite").send({ token: raw, password: "PasswordB1!" }),
    ]);
    const statuses = [a.status, b.status].sort();
    // One atomic winner, one clean rejection — the find-and-clear in acceptInvite is a single
    // atomic findOneAndUpdate, so two requests racing on the same still-valid token can never
    // both succeed (see auth.controller.ts's acceptInvite doc comment).
    expect(statuses).toEqual([200, 400]);
  });

  it("under true concurrency, exactly one of two simultaneous reset-password requests for the same token succeeds (Phase 16)", async () => {
    const user = await createTestUser("customer");
    cleanupIds.push(user.id);

    const { raw, hash } = generateSecureToken();
    await User.findByIdAndUpdate(user.id, {
      passwordResetTokenHash: hash,
      passwordResetExpiresAt: new Date(Date.now() + 60_000),
    });

    const [a, b] = await Promise.all([
      request(app).post("/api/v1/auth/reset-password").send({ token: raw, password: "PasswordA1!" }),
      request(app).post("/api/v1/auth/reset-password").send({ token: raw, password: "PasswordB1!" }),
    ]);
    const statuses = [a.status, b.status].sort();
    // Same atomic find-and-clear pattern as acceptInvite above — a plain findOne-then-save (the
    // pattern this replaced) would let both concurrent requests' findOne succeed before either
    // save() cleared the token, letting both win. See auth.controller.ts's resetPassword.
    expect(statuses).toEqual([200, 400]);
  });

  it("under true concurrency, two simultaneous requests for the same slug never both succeed (DB unique index backstop)", async () => {
    const slug = `race-slug-${Date.now()}`;
    const emailA = `race-a-${Date.now()}@test.local`;
    const emailB = `race-b-${Date.now()}@test.local`;
    cleanupEmails.push(emailA, emailB);

    const [resA, resB] = await Promise.all([
      request(app)
        .post("/api/v1/restaurants")
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ name: "Race A", slug, owner: { name: "Race Owner A", email: emailA } }),
      request(app)
        .post("/api/v1/restaurants")
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ name: "Race B", slug, owner: { name: "Race Owner B", email: emailB } }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // Exactly one wins (201) and the other gets a clean conflict (409) — critically, NEVER a 500,
    // which is what a raw unhandled MongoDB duplicate-key error would otherwise surface as.
    expect(statuses).toEqual([201, 409]);
    const winner = resA.status === 201 ? resA : resB;
    cleanupIds.push(winner.body.data.restaurant.id);

    // The loser's transaction rolled back completely — its owner account was never left behind.
    const loserEmail = resA.status === 201 ? emailB : emailA;
    const orphanedOwner = await User.findOne({ email: loserEmail });
    expect(orphanedOwner).toBeNull();
  });
});

describe("restaurant readiness & publish (Phase 14)", () => {
  let pendingRestaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
  let pendingOwnerToken: string;

  beforeAll(async () => {
    pendingRestaurant = await createTestRestaurant({
      status: "pending",
      settings: { orderingEnabled: true, pickupEnabled: true, deliveryEnabled: false, taxRate: 0.1 },
    });
    const pendingOwner = await createTestUser("restaurant_owner", pendingRestaurant._id);
    await Restaurant.findByIdAndUpdate(pendingRestaurant._id, { $set: { ownerId: pendingOwner._id } });
    pendingOwnerToken = tokenFor(pendingOwner);
  });

  afterAll(async () => {
    await Restaurant.deleteOne({ _id: pendingRestaurant._id });
  });

  it("a freshly created restaurant is not ready to publish (no menu yet)", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${pendingRestaurant.id}/readiness`)
      .set("Authorization", `Bearer ${pendingOwnerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ready).toBe(false);
    const menuCheck = res.body.data.checks.find((c: { key: string }) => c.key === "menu");
    expect(menuCheck.complete).toBe(false);
  });

  it("publish is rejected while not ready, and never changes status", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${pendingRestaurant.id}/publish`)
      .set("Authorization", `Bearer ${pendingOwnerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.details.checks).toBeDefined();

    const stored = await Restaurant.findById(pendingRestaurant._id);
    expect(stored!.status).toBe("pending");
  });

  it("becomes ready once it has an active category with an available item, and publish succeeds", async () => {
    const category = await createTestCategory(pendingRestaurant._id);
    await createTestMenuItem(pendingRestaurant._id, category._id);

    const readiness = await request(app)
      .get(`/api/v1/restaurants/${pendingRestaurant.id}/readiness`)
      .set("Authorization", `Bearer ${pendingOwnerToken}`);
    expect(readiness.body.data.ready).toBe(true);

    const publish = await request(app)
      .patch(`/api/v1/restaurants/${pendingRestaurant.id}/publish`)
      .set("Authorization", `Bearer ${pendingOwnerToken}`);
    expect(publish.status).toBe(200);
    expect(publish.body.data.restaurant.status).toBe("active");

    // Publishing is exactly what makes it publicly resolvable — same enforcement point
    // getRestaurantBySlug already had (status: "active" only), now doing real work for a
    // restaurant that was genuinely pending, not just an enum value nothing ever produced.
    const publicLookup = await request(app).get(`/api/v1/restaurants/by-slug/${pendingRestaurant.slug}`);
    expect(publicLookup.status).toBe(200);
  });

  it("unpublish reverts an active restaurant to pending, and it 404s on the public route again", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${pendingRestaurant.id}/unpublish`)
      .set("Authorization", `Bearer ${pendingOwnerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.status).toBe("pending");

    const publicLookup = await request(app).get(`/api/v1/restaurants/by-slug/${pendingRestaurant.slug}`);
    expect(publicLookup.status).toBe(404);
  });

  it("a manager (no restaurant.settings.manage) cannot publish", async () => {
    const manager = await createTestUser("restaurant_manager", pendingRestaurant._id);
    const res = await request(app)
      .patch(`/api/v1/restaurants/${pendingRestaurant.id}/publish`)
      .set("Authorization", `Bearer ${tokenFor(manager)}`);
    expect(res.status).toBe(403);
    await User.deleteOne({ _id: manager._id });
  });

  it("a suspended restaurant cannot be published", async () => {
    await Restaurant.findByIdAndUpdate(pendingRestaurant._id, { $set: { status: "suspended" } });
    const res = await request(app)
      .patch(`/api/v1/restaurants/${pendingRestaurant.id}/publish`)
      .set("Authorization", `Bearer ${pendingOwnerToken}`);
    expect(res.status).toBe(400);
    await Restaurant.findByIdAndUpdate(pendingRestaurant._id, { $set: { status: "pending" } });
  });
});

describe("restaurant preview (Phase 14)", () => {
  it("the owner can preview their own pending restaurant even though the public route 404s it", async () => {
    const restaurant = await createTestRestaurant({ status: "pending" });
    const owner = await createTestUser("restaurant_owner", restaurant._id);
    await Restaurant.findByIdAndUpdate(restaurant._id, { $set: { ownerId: owner._id } });

    const publicLookup = await request(app).get(`/api/v1/restaurants/by-slug/${restaurant.slug}`);
    expect(publicLookup.status).toBe(404);

    const preview = await request(app)
      .get(`/api/v1/restaurants/by-slug/${restaurant.slug}/preview`)
      .set("Authorization", `Bearer ${tokenFor(owner)}`);
    expect(preview.status).toBe(200);
    expect(preview.body.data.restaurant.id).toBe(restaurant.id);

    await Restaurant.deleteOne({ _id: restaurant._id });
    await User.deleteOne({ _id: owner._id });
  });

  it("a different restaurant's owner cannot preview it (tenant isolation)", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/by-slug/${restaurantA.slug}/preview`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });

  it("an unauthenticated request cannot preview", async () => {
    const res = await request(app).get(`/api/v1/restaurants/by-slug/${restaurantA.slug}/preview`);
    expect(res.status).toBe(401);
  });

  it("platform_admin can preview any restaurant", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/by-slug/${restaurantA.slug}/preview`)
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(200);
  });
});

describe("restaurant retrieval", () => {
  it("anyone can look up an active restaurant by slug", async () => {
    const res = await request(app).get(`/api/v1/restaurants/by-slug/${restaurantA.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.id).toBe(restaurantA.id);
  });

  it("the public by-slug response never leaks ownerId (Phase 8 hardening)", async () => {
    const res = await request(app).get(`/api/v1/restaurants/by-slug/${restaurantA.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.ownerId).toBeUndefined();
    // Everything a storefront actually needs is still there.
    expect(res.body.data.restaurant.name).toBe(restaurantA.name);
    expect(res.body.data.restaurant.settings).toBeDefined();
  });

  it("rejects an unknown slug", async () => {
    const res = await request(app).get(`/api/v1/restaurants/by-slug/does-not-exist-${Date.now()}`);
    expect(res.status).toBe(404);
  });

  it("rejects a slug belonging to a suspended restaurant (Phase 8's /r/:slug routing must treat this as not-found)", async () => {
    await Restaurant.findByIdAndUpdate(restaurantB._id, { $set: { status: "suspended" } });
    const res = await request(app).get(`/api/v1/restaurants/by-slug/${restaurantB.slug}`);
    expect(res.status).toBe(404);
    await Restaurant.findByIdAndUpdate(restaurantB._id, { $set: { status: "active" } });
  });

  it("the owner can fetch their own restaurant via /me", async () => {
    const res = await request(app).get("/api/v1/restaurants/me").set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.id).toBe(restaurantA.id);
  });

  it("/me (authenticated staff) still includes ownerId — only the public endpoint strips it", async () => {
    const res = await request(app).get("/api/v1/restaurants/me").set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.ownerId).toBeDefined();
  });
});

describe("restaurant settings update (OWNER-only operation)", () => {
  it("owner can update settings, and a partial settings update does not wipe untouched fields", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ settings: { deliveryEnabled: true } });

    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.settings.deliveryEnabled).toBe(true);
    // Untouched settings fields survive the partial update.
    expect(res.body.data.restaurant.settings.currency).toBe("USD");
    expect(res.body.data.restaurant.settings.taxRate).toBe(0.05);
  });

  it("owner can toggle cash/online payment methods independently", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ settings: { onlinePaymentEnabled: false } });

    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.settings.onlinePaymentEnabled).toBe(false);
    expect(res.body.data.restaurant.settings.cashEnabled).toBe(true); // untouched

    // Restore for later tests in this file that assume online payment is available.
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ settings: { onlinePaymentEnabled: true } });
  });

  it("rejects disabling the only remaining enabled payment method", async () => {
    // restaurantA has both enabled by default — disable online first, THEN try to also disable
    // cash in a second request, since a single request disabling both is also rejected but this
    // proves the check considers the restaurant's CURRENT stored state, not just the one request.
    const first = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ settings: { onlinePaymentEnabled: false } });
    expect(first.status).toBe(200);

    const second = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ settings: { cashEnabled: false } });
    expect(second.status).toBe(400);

    const stored = await Restaurant.findById(restaurantA._id);
    expect(stored!.settings.cashEnabled).toBe(true); // rejected update never persisted

    // Restore for later tests in this file.
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ settings: { onlinePaymentEnabled: true } });
  });

  it("rejects disabling both payment methods in a single request", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ settings: { cashEnabled: false, onlinePaymentEnabled: false } });
    expect(res.status).toBe(400);
  });

  it("under true concurrency, two simultaneous requests each disabling a different payment method never both succeed (Phase 16)", async () => {
    // restaurantB starts with both cash and online enabled (fixture default) and isn't touched by
    // any other test in this file, so its payment-toggle state going in is known and stable.
    const [a, b] = await Promise.all([
      request(app)
        .patch(`/api/v1/restaurants/${restaurantB.id}`)
        .set("Authorization", `Bearer ${ownerBToken}`)
        .send({ settings: { cashEnabled: false } }),
      request(app)
        .patch(`/api/v1/restaurants/${restaurantB.id}`)
        .set("Authorization", `Bearer ${ownerBToken}`)
        .send({ settings: { onlinePaymentEnabled: false } }),
    ]);

    const stored = await Restaurant.findById(restaurantB._id);
    // Whichever request committed second must have been rejected by the atomic $expr guard
    // re-checking the STORED value at write time — a plain pre-check-then-write (each request
    // only reading the OTHER field, which looked fine before either write landed) would let both
    // succeed and leave neither payment method enabled. See restaurant.controller.ts's
    // updateRestaurant.
    expect(stored!.settings.cashEnabled || stored!.settings.onlinePaymentEnabled).toBe(true);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
  });

  it("manager cannot update settings (restaurant.settings.manage is owner-only)", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ name: "Manager Renamed" });

    expect(res.status).toBe(403);
  });

  it("staff cannot update settings", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ name: "Staff Renamed" });

    expect(res.status).toBe(403);
  });

  it("restaurant B's owner cannot update restaurant A's settings", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ name: "Hostile Takeover" });

    expect(res.status).toBe(403);

    const stored = await Restaurant.findById(restaurantA._id);
    expect(stored!.name).not.toBe("Hostile Takeover");
  });

  it("cannot change ownerId, slug, or status via the update body", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ ownerId: unassignedUserId, slug: "hijacked-slug", status: "suspended" });

    expect(res.status).toBe(200); // request succeeds — those fields are just silently not there
    const stored = await Restaurant.findById(restaurantA._id);
    expect(stored!.slug).toBe(restaurantA.slug);
    expect(stored!.status).toBe("active");
    expect(stored!.ownerId.toString()).not.toBe(unassignedUserId);
  });

  it("owner can set a valid hex brandColor (theme presentation only)", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ settings: { brandColor: "#C2410C" } });

    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.settings.brandColor).toBe("#C2410C");
  });

  it("rejects a malformed brandColor", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ settings: { brandColor: "not-a-color" } });

    expect(res.status).toBe(400);
  });

  it("rejects a brandColor with an injection-style payload", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ settings: { brandColor: "<script>alert(1)</script>" } });

    expect(res.status).toBe(400);
  });

  it("omitting brandColor leaves other settings untouched", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ settings: { deliveryEnabled: false } });

    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.settings.brandColor).toBe("#C2410C");
  });

  it("owner can set valid latitude/longitude", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ latitude: 42.1015, longitude: -76.5462 });

    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.latitude).toBeCloseTo(42.1015);
    expect(res.body.data.restaurant.longitude).toBeCloseTo(-76.5462);
  });

  it("rejects an out-of-range latitude", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ latitude: 200, longitude: 0 });
    expect(res.status).toBe(400);
  });

  it("clears a previously-set coordinate with null", async () => {
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ latitude: 10, longitude: 10 });

    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ latitude: null, longitude: null });

    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.latitude).toBeUndefined();
    expect(res.body.data.restaurant.longitude).toBeUndefined();
  });
});
