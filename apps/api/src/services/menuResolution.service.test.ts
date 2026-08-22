import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { CategoryLocationOverride } from "../models/CategoryLocationOverride.js";
import { MenuItemLocationOverride } from "../models/MenuItemLocationOverride.js";
import { ModifierGroupLocationOverride } from "../models/ModifierGroupLocationOverride.js";
import {
  closeTestConnections,
  createTestBusiness,
  createTestCategory,
  createTestMenuItem,
  createTestModifierGroup,
  createTestRestaurant,
} from "../test-utils/fixtures.js";
import { businessHasCanonicalMenu, resolveMenuForLocation } from "./menuResolution.service.js";

let business: Awaited<ReturnType<typeof createTestBusiness>>;
let locationA: Awaited<ReturnType<typeof createTestRestaurant>>;
let locationB: Awaited<ReturnType<typeof createTestRestaurant>>;

beforeAll(async () => {
  await connectDB();
  business = await createTestBusiness();
  locationA = await createTestRestaurant({ businessId: business._id });
  locationB = await createTestRestaurant({ businessId: business._id });
});

afterAll(async () => {
  await Promise.all([
    MenuItem.deleteMany({ businessId: business._id }),
    Category.deleteMany({ businessId: business._id }),
    ModifierGroup.deleteMany({ businessId: business._id }),
    MenuItemLocationOverride.deleteMany({ businessId: business._id }),
    CategoryLocationOverride.deleteMany({ businessId: business._id }),
    ModifierGroupLocationOverride.deleteMany({ businessId: business._id }),
  ]);
  await closeTestConnections();
});

describe("businessHasCanonicalMenu", () => {
  it("is false for a business with no canonical MenuItem yet, true once one exists", async () => {
    const freshBusiness = await createTestBusiness();
    const freshLocation = await createTestRestaurant({ businessId: freshBusiness._id });
    const freshCategory = await createTestCategory(freshLocation._id, { businessId: freshBusiness._id });

    expect(await businessHasCanonicalMenu(freshBusiness.id)).toBe(false);

    await createTestMenuItem(freshLocation._id, freshCategory._id, { businessId: freshBusiness._id });
    expect(await businessHasCanonicalMenu(freshBusiness.id)).toBe(true);
  });
});

describe("resolveMenuForLocation — canonical defaults, no overrides", () => {
  it("returns the canonical category/item/modifier values, with restaurantId set to the requested location, for every location with no overrides", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id, name: "Burgers", sortOrder: 1 });
    const item = await createTestMenuItem(locationA._id, category._id, {
      businessId: business._id,
      name: "Cheeseburger",
      price: 10,
      isAvailable: true,
    });
    const group = await createTestModifierGroup(locationA._id, item._id, {
      businessId: business._id,
      name: "Extras",
      options: [{ name: "Extra Cheese", priceAdjustment: 1, isActive: true, sortOrder: 0 }],
    });

    const resolvedA = await resolveMenuForLocation(business.id, locationA.id, { includeHidden: false });
    const resolvedItemA = resolvedA.items.find((i) => i.id === item.id)!;
    expect(resolvedItemA.price).toBe(10);
    expect(resolvedItemA.restaurantId).toBe(locationA.id);
    expect(resolvedA.categories.find((c) => c.id === category.id)?.name).toBe("Burgers");
    expect(resolvedA.modifierGroups.find((g) => g.id === group.id)?.options[0].priceAdjustment).toBe(1);

    // Same canonical defaults resolve identically at a sibling location with zero overrides.
    const resolvedB = await resolveMenuForLocation(business.id, locationB.id, { includeHidden: false });
    const resolvedItemB = resolvedB.items.find((i) => i.id === item.id)!;
    expect(resolvedItemB.price).toBe(10);
    expect(resolvedItemB.restaurantId).toBe(locationB.id);
  });
});

describe("resolveMenuForLocation — price/availability overrides", () => {
  it("applies a location's price override without affecting a sibling location, and reverts once the override is removed", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id, price: 10 });

    const override = await MenuItemLocationOverride.create({
      businessId: business._id,
      locationId: locationA._id,
      menuItemId: item._id,
      priceOverride: 12,
    });

    const resolvedA = await resolveMenuForLocation(business.id, locationA.id, { includeHidden: false });
    expect(resolvedA.items.find((i) => i.id === item.id)?.price).toBe(12);

    const resolvedB = await resolveMenuForLocation(business.id, locationB.id, { includeHidden: false });
    expect(resolvedB.items.find((i) => i.id === item.id)?.price).toBe(10);

    await MenuItemLocationOverride.deleteOne({ _id: override._id });
    const resolvedAAfterRemoval = await resolveMenuForLocation(business.id, locationA.id, { includeHidden: false });
    expect(resolvedAAfterRemoval.items.find((i) => i.id === item.id)?.price).toBe(10);
  });

  it("canonical change updates every non-overridden location, but an overridden location stays overridden (override lifecycle)", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id, price: 10 });
    await MenuItemLocationOverride.create({
      businessId: business._id,
      locationId: locationA._id,
      menuItemId: item._id,
      priceOverride: 12,
    });

    await MenuItem.updateOne({ _id: item._id }, { $set: { price: 11 } });

    const resolvedA = await resolveMenuForLocation(business.id, locationA.id, { includeHidden: false });
    expect(resolvedA.items.find((i) => i.id === item.id)?.price).toBe(12);

    const resolvedB = await resolveMenuForLocation(business.id, locationB.id, { includeHidden: false });
    expect(resolvedB.items.find((i) => i.id === item.id)?.price).toBe(11);
  });

  it("hides an item at one location only, via availability override, without deleting the canonical item", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id, isAvailable: true });
    await MenuItemLocationOverride.create({
      businessId: business._id,
      locationId: locationB._id,
      menuItemId: item._id,
      isAvailable: false,
    });

    const resolvedA = await resolveMenuForLocation(business.id, locationA.id, { includeHidden: false });
    expect(resolvedA.items.some((i) => i.id === item.id)).toBe(true);

    const resolvedB = await resolveMenuForLocation(business.id, locationB.id, { includeHidden: false });
    expect(resolvedB.items.some((i) => i.id === item.id)).toBe(false);

    // Staff view (includeHidden) still sees it at B, with the effective isAvailable:false so the
    // admin UI can show it as hidden rather than silently dropping it.
    const resolvedBStaff = await resolveMenuForLocation(business.id, locationB.id, { includeHidden: true });
    const staffItem = resolvedBStaff.items.find((i) => i.id === item.id);
    expect(staffItem?.isAvailable).toBe(false);
  });

  it("a location-exclusive item (canonical hidden + one override turning it on) appears only at that location", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const exclusiveItem = await createTestMenuItem(locationA._id, category._id, {
      businessId: business._id,
      name: "B-Only Special",
      isAvailable: false,
    });
    await MenuItemLocationOverride.create({
      businessId: business._id,
      locationId: locationB._id,
      menuItemId: exclusiveItem._id,
      isAvailable: true,
    });

    const resolvedA = await resolveMenuForLocation(business.id, locationA.id, { includeHidden: false });
    expect(resolvedA.items.some((i) => i.id === exclusiveItem.id)).toBe(false);

    const resolvedB = await resolveMenuForLocation(business.id, locationB.id, { includeHidden: false });
    expect(resolvedB.items.some((i) => i.id === exclusiveItem.id)).toBe(true);
  });
});

describe("resolveMenuForLocation — category and modifier overrides", () => {
  it("hides a category at one location via override without affecting a sibling", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id, isActive: true });
    await CategoryLocationOverride.create({
      businessId: business._id,
      locationId: locationA._id,
      categoryId: category._id,
      isActive: false,
    });

    const resolvedA = await resolveMenuForLocation(business.id, locationA.id, { includeHidden: false });
    expect(resolvedA.categories.some((c) => c.id === category.id)).toBe(false);

    const resolvedB = await resolveMenuForLocation(business.id, locationB.id, { includeHidden: false });
    expect(resolvedB.categories.some((c) => c.id === category.id)).toBe(true);
  });

  it("applies a modifier option price override, and hides an individually-deactivated option", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id });
    const group = await createTestModifierGroup(locationA._id, item._id, {
      businessId: business._id,
      options: [
        { name: "Small", priceAdjustment: 0, isActive: true, sortOrder: 0 },
        { name: "Large", priceAdjustment: 2, isActive: true, sortOrder: 1 },
      ],
    });
    const largeOptionId = group.options[1]._id;

    await ModifierGroupLocationOverride.create({
      businessId: business._id,
      locationId: locationA._id,
      modifierGroupId: group._id,
      optionOverrides: [{ optionId: largeOptionId, priceAdjustmentOverride: 3, isActive: true }],
    });
    await ModifierGroupLocationOverride.create({
      businessId: business._id,
      locationId: locationB._id,
      modifierGroupId: group._id,
      optionOverrides: [{ optionId: largeOptionId, isActive: false }],
    });

    const resolvedA = await resolveMenuForLocation(business.id, locationA.id, { includeHidden: false });
    const groupA = resolvedA.modifierGroups.find((g) => g.id === group.id)!;
    expect(groupA.options.find((o) => o.id === largeOptionId.toString())?.priceAdjustment).toBe(3);

    const resolvedB = await resolveMenuForLocation(business.id, locationB.id, { includeHidden: false });
    const groupB = resolvedB.modifierGroups.find((g) => g.id === group.id)!;
    expect(groupB.options.some((o) => o.id === largeOptionId.toString())).toBe(false);
  });
});

describe("resolveMenuForLocation — cross-business isolation", () => {
  it("never returns another business's canonical items even if requested with that business's own id", async () => {
    const otherBusiness = await createTestBusiness();
    const otherLocation = await createTestRestaurant({ businessId: otherBusiness._id });
    const otherCategory = await createTestCategory(otherLocation._id, { businessId: otherBusiness._id });
    const otherItem = await createTestMenuItem(otherLocation._id, otherCategory._id, { businessId: otherBusiness._id });

    const resolvedForOriginalBusiness = await resolveMenuForLocation(business.id, locationA.id, { includeHidden: false });
    expect(resolvedForOriginalBusiness.items.some((i) => i.id === otherItem.id)).toBe(false);

    await Promise.all([
      MenuItem.deleteMany({ businessId: otherBusiness._id }),
      Category.deleteMany({ businessId: otherBusiness._id }),
      mongoose.model("Restaurant").deleteOne({ _id: otherLocation._id }),
      mongoose.model("Business").deleteOne({ _id: otherBusiness._id }),
    ]);
  });
});
