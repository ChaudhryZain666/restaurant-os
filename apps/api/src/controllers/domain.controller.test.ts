import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { DomainMapping } from "../models/DomainMapping.js";
import { MockDnsRecord } from "../models/MockDnsRecord.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { verificationRecordHost } from "../services/domainVerification.service.js";
import {
  closeTestConnections,
  createTestBusiness,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let business: Awaited<ReturnType<typeof createTestBusiness>>;
let location: Awaited<ReturnType<typeof createTestRestaurant>>;
let otherBusiness: Awaited<ReturnType<typeof createTestBusiness>>;
let otherLocation: Awaited<ReturnType<typeof createTestRestaurant>>;

let ownerToken: string;
let managerToken: string;
let staffToken: string;
let kitchenStaffToken: string;
let crossBusinessOwnerToken: string;
let platformAdminToken: string;

function uniqueHostname(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.example.com`;
}

beforeAll(async () => {
  await connectDB();

  business = await createTestBusiness();
  location = await createTestRestaurant({ businessId: business._id });
  otherBusiness = await createTestBusiness();
  otherLocation = await createTestRestaurant({ businessId: otherBusiness._id });

  const owner = await createTestUser("restaurant_owner", location._id, { businessId: business._id });
  const manager = await createTestUser("restaurant_manager", location._id, { businessId: business._id });
  const staff = await createTestUser("restaurant_staff", location._id, {
    businessId: business._id,
    locationIds: [location._id],
  });
  const kitchenStaff = await createTestUser("kitchen_staff", location._id, {
    businessId: business._id,
    locationIds: [location._id],
  });
  const crossBusinessOwner = await createTestUser("restaurant_owner", otherLocation._id, { businessId: otherBusiness._id });
  const platformAdmin = await createTestUser("platform_admin");

  ownerToken = tokenFor(owner);
  managerToken = tokenFor(manager);
  staffToken = tokenFor(staff);
  kitchenStaffToken = tokenFor(kitchenStaff);
  crossBusinessOwnerToken = tokenFor(crossBusinessOwner);
  platformAdminToken = tokenFor(platformAdmin);
});

afterAll(async () => {
  const businessIds = [business._id, otherBusiness._id];
  await Promise.all([
    DomainMapping.deleteMany({ businessId: { $in: businessIds } }),
    MockDnsRecord.deleteMany({}),
    User.deleteMany({ businessId: { $in: businessIds } }),
    Restaurant.deleteMany({ businessId: { $in: businessIds } }),
  ]);
  await closeTestConnections();
});

describe("hostname normalization/validation", () => {
  it.each([
    ["https://example.com/path", "has a path, rejected outright rather than silently trimmed"],
    ["not a hostname", "contains whitespace"],
    ["192.168.1.1", "a bare IPv4 address"],
    ["localhost", "no dot — not a real custom domain shape"],
    ["", "empty"],
  ])("rejects %s (%s)", async (hostname) => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ hostname });
    expect(res.status).toBe(400);
  });

  it("normalizes a mixed-case hostname with protocol/trailing dot before storing", async () => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const raw = `HTTPS://Orders-${stamp}.Example.com./`;
    const expected = `orders-${stamp}.example.com`;
    const res = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ hostname: raw });
    expect(res.status).toBe(201);
    expect(res.body.data.domain.hostname).toBe(expected);
  });
});

// Self-claim rejection (a business can't claim the platform's own domain as a custom domain) is
// unit-tested directly against domainVerification.service.ts's isSelfClaim() in
// domainVerification.service.test.ts — this dev/test environment's CLIENT_ORIGIN resolves to the
// bare hostname "localhost", which the no-dot rule above already rejects before the self-claim
// check would ever run, so it can't be exercised meaningfully through this HTTP-level route here.

describe("POST /restaurants/:restaurantId/domains — add + authorization", () => {
  it("owner can add a domain, receiving pending_verification status and a verification token", async () => {
    const hostname = uniqueHostname("owner-add");
    const res = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ hostname });
    expect(res.status).toBe(201);
    expect(res.body.data.domain.status).toBe("pending_verification");
    expect(res.body.data.domain.verificationToken).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.data.domain.verificationRecordHost).toBe(verificationRecordHost(hostname));
    expect(res.body.data.domain.businessId).toBe(business.id);
    expect(res.body.data.domain.locationId).toBe(location.id);
  });

  it("rejects a duplicate hostname with 409, even for a different business/location", async () => {
    const hostname = uniqueHostname("dup");
    const first = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ hostname });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/restaurants/${otherLocation.id}/domains`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`)
      .send({ hostname });
    expect(second.status).toBe(409);
  });

  it("resolves a concurrent same-hostname claim to exactly one winner, not two", async () => {
    const hostname = uniqueHostname("race");
    const [a, b] = await Promise.all([
      request(app).post(`/api/v1/restaurants/${location.id}/domains`).set("Authorization", `Bearer ${ownerToken}`).send({ hostname }),
      request(app).post(`/api/v1/restaurants/${location.id}/domains`).set("Authorization", `Bearer ${ownerToken}`).send({ hostname }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await DomainMapping.countDocuments({ hostname })).toBe(1);
  });

  it.each([
    ["manager", () => managerToken],
    ["staff", () => staffToken],
    ["kitchen_staff", () => kitchenStaffToken],
    ["cross-business owner", () => crossBusinessOwnerToken],
    ["platform_admin", () => platformAdminToken],
  ])("%s cannot manage domains for this location", async (_label, getToken) => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains`)
      .set("Authorization", `Bearer ${getToken()}`)
      .send({ hostname: uniqueHostname("denied") });
    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post(`/api/v1/restaurants/${location.id}/domains`).send({ hostname: uniqueHostname("anon") });
    expect(res.status).toBe(401);
  });
});

describe("verification → activation → deactivation → removal lifecycle", () => {
  it("check-verification fails against no DNS record, succeeds once the correct TXT value is seeded, and never auto-activates", async () => {
    const hostname = uniqueHostname("lifecycle");
    const addRes = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ hostname });
    const domainId = addRes.body.data.domain.id as string;
    const token = addRes.body.data.domain.verificationToken as string;

    const beforeSeed = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains/${domainId}/check-verification`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(beforeSeed.status).toBe(200);
    expect(beforeSeed.body.data.verified).toBe(false);
    expect(beforeSeed.body.data.domain.status).toBe("pending_verification");

    // Wrong value seeded — still must not verify (proves the check compares values, not just
    // presence of *a* record).
    await MockDnsRecord.create({ hostname: verificationRecordHost(hostname), txtValues: ["not-the-real-token"] });
    const wrongValue = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains/${domainId}/check-verification`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(wrongValue.body.data.verified).toBe(false);

    await MockDnsRecord.findOneAndUpdate({ hostname: verificationRecordHost(hostname) }, { txtValues: [token] });
    const correctValue = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains/${domainId}/check-verification`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(correctValue.status).toBe(200);
    expect(correctValue.body.data.verified).toBe(true);
    expect(correctValue.body.data.domain.status).toBe("verified");
    // Never auto-activated by verification alone — activation is a separate, explicit action.
    expect(correctValue.body.data.domain.status).not.toBe("active");

    // Idempotent re-check of an already-verified domain.
    const recheck = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains/${domainId}/check-verification`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(recheck.status).toBe(200);
    expect(recheck.body.data.verified).toBe(true);
    expect(recheck.body.data.domain.status).toBe("verified");

    const activateBeforeReady = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains/${domainId}/activate`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(activateBeforeReady.status).toBe(200);
    expect(activateBeforeReady.body.data.domain.status).toBe("active");
    expect(activateBeforeReady.body.data.domain.activatedAt).toBeTruthy();

    const deactivate = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains/${domainId}/deactivate`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.data.domain.status).toBe("verified");

    const remove = await request(app)
      .delete(`/api/v1/restaurants/${location.id}/domains/${domainId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(remove.status).toBe(200);
    expect(await DomainMapping.findById(domainId)).toBeNull();
  });

  it("a token published under a DIFFERENT hostname's TXT record does not verify this domain", async () => {
    const hostnameA = uniqueHostname("cross-a");
    const hostnameB = uniqueHostname("cross-b");
    const addA = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ hostname: hostnameA });
    const tokenA = addA.body.data.domain.verificationToken as string;

    // A's token is published under B's TXT record, not A's — verifying A must still fail.
    await MockDnsRecord.create({ hostname: verificationRecordHost(hostnameB), txtValues: [tokenA] });
    const check = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains/${addA.body.data.domain.id}/check-verification`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(check.body.data.verified).toBe(false);
  });

  it("rejects activating a domain that hasn't passed verification yet", async () => {
    const addRes = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ hostname: uniqueHostname("not-verified") });
    const activate = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains/${addRes.body.data.domain.id}/activate`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(activate.status).toBe(400);
  });

  it("rejects activating a second domain for a location that already has an active one", async () => {
    async function addAndVerify(hostname: string) {
      const addRes = await request(app)
        .post(`/api/v1/restaurants/${location.id}/domains`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ hostname });
      const id = addRes.body.data.domain.id as string;
      const token = addRes.body.data.domain.verificationToken as string;
      await MockDnsRecord.create({ hostname: verificationRecordHost(hostname), txtValues: [token] });
      await request(app)
        .post(`/api/v1/restaurants/${location.id}/domains/${id}/check-verification`)
        .set("Authorization", `Bearer ${ownerToken}`);
      return id;
    }

    const firstId = await addAndVerify(uniqueHostname("swap-old"));
    const secondId = await addAndVerify(uniqueHostname("swap-new"));

    const activateFirst = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains/${firstId}/activate`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(activateFirst.status).toBe(200);

    const activateSecond = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains/${secondId}/activate`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(activateSecond.status).toBe(409);

    // Cleanup so this location has no lingering active domain affecting later tests in this file.
    await request(app).post(`/api/v1/restaurants/${location.id}/domains/${firstId}/deactivate`).set("Authorization", `Bearer ${ownerToken}`);
  });
});

describe("GET /businesses/:businessId/domains — list", () => {
  it("owner sees every domain across the business's locations", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/domains`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.domains)).toBe(true);
    expect(res.body.data.domains.length).toBeGreaterThan(0);
  });

  it("a cross-business owner cannot list this business's domains", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/domains`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /restaurants/by-domain/:hostname — public storefront resolution", () => {
  it("resolves an active domain to its location's public restaurant data", async () => {
    const hostname = uniqueHostname("public-active");
    const addRes = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ hostname });
    const id = addRes.body.data.domain.id as string;
    const token = addRes.body.data.domain.verificationToken as string;
    await MockDnsRecord.create({ hostname: verificationRecordHost(hostname), txtValues: [token] });
    await request(app).post(`/api/v1/restaurants/${location.id}/domains/${id}/check-verification`).set("Authorization", `Bearer ${ownerToken}`);
    await request(app).post(`/api/v1/restaurants/${location.id}/domains/${id}/activate`).set("Authorization", `Bearer ${ownerToken}`);

    const res = await request(app).get(`/api/v1/restaurants/by-domain/${hostname}`);
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.id).toBe(location.id);
    expect(res.body.data.restaurant.ownerId).toBeUndefined();

    await request(app).post(`/api/v1/restaurants/${location.id}/domains/${id}/deactivate`).set("Authorization", `Bearer ${ownerToken}`);
  });

  it.each(["pending_verification", "verified", "unknown", "removed"])(
    "never resolves a %s domain — 404, no fallthrough to any restaurant",
    async (kind) => {
      let hostname = uniqueHostname(`public-${kind}`);
      if (kind === "unknown") {
        // never created at all
      } else {
        const addRes = await request(app)
          .post(`/api/v1/restaurants/${location.id}/domains`)
          .set("Authorization", `Bearer ${ownerToken}`)
          .send({ hostname });
        const id = addRes.body.data.domain.id as string;
        if (kind === "verified" || kind === "removed") {
          const token = addRes.body.data.domain.verificationToken as string;
          await MockDnsRecord.create({ hostname: verificationRecordHost(hostname), txtValues: [token] });
          await request(app)
            .post(`/api/v1/restaurants/${location.id}/domains/${id}/check-verification`)
            .set("Authorization", `Bearer ${ownerToken}`);
        }
        if (kind === "removed") {
          await request(app).delete(`/api/v1/restaurants/${location.id}/domains/${id}`).set("Authorization", `Bearer ${ownerToken}`);
        }
      }

      const res = await request(app).get(`/api/v1/restaurants/by-domain/${hostname}`);
      expect(res.status).toBe(404);
    }
  );

  it("never resolves an active domain whose location has been suspended", async () => {
    const hostname = uniqueHostname("public-suspended");
    const addRes = await request(app)
      .post(`/api/v1/restaurants/${location.id}/domains`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ hostname });
    const id = addRes.body.data.domain.id as string;
    const token = addRes.body.data.domain.verificationToken as string;
    await MockDnsRecord.create({ hostname: verificationRecordHost(hostname), txtValues: [token] });
    await request(app).post(`/api/v1/restaurants/${location.id}/domains/${id}/check-verification`).set("Authorization", `Bearer ${ownerToken}`);
    await request(app).post(`/api/v1/restaurants/${location.id}/domains/${id}/activate`).set("Authorization", `Bearer ${ownerToken}`);

    await Restaurant.updateOne({ _id: location._id }, { status: "suspended" });
    try {
      const res = await request(app).get(`/api/v1/restaurants/by-domain/${hostname}`);
      expect(res.status).toBe(404);
    } finally {
      await Restaurant.updateOne({ _id: location._id }, { status: "active" });
      await request(app).post(`/api/v1/restaurants/${location.id}/domains/${id}/deactivate`).set("Authorization", `Bearer ${ownerToken}`);
    }
  });
});
