import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
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
import { priceOrderItems } from "./orderPricing.service.js";

/**
 * Phase 20 — the actual trust boundary this phase exists to fix. Every test here asks the same
 * question the docs flagged as the risk: does "available somewhere in the business" ever get
 * mistaken for "available at THIS location"? It must not, in either direction.
 */

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
    ModifierGroupLocationOverride.deleteMany({ businessId: business._id }),
  ]);
  await closeTestConnections();
});

describe("priceOrderItems — canonical path, cross-business isolation", () => {
  it("rejects a menu item canonical to a different business entirely", async () => {
    const otherBusiness = await createTestBusiness();
    const otherLocation = await createTestRestaurant({ businessId: otherBusiness._id });
    const otherCategory = await createTestCategory(otherLocation._id, { businessId: otherBusiness._id });
    const otherItem = await createTestMenuItem(otherLocation._id, otherCategory._id, {
      businessId: otherBusiness._id,
      price: 999,
    });
    // Give locationA a canonical menu of its own so it's on the canonical path, not the legacy one.
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    await createTestMenuItem(locationA._id, category._id, { businessId: business._id, price: 10 });

    await expect(priceOrderItems(locationA.id, [{ menuItemId: otherItem.id, quantity: 1, selectedModifiers: [] }])).rejects.toThrow(
      /unavailable or do not exist/
    );

    await Promise.all([
      MenuItem.deleteMany({ businessId: otherBusiness._id }),
      Category.deleteMany({ businessId: otherBusiness._id }),
    ]);
  });
});

describe("priceOrderItems — canonical path, per-location availability", () => {
  it("rejects an item hidden by canonical default with no override at this location", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const hiddenItem = await createTestMenuItem(locationA._id, category._id, {
      businessId: business._id,
      isAvailable: false,
    });

    await expect(
      priceOrderItems(locationA.id, [{ menuItemId: hiddenItem.id, quantity: 1, selectedModifiers: [] }])
    ).rejects.toThrow(/unavailable or do not exist/);
  });

  it("rejects an item hidden at THIS location via override despite canonical default being available", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id, isAvailable: true });
    await MenuItemLocationOverride.create({
      businessId: business._id,
      locationId: locationA._id,
      menuItemId: item._id,
      isAvailable: false,
    });

    await expect(priceOrderItems(locationA.id, [{ menuItemId: item.id, quantity: 1, selectedModifiers: [] }])).rejects.toThrow(
      /unavailable or do not exist/
    );
  });

  it("THE core bug class this phase exists to close: rejects an item available at a SIBLING location via override, when ordering from a location where it is not available", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    // Canonical default hidden everywhere...
    const exclusiveItem = await createTestMenuItem(locationA._id, category._id, {
      businessId: business._id,
      isAvailable: false,
    });
    // ...except explicitly turned on at location B only.
    await MenuItemLocationOverride.create({
      businessId: business._id,
      locationId: locationB._id,
      menuItemId: exclusiveItem._id,
      isAvailable: true,
    });

    // A customer browsing/ordering from location A must never be able to order it, even though
    // it's genuinely orderable at sibling location B of the same business.
    await expect(
      priceOrderItems(locationA.id, [{ menuItemId: exclusiveItem.id, quantity: 1, selectedModifiers: [] }])
    ).rejects.toThrow(/unavailable or do not exist/);

    // Confirm it's a real, working exclusive item at B — not just always rejected everywhere.
    const pricedAtB = await priceOrderItems(locationB.id, [{ menuItemId: exclusiveItem.id, quantity: 1, selectedModifiers: [] }]);
    expect(pricedAtB.items).toHaveLength(1);
  });
});

describe("priceOrderItems — canonical path, per-location price resolution", () => {
  it("charges the location's own price override, never the canonical default, never a sibling's override", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id, price: 10 });
    await MenuItemLocationOverride.create({
      businessId: business._id,
      locationId: locationA._id,
      menuItemId: item._id,
      priceOverride: 15,
    });
    await MenuItemLocationOverride.create({
      businessId: business._id,
      locationId: locationB._id,
      menuItemId: item._id,
      priceOverride: 8,
    });

    const pricedA = await priceOrderItems(locationA.id, [{ menuItemId: item.id, quantity: 1, selectedModifiers: [] }]);
    expect(pricedA.items[0].unitPrice).toBe(15);
    expect(pricedA.subtotal).toBe(15);

    const pricedB = await priceOrderItems(locationB.id, [{ menuItemId: item.id, quantity: 1, selectedModifiers: [] }]);
    expect(pricedB.items[0].unitPrice).toBe(8);
  });

  it("charges the canonical default price when no override exists at this location", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id, price: 20 });

    const priced = await priceOrderItems(locationA.id, [{ menuItemId: item.id, quantity: 3, selectedModifiers: [] }]);
    expect(priced.items[0].unitPrice).toBe(20);
    expect(priced.subtotal).toBe(60);
  });
});

describe("priceOrderItems — canonical path, modifier option overrides", () => {
  it("resolves an overridden option price adjustment, and rejects an option hidden via override at this location", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id, price: 10 });
    const group = await createTestModifierGroup(locationA._id, item._id, {
      businessId: business._id,
      minSelect: 1,
      maxSelect: 1,
      options: [
        { name: "Small", priceAdjustment: 0, isActive: true, sortOrder: 0 },
        { name: "Large", priceAdjustment: 2, isActive: true, sortOrder: 1 },
      ],
    });
    const largeOptionId = group.options[1]._id.toString();

    await ModifierGroupLocationOverride.create({
      businessId: business._id,
      locationId: locationA._id,
      modifierGroupId: group._id,
      optionOverrides: [{ optionId: group.options[1]._id, priceAdjustmentOverride: 5 }],
    });

    const priced = await priceOrderItems(locationA.id, [
      { menuItemId: item.id, quantity: 1, selectedModifiers: [{ groupId: group.id, optionId: largeOptionId }] },
    ]);
    expect(priced.items[0].selectedModifiers[0].priceAdjustment).toBe(5);
    expect(priced.items[0].lineTotal).toBe(15); // 10 + 5

    // Now hide that same option via override at location B — selecting it there must be rejected.
    await ModifierGroupLocationOverride.create({
      businessId: business._id,
      locationId: locationB._id,
      modifierGroupId: group._id,
      optionOverrides: [{ optionId: group.options[1]._id, isActive: false }],
    });
    await expect(
      priceOrderItems(locationB.id, [
        { menuItemId: item.id, quantity: 1, selectedModifiers: [{ groupId: group.id, optionId: largeOptionId }] },
      ])
    ).rejects.toThrow(/invalid or unavailable/);
  });

  it("rejects a modifier group hidden at this location via override, treating it as if it doesn't exist here", async () => {
    const category = await createTestCategory(locationA._id, { businessId: business._id });
    const item = await createTestMenuItem(locationA._id, category._id, { businessId: business._id, price: 10 });
    const group = await createTestModifierGroup(locationA._id, item._id, {
      businessId: business._id,
      minSelect: 0,
      maxSelect: 1,
      options: [{ name: "Extra", priceAdjustment: 1, isActive: true, sortOrder: 0 }],
    });
    await ModifierGroupLocationOverride.create({
      businessId: business._id,
      locationId: locationA._id,
      modifierGroupId: group._id,
      isActive: false,
    });

    await expect(
      priceOrderItems(locationA.id, [
        { menuItemId: item.id, quantity: 1, selectedModifiers: [{ groupId: group.id, optionId: group.options[0]._id.toString() }] },
      ])
    ).rejects.toThrow(/does not belong to menu item/);
  });
});

describe("priceOrderItems — dual-path: legacy (pre-migration) behavior is unchanged", () => {
  it("prices correctly via the legacy restaurantId-scoped path for a business with no canonical menu", async () => {
    const legacyRestaurant = await createTestRestaurant(); // no businessId at all
    const category = await createTestCategory(legacyRestaurant._id);
    const item = await createTestMenuItem(legacyRestaurant._id, category._id, { price: 7 });

    const priced = await priceOrderItems(legacyRestaurant.id, [{ menuItemId: item.id, quantity: 2, selectedModifiers: [] }]);
    expect(priced.items[0].unitPrice).toBe(7);
    expect(priced.subtotal).toBe(14);

    await Promise.all([
      MenuItem.deleteMany({ restaurantId: legacyRestaurant._id }),
      Category.deleteMany({ restaurantId: legacyRestaurant._id }),
    ]);
  });

  it("a business with businessId but not yet migrated (no canonical menu) also uses the legacy path", async () => {
    const notYetMigratedBusiness = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: notYetMigratedBusiness._id });
    // Old-style, restaurantId-scoped item — no businessId set on the MenuItem itself.
    const category = await createTestCategory(location._id);
    const item = await createTestMenuItem(location._id, category._id, { price: 9 });

    const priced = await priceOrderItems(location.id, [{ menuItemId: item.id, quantity: 1, selectedModifiers: [] }]);
    expect(priced.items[0].unitPrice).toBe(9);

    await Promise.all([
      MenuItem.deleteMany({ restaurantId: location._id }),
      Category.deleteMany({ restaurantId: location._id }),
    ]);
  });
});
