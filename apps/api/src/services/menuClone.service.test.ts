import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { MenuItemLocationOverride } from "../models/MenuItemLocationOverride.js";
import {
  closeTestConnections,
  createTestBusiness,
  createTestCategory,
  createTestMenuItem,
  createTestRestaurant,
} from "../test-utils/fixtures.js";
import { cloneMenuToRestaurant } from "./menuClone.service.js";
import { resolveMenuForLocation } from "./menuResolution.service.js";

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await closeTestConnections();
});

describe("cloneMenuToRestaurant — canonical path (business already migrated)", () => {
  it("seeds override rows at the target from the source location's divergences, rather than copying documents", async () => {
    const business = await createTestBusiness();
    const source = await createTestRestaurant({ businessId: business._id });
    const target = await createTestRestaurant({ businessId: business._id });

    const category = await createTestCategory(source._id, { businessId: business._id, name: "Mains" });
    const item = await createTestMenuItem(source._id, category._id, { businessId: business._id, price: 10 });
    // Source diverges from canonical via an override — this is what "clone" should seed onto target.
    await MenuItemLocationOverride.create({
      businessId: business._id,
      locationId: source._id,
      menuItemId: item._id,
      priceOverride: 12,
    });

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await cloneMenuToRestaurant(business._id, source._id, target._id, session);
      });
    } finally {
      await session.endSession();
    }

    // No new MenuItem/Category documents were created for the target — it inherits canonically.
    const targetOwnDocs = await MenuItem.find({ restaurantId: target._id });
    expect(targetOwnDocs).toHaveLength(0);

    const targetOverride = await MenuItemLocationOverride.findOne({ locationId: target._id, menuItemId: item._id });
    expect(targetOverride?.priceOverride).toBe(12);

    const resolvedTarget = await resolveMenuForLocation(business.id, target.id, { includeHidden: false });
    expect(resolvedTarget.items.find((i) => i.id === item.id)?.price).toBe(12);

    // Future canonical changes still reach the "cloned" location — cloning never severs the
    // business relationship, it only front-loads a divergence snapshot.
    const newCategory = await createTestCategory(source._id, { businessId: business._id, name: "New Category" });
    const newItem = await createTestMenuItem(source._id, newCategory._id, { businessId: business._id, price: 5 });
    const resolvedAfterCanonicalAddition = await resolveMenuForLocation(business.id, target.id, { includeHidden: false });
    expect(resolvedAfterCanonicalAddition.items.some((i) => i.id === newItem.id)).toBe(true);

    await Promise.all([
      MenuItem.deleteMany({ businessId: business._id }),
      Category.deleteMany({ businessId: business._id }),
      MenuItemLocationOverride.deleteMany({ businessId: business._id }),
    ]);
  });

  it("seeds no override rows when the source location has no divergence from canonical", async () => {
    const business = await createTestBusiness();
    const source = await createTestRestaurant({ businessId: business._id });
    const target = await createTestRestaurant({ businessId: business._id });
    const category = await createTestCategory(source._id, { businessId: business._id });
    await createTestMenuItem(source._id, category._id, { businessId: business._id, price: 10 });

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await cloneMenuToRestaurant(business._id, source._id, target._id, session);
      });
    } finally {
      await session.endSession();
    }

    expect(await MenuItemLocationOverride.countDocuments({ locationId: target._id })).toBe(0);

    await Promise.all([
      MenuItem.deleteMany({ businessId: business._id }),
      Category.deleteMany({ businessId: business._id }),
    ]);
  });
});

describe("cloneMenuToRestaurant — legacy path (business not yet migrated)", () => {
  it("still copies whole documents, unchanged from before Phase 20", async () => {
    const business = await createTestBusiness();
    const source = await createTestRestaurant({ businessId: business._id });
    const target = await createTestRestaurant({ businessId: business._id });
    // No businessId on these documents — this business has not been migrated to canonical.
    const category = await createTestCategory(source._id, { name: "Legacy Mains" });
    await createTestMenuItem(source._id, category._id, { name: "Legacy Burger", price: 11 });

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await cloneMenuToRestaurant(business._id, source._id, target._id, session);
      });
    } finally {
      await session.endSession();
    }

    const clonedItem = await MenuItem.findOne({ restaurantId: target._id, name: "Legacy Burger" });
    expect(clonedItem).not.toBeNull();
    expect(clonedItem!.price).toBe(11);

    await Promise.all([
      MenuItem.deleteMany({ restaurantId: { $in: [source._id, target._id] } }),
      Category.deleteMany({ restaurantId: { $in: [source._id, target._id] } }),
    ]);
  });
});
