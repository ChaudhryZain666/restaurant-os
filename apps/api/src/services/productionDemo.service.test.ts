import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";
import { getEmailService } from "../email/index.js";
import {
  DEMO_CATEGORIES,
  DEMO_MENU_ITEMS,
  DEMO_MODIFIER_GROUPS,
} from "../scripts/demo/wildwoodKitchenCatalog.js";
import {
  DEMO_OWNER_EMAIL,
  DEMO_SLUG,
  DemoProvisioningConflictError,
  inviteDemoManager,
  provisionProductionDemo,
} from "./productionDemo.service.js";

/**
 * Phase 85A — the production demo provisioner. Runs against unique slugs/owner emails: the test
 * database is shared with other suites (sitemap.routes.test.ts creates its own "demo-restaurant").
 */
// Provisioning is ~50 sequential writes plus one cost-12 bcrypt hash — comfortably over Jest's 5s
// default when the full suite is competing for the same local MongoDB.
jest.setTimeout(30_000);

const run = Date.now();
const slug = `demo-provision-${run}`;
const ownerEmail = `demo-owner-${run}@demo-restaurant.garnishtable.invalid`;
const conflictSlug = `demo-conflict-${run}`;

const managerEmail = `founder+demo-${run}@example.com`;
const failedEmail = `founder+demo-fail-${run}@example.com`;
const extraUserIds: string[] = [];

let conflictRestaurantId: mongoose.Types.ObjectId;

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  const restaurants = await Restaurant.find({ slug: { $in: [slug, conflictSlug] } });
  const ids = restaurants.map((r) => r._id);
  await Promise.all([
    Category.deleteMany({ restaurantId: { $in: ids } }),
    MenuItem.deleteMany({ restaurantId: { $in: ids } }),
    ModifierGroup.deleteMany({ restaurantId: { $in: ids } }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
    Business.deleteMany({ slug: { $in: [slug, conflictSlug] } }),
    User.deleteMany({ email: { $in: [ownerEmail, managerEmail, failedEmail] } }),
    User.deleteMany({ _id: { $in: extraUserIds } }),
  ]);
  await closeTestConnections();
});

describe("provisionProductionDemo", () => {
  it("defaults to the marketing site's demo slug and an undeliverable .invalid owner", () => {
    expect(DEMO_SLUG).toBe("demo-restaurant");
    expect(DEMO_OWNER_EMAIL).toMatch(/\.invalid$/);
  });

  it("creates the full storefront when it's absent — and nothing else", async () => {
    const result = await provisionProductionDemo({ slug, ownerEmail });
    expect(result.created).toEqual({
      owner: true,
      business: true,
      restaurant: true,
      categories: DEMO_CATEGORIES.length,
      menuItems: DEMO_MENU_ITEMS.length,
      modifierGroups: DEMO_MODIFIER_GROUPS.length,
    });

    const restaurant = await Restaurant.findOne({ slug });
    expect(restaurant).not.toBeNull();
    expect(restaurant!.status).toBe("active");
    expect(restaurant!.settings.orderingEnabled).toBe(true);
    expect(restaurant!.settings.onlinePaymentEnabled).toBe(false);
    expect(restaurant!.email ?? null).toBeNull();

    const owner = await User.findOne({ email: ownerEmail });
    expect(owner!.role).toBe("restaurant_owner");
    expect(owner!.restaurantId!.equals(restaurant!._id)).toBe(true);

    const items = await MenuItem.find({ restaurantId: restaurant!._id });
    expect(items).toHaveLength(DEMO_MENU_ITEMS.length);
    expect(items.every((i) => i.businessId?.equals(restaurant!.businessId!))).toBe(true);
    expect(await Order.countDocuments({ restaurantId: restaurant!._id })).toBe(0);
  });

  it("is idempotent: a second run creates nothing and duplicates nothing", async () => {
    const restaurant = await Restaurant.findOne({ slug });
    const before = await MenuItem.findOne({ restaurantId: restaurant!._id, name: "Margherita Pizza" });

    const result = await provisionProductionDemo({ slug, ownerEmail });
    expect(result.created).toEqual({ owner: false, business: false, restaurant: false, categories: 0, menuItems: 0, modifierGroups: 0 });
    expect(await Category.countDocuments({ restaurantId: restaurant!._id })).toBe(DEMO_CATEGORIES.length);
    expect(await MenuItem.countDocuments({ restaurantId: restaurant!._id })).toBe(DEMO_MENU_ITEMS.length);
    expect(await ModifierGroup.countDocuments({ restaurantId: restaurant!._id })).toBe(DEMO_MODIFIER_GROUPS.length);
    const after = await MenuItem.findOne({ restaurantId: restaurant!._id, name: "Margherita Pizza" });
    expect(after!.id).toBe(before!.id);
  });

  it("never overwrites existing demo content (an edited price survives a re-run)", async () => {
    const restaurant = await Restaurant.findOne({ slug });
    await MenuItem.updateOne({ restaurantId: restaurant!._id, name: "Margherita Pizza" }, { price: 99 });
    await provisionProductionDemo({ slug, ownerEmail });
    expect((await MenuItem.findOne({ restaurantId: restaurant!._id, name: "Margherita Pizza" }))!.price).toBe(99);
  });

  it("refuses, changing nothing, when a real restaurant already owns the slug", async () => {
    const real = await createTestRestaurant({ slug: conflictSlug, name: "A Real Restaurant" });
    conflictRestaurantId = real._id;

    await expect(provisionProductionDemo({ slug: conflictSlug, ownerEmail })).rejects.toBeInstanceOf(DemoProvisioningConflictError);

    const untouched = await Restaurant.findById(conflictRestaurantId);
    expect(untouched!.name).toBe("A Real Restaurant");
    expect(untouched!.ownerId.equals(real.ownerId)).toBe(true);
    expect(await Category.countDocuments({ restaurantId: conflictRestaurantId })).toBe(0);
    expect(await Business.countDocuments({ slug: conflictSlug })).toBe(0);
  });
});

describe("inviteDemoManager (Lane A) — separate demo login, admin account untouched", () => {
  const app = createApp();

  it("invites a restaurant_manager scoped to the demo through the normal staff-invite flow", async () => {
    const send = jest.spyOn(getEmailService(), "send");
    const { restaurantId, userId } = await inviteDemoManager({ name: "Founder Demo", email: managerEmail.toUpperCase(), slug, ownerEmail });

    const manager = await User.findById(userId);
    expect(manager).toMatchObject({ email: managerEmail, role: "restaurant_manager", isActive: true });
    expect(manager!.restaurantId!.toString()).toBe(restaurantId);
    expect(manager!.inviteTokenHash).toBeTruthy();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: managerEmail }));
  });

  it("the manager can work in the demo only — not another restaurant, not the platform console", async () => {
    const manager = await User.findOne({ email: managerEmail });
    const demo = await Restaurant.findOne({ slug });
    const other = await Restaurant.findById(conflictRestaurantId);
    const token = tokenFor(manager!);

    const own = await request(app).get(`/api/v1/restaurants/${demo!.id}/categories`).set("Authorization", `Bearer ${token}`);
    expect(own.status).toBe(200);
    const foreign = await request(app).get(`/api/v1/restaurants/${other!.id}/categories`).set("Authorization", `Bearer ${token}`);
    expect(foreign.status).toBe(403);
    const platform = await request(app).get("/api/v1/platform/restaurants").set("Authorization", `Bearer ${token}`);
    expect(platform.status).toBe(403);
  });

  it("refuses an email that already has an account, leaving that account's role unchanged", async () => {
    const admin = await createTestUser("platform_admin");
    extraUserIds.push(admin.id);

    await expect(inviteDemoManager({ name: "Founder", email: admin.email, slug, ownerEmail })).rejects.toBeInstanceOf(
      DemoProvisioningConflictError
    );
    expect((await User.findById(admin.id))!.role).toBe("platform_admin");
    const res = await request(app).get("/api/v1/platform/restaurants").set("Authorization", `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
  });

  it("refuses a restaurant that isn't the demo tenant", async () => {
    await expect(
      inviteDemoManager({ name: "Founder", email: `nobody-${run}@example.com`, slug: conflictSlug, ownerEmail })
    ).rejects.toBeInstanceOf(DemoProvisioningConflictError);
    expect(await User.exists({ email: `nobody-${run}@example.com` })).toBeNull();
  });

  it("removes the new account again when the invite email can't be sent", async () => {
    jest.spyOn(getEmailService(), "send").mockRejectedValueOnce(new Error("smtp down"));
    await expect(inviteDemoManager({ name: "Founder", email: failedEmail, slug, ownerEmail })).rejects.toThrow(/could not be sent/);
    expect(await User.exists({ email: failedEmail })).toBeNull();
  });
});
