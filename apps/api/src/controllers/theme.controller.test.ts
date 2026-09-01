import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { Business } from "../models/Business.js";
import { Agency } from "../models/Agency.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import { AuditLog } from "../models/AuditLog.js";
import {
  closeTestConnections,
  createTestAgency,
  createTestAgencyMembership,
  createTestBusiness,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerAToken: string;
let staffAToken: string;
let ownerBToken: string;

const cleanupIds: string[] = [];

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();
  cleanupIds.push(restaurantA.id, restaurantB.id);

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  ownerAToken = tokenFor(ownerA);
  staffAToken = tokenFor(staffA);
  ownerBToken = tokenFor(ownerB);
});

afterAll(async () => {
  await Promise.all([
    AuditLog.deleteMany({ restaurantId: { $in: [restaurantA._id, restaurantB._id] } }),
    User.deleteMany({ restaurantId: { $in: [restaurantA._id, restaurantB._id] } }),
    Restaurant.deleteMany({ _id: { $in: [restaurantA._id, restaurantB._id] } }),
  ]);
  await closeTestConnections();
});

describe("GET /restaurants/:restaurantId/theme", () => {
  it("returns a valid default published theme with no draft for a restaurant that's never touched Theme Studio", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/theme`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.published).toEqual({ themeKey: "classic", themeVersion: 1, colors: {}, sections: {} });
    expect(res.body.data.draft).toBeNull();
    expect(res.body.data.hasUnpublishedChanges).toBe(false);
  });

  it("rejects restaurant_staff (no restaurant.settings.manage)", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/theme`)
      .set("Authorization", `Bearer ${staffAToken}`);
    expect(res.status).toBe(403);
  });

  it("rejects restaurant B's owner from reading restaurant A's theme (IDOR)", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/theme`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });
});

describe("PATCH /restaurants/:restaurantId/theme/draft", () => {
  it("rejects an invalid theme key", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/theme/draft`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ themeKey: "not-a-real-theme" });
    expect(res.status).toBe(400);
  });

  it("rejects a non-hex color", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/theme/draft`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ colors: { primary: "javascript:alert(1)" } });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid section key", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/theme/draft`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ sections: { notARealSection: true } });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid radius/density value", async () => {
    const res1 = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/theme/draft`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ radius: "extremely-round" });
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/theme/draft`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ density: "chaotic" });
    expect(res2.status).toBe(400);
  });

  it("saves a partial update as a draft, merged onto the published defaults, without touching the published theme", async () => {
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/theme/draft`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ themeKey: "modern", colors: { primary: "#112233" } });
    expect(res.status).toBe(200);
    expect(res.body.data.draft).toEqual({
      themeKey: "modern",
      themeVersion: 1,
      colors: { primary: "#112233" },
      sections: {},
    });

    const stored = await Restaurant.findById(restaurantA._id).select("settings.theme themeDraft");
    expect(stored!.settings.theme.themeKey).toBe("classic"); // published unchanged
    expect(stored!.themeDraft?.themeKey).toBe("modern");
  });

  it("merges a second partial update onto the existing draft rather than replacing it", async () => {
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/theme/draft`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ sections: { hero: true } });

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/theme`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    // themeKey:"modern" and colors.primary from the earlier test should still be there.
    expect(res.body.data.draft).toEqual({
      themeKey: "modern",
      themeVersion: 1,
      colors: { primary: "#112233" },
      sections: { hero: true },
    });
    expect(res.body.data.hasUnpublishedChanges).toBe(true);
  });

  it("clears every color override when the client sends an explicit empty colors object, rather than leaving the old ones in place", async () => {
    // The draft at this point still has colors.primary:"#112233" from the earlier tests — a
    // restaurant clearing an override (Theme Studio's "Reset" button) sends the FULL current
    // colors object back, which for "nothing overridden anymore" is `{}`. A field-level merge
    // (`{...baseline.colors, ...{}}`) would silently keep the old primary forever, since
    // JSON can't distinguish "no colors key sent" from "colors key sent as {}" once merged that
    // way — this asserts the fix: `colors`, when present at all, fully replaces the baseline.
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/theme/draft`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ colors: {} });
    expect(res.status).toBe(200);
    expect(res.body.data.draft).toEqual({
      themeKey: "modern",
      themeVersion: 1,
      colors: {},
      sections: { hero: true },
    });
  });
});

describe("Preview reflects the draft, public storefront never does", () => {
  it("shows the draft theme on the authenticated preview response", async () => {
    const res = await request(app).get(`/api/v1/restaurants/by-slug/${restaurantA.slug}/preview`).set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.settings.theme.themeKey).toBe("modern");
    expect(res.body.data.restaurant.themeDraft).toBeUndefined();
  });

  it("never exposes the draft on the public by-slug response, even for an active restaurant", async () => {
    await Restaurant.findByIdAndUpdate(restaurantA._id, { status: "active" });
    const res = await request(app).get(`/api/v1/restaurants/by-slug/${restaurantA.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.settings.theme.themeKey).toBe("classic"); // still published, not the draft
    expect(res.body.data.restaurant.themeDraft).toBeUndefined();
  });
});

describe("POST /restaurants/:restaurantId/theme/publish", () => {
  it("rejects publishing when there is no draft", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantB.id}/theme/publish`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(400);
  });

  it("copies the draft onto the published theme, clears the draft, and audit-logs it", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/theme/publish`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.theme.themeKey).toBe("modern");

    const stored = await Restaurant.findById(restaurantA._id).select("settings.theme themeDraft");
    expect(stored!.settings.theme.themeKey).toBe("modern");
    expect(stored!.themeDraft).toBeUndefined();

    const auditEntry = await AuditLog.findOne({ restaurantId: restaurantA._id, action: "restaurant.theme_published" });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry!.metadata).toMatchObject({ themeKey: "modern" });

    // The public storefront now reflects the newly published theme.
    const publicRes = await request(app).get(`/api/v1/restaurants/by-slug/${restaurantA.slug}`);
    expect(publicRes.body.data.restaurant.settings.theme.themeKey).toBe("modern");
  });
});

describe("POST /restaurants/:restaurantId/theme/rollback", () => {
  it("rejects rolling back when there is no previous published theme", async () => {
    // restaurantB has never had a real publish in this file up to this point.
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantB.id}/theme/rollback`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(400);
  });

  it("swaps the published theme back to what it was before the most recent publish, clears the rollback target, and audit-logs it", async () => {
    // restaurantA was just published to "modern" above, from the original default "classic" — so
    // themePreviousPublished should now hold classic.
    const before = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/theme`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(before.body.data.canRollback).toBe(true);

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/theme/rollback`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.theme.themeKey).toBe("classic");

    const stored = await Restaurant.findById(restaurantA._id).select("settings.theme themePreviousPublished themeDraft");
    expect(stored!.settings.theme.themeKey).toBe("classic");
    expect(stored!.themePreviousPublished).toBeUndefined();

    const auditEntry = await AuditLog.findOne({ restaurantId: restaurantA._id, action: "restaurant.theme_rolled_back" });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry!.metadata).toMatchObject({ themeKey: "classic" });

    // Rolling back a second time in a row has nothing left to roll back to.
    const again = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/theme/rollback`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(again.status).toBe(400);

    // The public storefront reflects the rollback immediately, same as a real publish does.
    const publicRes = await request(app).get(`/api/v1/restaurants/by-slug/${restaurantA.slug}`);
    expect(publicRes.body.data.restaurant.settings.theme.themeKey).toBe("classic");
  });

  it("never exposes themePreviousPublished on the public or preview storefront response", async () => {
    const publicRes = await request(app).get(`/api/v1/restaurants/by-slug/${restaurantA.slug}`);
    expect(publicRes.body.data.restaurant.themePreviousPublished).toBeUndefined();

    const previewRes = await request(app)
      .get(`/api/v1/restaurants/by-slug/${restaurantA.slug}/preview`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(previewRes.body.data.restaurant.themePreviousPublished).toBeUndefined();
  });
});

describe("POST /restaurants/:restaurantId/theme/discard-draft", () => {
  it("discards the draft without touching the published theme", async () => {
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantB.id}/theme/draft`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ themeKey: "editorial" });

    const discardRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantB.id}/theme/discard-draft`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(discardRes.status).toBe(200);

    const stored = await Restaurant.findById(restaurantB._id).select("settings.theme themeDraft");
    expect(stored!.themeDraft).toBeUndefined();
    expect(stored!.settings.theme.themeKey).toBe("classic");
  });
});

describe("Agency authorization (Phase 31 Step 19)", () => {
  let business: Awaited<ReturnType<typeof createTestBusiness>>;
  let location: Awaited<ReturnType<typeof createTestRestaurant>>;
  let agency: Awaited<ReturnType<typeof createTestAgency>>;
  let agencyAdminUser: Awaited<ReturnType<typeof createTestUser>>;
  let agencyStaffUser: Awaited<ReturnType<typeof createTestUser>>;
  let outsiderAgency: Awaited<ReturnType<typeof createTestAgency>>;
  let outsiderUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    agency = await createTestAgency();
    business = await createTestBusiness({ agencyId: agency._id });
    location = await createTestRestaurant({ businessId: business._id });

    agencyAdminUser = await createTestUser("agency_member");
    await createTestAgencyMembership(agency._id, agencyAdminUser._id, { role: "agency_admin" });

    agencyStaffUser = await createTestUser("agency_member");
    await createTestAgencyMembership(agency._id, agencyStaffUser._id, { role: "agency_staff", businessIds: [business._id] });

    outsiderAgency = await createTestAgency();
    outsiderUser = await createTestUser("agency_member");
    await createTestAgencyMembership(outsiderAgency._id, outsiderUser._id, { role: "agency_owner" });
  });

  afterAll(async () => {
    await Promise.all([
      AuditLog.deleteMany({ restaurantId: location._id }),
      Restaurant.deleteOne({ _id: location._id }),
      Business.deleteOne({ _id: business._id }),
      AgencyMembership.deleteMany({ agencyId: { $in: [agency._id, outsiderAgency._id] } }),
      Agency.deleteMany({ _id: { $in: [agency._id, outsiderAgency._id] } }),
      User.deleteMany({ _id: { $in: [agencyAdminUser._id, agencyStaffUser._id, outsiderUser._id] } }),
    ]);
  });

  it("lets an agency_admin (holds restaurant.settings.manage) manage a managed location's theme", async () => {
    const token = tokenFor(agencyAdminUser, [{ agencyId: agency.id, role: "agency_admin" }]);
    const res = await request(app)
      .patch(`/api/v1/restaurants/${location.id}/theme/draft`)
      .set("Authorization", `Bearer ${token}`)
      .send({ themeKey: "editorial" });
    expect(res.status).toBe(200);
  });

  it("rejects an agency_staff member (read-only role, no restaurant.settings.manage) even with explicit businessIds", async () => {
    const token = tokenFor(agencyStaffUser, [{ agencyId: agency.id, role: "agency_staff" }]);
    const res = await request(app)
      .patch(`/api/v1/restaurants/${location.id}/theme/draft`)
      .set("Authorization", `Bearer ${token}`)
      .send({ themeKey: "modern" });
    expect(res.status).toBe(403);
  });

  it("rejects an agency_owner from a different agency that doesn't manage this business", async () => {
    const token = tokenFor(outsiderUser, [{ agencyId: outsiderAgency.id, role: "agency_owner" }]);
    const res = await request(app)
      .get(`/api/v1/restaurants/${location.id}/theme`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
