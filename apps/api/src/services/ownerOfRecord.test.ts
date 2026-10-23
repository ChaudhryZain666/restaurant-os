import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { AuditLog } from "../models/AuditLog.js";
import { Business } from "../models/Business.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestBusiness, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";
import { DemoProvisioningConflictError, provisionProductionDemo, transferDemoOwnership } from "./productionDemo.service.js";

/**
 * Lane A / roadmap "demo ownership and admin access": a platform admin who is the recorded owner of
 * a business can run it as its owner — and only it — without its role changing; the demo can be
 * moved to such an admin and back, idempotently and audited; demo provisioning keeps working.
 */
jest.setTimeout(30_000);

const app = createApp();
const run = Date.now();
const slug = `demo-ownership-${run}`;
const ownerEmail = `demo-owner-${run}@demo-restaurant.garnishtable.invalid`;
const userIds: mongoose.Types.ObjectId[] = [];
const businessIds: mongoose.Types.ObjectId[] = [];
const restaurantIds: mongoose.Types.ObjectId[] = [];

let admin: Awaited<ReturnType<typeof createTestUser>>;
let otherAdmin: Awaited<ReturnType<typeof createTestUser>>;
let adminToken: string;
let otherAdminToken: string;
let unrelated: Awaited<ReturnType<typeof createTestRestaurant>>;

beforeAll(async () => {
  await connectDB();
  admin = await createTestUser("platform_admin");
  otherAdmin = await createTestUser("platform_admin");
  userIds.push(admin._id, otherAdmin._id);
  adminToken = tokenFor(admin);
  otherAdminToken = tokenFor(otherAdmin);
  await provisionProductionDemo({ slug, ownerEmail });
  const demo = await Restaurant.findOne({ slug });
  restaurantIds.push(demo!._id);
  businessIds.push(demo!.businessId!);
  const unrelatedBusiness = await createTestBusiness();
  businessIds.push(unrelatedBusiness._id);
  unrelated = await createTestRestaurant({ businessId: unrelatedBusiness._id, status: "active" });
  restaurantIds.push(unrelated._id);
});

afterAll(async () => {
  await Promise.all([
    Category.deleteMany({ restaurantId: { $in: restaurantIds } }),
    MenuItem.deleteMany({ restaurantId: { $in: restaurantIds } }),
    ModifierGroup.deleteMany({ restaurantId: { $in: restaurantIds } }),
    AuditLog.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    User.deleteMany({ $or: [{ _id: { $in: userIds } }, { email: ownerEmail }] }),
  ]);
  await closeTestConnections();
});

const demo = () => Restaurant.findOne({ slug });
// The business-level (canonical) menu route — the location-level one answers 410 for migrated menus.
const addCategory = (businessId: unknown, token: string) =>
  request(app).post(`/api/v1/businesses/${String(businessId)}/categories`).set("Authorization", `Bearer ${token}`).send({ name: `Cat ${Date.now()}` });

describe("platform admin as owner of record", () => {
  it("before any transfer, a platform admin can't edit the demo's menu", async () => {
    expect((await addCategory((await demo())!.businessId, adminToken)).status).toBe(403);
  });

  it("transfers the demo to the admin, keeping the admin's role, with an audit entry", async () => {
    const result = await transferDemoOwnership({ adminEmail: admin.email, slug, ownerEmail });
    expect(result.changed).toBe(true);
    const r = (await demo())!;
    expect(r.ownerId.equals(admin._id)).toBe(true);
    expect((await Business.findById(r.businessId))!.ownerId.equals(admin._id)).toBe(true);
    expect((await User.findById(admin._id))!.role).toBe("platform_admin");
    expect(await User.exists({ email: ownerEmail })).toBeTruthy(); // placeholder kept, not deleted
    expect(await AuditLog.exists({ restaurantId: r._id, action: "restaurant.owner_transferred" })).toBeTruthy();
  });

  it("is idempotent", async () => {
    expect((await transferDemoOwnership({ adminEmail: admin.email, slug, ownerEmail })).changed).toBe(false);
  });

  it("the owner-of-record admin can run the demo — and only the demo", async () => {
    const r = (await demo())!;
    expect((await addCategory(r.businessId, adminToken)).status).toBe(201);
    const locations = await request(app).get(`/api/v1/businesses/${r.businessId}/locations`).set("Authorization", `Bearer ${adminToken}`);
    expect(locations.status).toBe(200);
    expect((await addCategory(unrelated.businessId, adminToken)).status).toBe(403);
  });

  it("another platform admin who isn't the owner still can't", async () => {
    expect((await addCategory((await demo())!.businessId, otherAdminToken)).status).toBe(403);
  });

  it("platform-wide admin routes are unaffected", async () => {
    const res = await request(app).get("/api/v1/platform/restaurants").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("demo provisioning still works on the transferred demo and doesn't recreate anything", async () => {
    const result = await provisionProductionDemo({ slug, ownerEmail });
    expect(result.created).toMatchObject({ owner: false, business: false, restaurant: false });
    expect((await demo())!.ownerId.equals(admin._id)).toBe(true);
  });

  it("refuses a target that isn't a platform admin, and a demo owned by someone else", async () => {
    const owner = await createTestUser("restaurant_owner");
    userIds.push(owner._id);
    await expect(transferDemoOwnership({ adminEmail: owner.email, slug, ownerEmail })).rejects.toBeInstanceOf(DemoProvisioningConflictError);
    // A demo owned by a third account is never moved.
    await expect(transferDemoOwnership({ adminEmail: otherAdmin.email, slug, ownerEmail })).rejects.toBeInstanceOf(DemoProvisioningConflictError);
    expect((await demo())!.ownerId.equals(admin._id)).toBe(true);
  });

  it("reverting moves it back and revokes the admin's access immediately", async () => {
    const result = await transferDemoOwnership({ adminEmail: admin.email, revert: true, slug, ownerEmail });
    expect(result.changed).toBe(true);
    const placeholder = await User.findOne({ email: ownerEmail });
    expect((await demo())!.ownerId.equals(placeholder!._id)).toBe(true);
    expect((await addCategory((await demo())!.businessId, adminToken)).status).toBe(403);
  });

  it("provisioning still refuses a slug owned by a real tenant", async () => {
    const realSlug = `real-tenant-${run}`;
    const realBusiness = await createTestBusiness({ slug: realSlug });
    businessIds.push(realBusiness._id);
    await expect(provisionProductionDemo({ slug: realSlug, ownerEmail })).rejects.toBeInstanceOf(DemoProvisioningConflictError);
  });
});
