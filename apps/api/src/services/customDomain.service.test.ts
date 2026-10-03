import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { DomainMapping } from "../models/DomainMapping.js";
import { Business } from "../models/Business.js";
import { Plan } from "../models/Plan.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import {
  closeTestConnections,
  createTestBusiness,
  createTestPlan,
  createTestRestaurant,
  createTestSubscription,
} from "../test-utils/fixtures.js";
import { canonicalCustomDomain, resolveCustomDomain } from "./customDomain.service.js";

/**
 * Phase 86 — the authorization matrix behind both the TLS edge's certificate check and the
 * storefront's by-domain lookup (one decision function, customDomain.service.ts).
 */
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const host = (label: string) => `${label}-${stamp}.p86-test.example`;

const businessIds: mongoose.Types.ObjectId[] = [];
const restaurantIds: mongoose.Types.ObjectId[] = [];
const planIds: mongoose.Types.ObjectId[] = [];

let entitledPlan: Awaited<ReturnType<typeof createTestPlan>>;
let plainPlan: Awaited<ReturnType<typeof createTestPlan>>;

async function tenant({ entitled = true, restaurantStatus = "active" }: { entitled?: boolean; restaurantStatus?: string } = {}) {
  const business = await createTestBusiness();
  const restaurant = await createTestRestaurant({ businessId: business._id, ownerId: business.ownerId, status: restaurantStatus });
  businessIds.push(business._id);
  restaurantIds.push(restaurant._id);
  await createTestSubscription("business", business._id, (entitled ? entitledPlan : plainPlan)._id);
  return { business, restaurant };
}

async function mapping(hostname: string, t: Awaited<ReturnType<typeof tenant>>, status: "pending_verification" | "verified" | "active") {
  return DomainMapping.create({
    hostname,
    businessId: t.business._id,
    locationId: t.restaurant._id,
    status,
    verificationToken: "token",
    ...(status !== "pending_verification" ? { verifiedAt: new Date() } : {}),
    ...(status === "active" ? { activatedAt: new Date() } : {}),
  });
}

beforeAll(async () => {
  await connectDB();
  entitledPlan = await createTestPlan({ code: `p86-entitled-${stamp}`, entitlements: [{ key: "custom_domains", value: true }] });
  plainPlan = await createTestPlan({ code: `p86-plain-${stamp}`, entitlements: [{ key: "custom_domains", value: false }] });
  planIds.push(entitledPlan._id, plainPlan._id);
});

afterAll(async () => {
  await Promise.all([
    DomainMapping.deleteMany({ hostname: { $regex: `-${stamp}\\.p86-test\\.example$` } }),
    Subscription.deleteMany({ ownerId: { $in: businessIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
  ]);
  await closeTestConnections();
});

describe("canonicalCustomDomain", () => {
  it.each([
    ["Orders.Example.COM", "orders.example.com"],
    ["orders.example.com.", "orders.example.com"],
    ["  https://orders.example.com/ ", "orders.example.com"],
  ])("normalizes %s to %s", (raw, expected) => {
    expect(canonicalCustomDomain(raw)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["203.0.113.7", "IPv4 address"],
    ["[2001:db8::1]", "IPv6 address"],
    ["orders.example.com:8443", "port"],
    ["https://orders.example.com/path", "path"],
    ["localhost", "single label"],
    ["api.localhost", "localhost suffix"],
    ["redis.internal", ".internal"],
    ["printer.local", ".local"],
    ["foo.test", ".test"],
    ["bad_name.example.com", "underscore"],
    ["-lead.example.com", "leading hyphen"],
    [`${"a".repeat(64)}.example.com`, "label over 63 chars"],
    [`${"a.".repeat(130)}com`, "name over 253 chars"],
    ["exa mple.com", "whitespace"],
  ])("rejects %s (%s)", (raw) => {
    expect(canonicalCustomDomain(raw)).toBeNull();
  });

  it("rejects non-string input (e.g. a repeated ?domain= query parameter)", () => {
    expect(canonicalCustomDomain(["a.example.com", "b.example.com"])).toBeNull();
    expect(canonicalCustomDomain(undefined)).toBeNull();
  });
});

describe("resolveCustomDomain — certificate/serving authorization matrix", () => {
  it("ALLOWS an active, verified domain of an active, entitled restaurant", async () => {
    const t = await tenant();
    const h = host("live");
    await mapping(h, t, "active");
    const decision = await resolveCustomDomain(h);
    expect(decision).toEqual({ live: true, hostname: h, restaurantId: t.restaurant.id });
  });

  it("gives the same answer for uppercase and trailing-dot spellings", async () => {
    const t = await tenant();
    const h = host("canon");
    await mapping(h, t, "active");
    expect((await resolveCustomDomain(h.toUpperCase())).live).toBe(true);
    expect((await resolveCustomDomain(`${h}.`)).live).toBe(true);
  });

  it("DENIES a verified but inactive domain", async () => {
    const t = await tenant();
    const h = host("verified");
    await mapping(h, t, "verified");
    expect(await resolveCustomDomain(h)).toMatchObject({ live: false, reason: "not_active" });
  });

  it("DENIES an unverified (pending) domain", async () => {
    const t = await tenant();
    const h = host("pending");
    await mapping(h, t, "pending_verification");
    expect(await resolveCustomDomain(h)).toMatchObject({ live: false, reason: "not_active" });
  });

  it("DENIES an unknown domain", async () => {
    expect(await resolveCustomDomain(host("unknown"))).toMatchObject({ live: false, reason: "not_mapped" });
  });

  it("DENIES malformed hostnames and IP addresses without touching the database", async () => {
    for (const raw of ["not a host", "203.0.113.7", "orders.example.com:443", "api.internal"]) {
      expect(await resolveCustomDomain(raw)).toEqual({ live: false, hostname: null, reason: "malformed_hostname" });
    }
  });

  it("DENIES once deactivated (active → verified), and ALLOWS again on re-activation", async () => {
    const t = await tenant();
    const h = host("toggle");
    const m = await mapping(h, t, "active");
    expect((await resolveCustomDomain(h)).live).toBe(true);
    await DomainMapping.updateOne({ _id: m._id }, { status: "verified" });
    expect(await resolveCustomDomain(h)).toMatchObject({ live: false, reason: "not_active" });
    await DomainMapping.updateOne({ _id: m._id }, { status: "active" });
    expect((await resolveCustomDomain(h)).live).toBe(true);
  });

  it("DENIES when the restaurant is not active", async () => {
    const t = await tenant({ restaurantStatus: "suspended" });
    const h = host("suspended");
    await mapping(h, t, "active");
    expect(await resolveCustomDomain(h)).toMatchObject({ live: false, reason: "restaurant_inactive" });
  });

  it("DENIES when the business has lost the custom_domains entitlement", async () => {
    const t = await tenant({ entitled: false });
    const h = host("unentitled");
    await mapping(h, t, "active");
    expect(await resolveCustomDomain(h)).toMatchObject({ live: false, reason: "not_entitled" });
  });

  it("resolves each domain to its own tenant only (no cross-tenant routing)", async () => {
    const a = await tenant();
    const b = await tenant();
    const ha = host("tenant-a");
    const hb = host("tenant-b");
    await mapping(ha, a, "active");
    await mapping(hb, b, "active");
    expect(await resolveCustomDomain(ha)).toMatchObject({ live: true, restaurantId: a.restaurant.id });
    expect(await resolveCustomDomain(hb)).toMatchObject({ live: true, restaurantId: b.restaurant.id });
  });

  it("takeover protection: a removed domain claimed by another tenant stays DENIED until that tenant verifies and activates it", async () => {
    const original = await tenant();
    const newcomer = await tenant();
    const h = host("takeover");
    const m = await mapping(h, original, "active");
    await DomainMapping.deleteOne({ _id: m._id }); // the original restaurant removes it

    // The newcomer adds it: a fresh pending mapping with a fresh token — not served, not issuable.
    await DomainMapping.create({ hostname: h, businessId: newcomer.business._id, locationId: newcomer.restaurant._id, status: "pending_verification", verificationToken: "new-token" });
    expect(await resolveCustomDomain(h)).toMatchObject({ live: false, reason: "not_active" });

    // A second claim on the same hostname is impossible while one exists (unique index).
    await expect(
      DomainMapping.create({ hostname: h, businessId: original.business._id, locationId: original.restaurant._id, status: "active", verificationToken: "x" })
    ).rejects.toMatchObject({ code: 11000 });
  });
});
