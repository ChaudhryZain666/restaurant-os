import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestRestaurant } from "../test-utils/fixtures.js";
import {
  DEMO_CATEGORIES,
  DEMO_MENU_ITEMS,
  DEMO_MODIFIER_GROUPS,
} from "../scripts/demo/wildwoodKitchenCatalog.js";
import { DEMO_OWNER_EMAIL, DEMO_SLUG, DemoProvisioningConflictError, provisionProductionDemo } from "./productionDemo.service.js";

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
    User.deleteMany({ email: ownerEmail }),
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
