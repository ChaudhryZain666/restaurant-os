import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { MenuItemLocationOverride } from "../models/MenuItemLocationOverride.js";
import {
  closeTestConnections,
  createTestBusiness,
  createTestCategory,
  createTestMenuItem,
  createTestModifierGroup,
  createTestRestaurant,
} from "../test-utils/fixtures.js";
import { migrateBusinessMenu } from "./menuBusinessMigration.service.js";
import { resolveMenuForLocation } from "./menuResolution.service.js";

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await closeTestConnections();
});

async function snapshotEffectiveMenus(businessId: string, locationIds: string[]) {
  const snapshots: Record<string, Awaited<ReturnType<typeof resolveMenuForLocation>>> = {};
  for (const locationId of locationIds) {
    snapshots[locationId] = await resolveMenuForLocation(businessId, locationId, { includeHidden: false });
  }
  return snapshots;
}

/** Normalizes away id churn (promoted/matched documents legitimately get new canonical ids
 *  through the migration) so two snapshots can be compared purely on customer-visible content —
 *  category membership is compared by NAME, never by id. */
function toComparableMenu(menu: Awaited<ReturnType<typeof resolveMenuForLocation>>) {
  const categoryNameById = new Map(menu.categories.map((c) => [c.id, c.name]));
  return {
    items: menu.items
      .map((i) => ({
        name: i.name,
        price: i.price,
        isAvailable: i.isAvailable,
        categoryName: categoryNameById.get(i.categoryId),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    categories: menu.categories.map((c) => ({ name: c.name, isActive: c.isActive })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

describe("migrateBusinessMenu — single-location business", () => {
  it("promotes the sole location's menu to canonical with zero effective change, and is idempotent", async () => {
    const business = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: business._id });
    const category = await createTestCategory(location._id, { name: "Mains" });
    await createTestMenuItem(location._id, category._id, { name: "Steak", price: 25 });

    const before = await MenuItem.find({ restaurantId: location._id }).lean();
    expect(before.length).toBe(1);

    const summary = await migrateBusinessMenu(business._id);
    expect(summary.skippedAlreadyMigrated).toBe(false);
    expect(summary.siblingLocationCount).toBe(0);
    expect(summary.itemsPromotedAsAnchor).toBe(1);

    const resolved = await resolveMenuForLocation(business.id, location.id, { includeHidden: false });
    expect(resolved.items.find((i) => i.name === "Steak")?.price).toBe(25);

    // Idempotent: running again is a no-op.
    const secondRun = await migrateBusinessMenu(business._id);
    expect(secondRun.skippedAlreadyMigrated).toBe(true);
    const resolvedAgain = await resolveMenuForLocation(business.id, location.id, { includeHidden: false });
    expect(resolvedAgain.items.find((i) => i.name === "Steak")?.price).toBe(25);
  });
});

describe("migrateBusinessMenu — multi-location, untouched clones", () => {
  it("matches sibling documents via clonedFrom*Id provenance, deletes the redundant sibling docs, and both locations resolve identically before/after", async () => {
    const business = await createTestBusiness();
    const anchor = await createTestRestaurant({ businessId: business._id, createdAt: new Date("2024-01-01") });
    const sibling = await createTestRestaurant({ businessId: business._id, createdAt: new Date("2024-02-01") });

    const anchorCategory = await createTestCategory(anchor._id, { name: "Mains", sortOrder: 1 });
    const anchorItem = await createTestMenuItem(anchor._id, anchorCategory._id, { name: "Burger", price: 10 });
    await createTestModifierGroup(anchor._id, anchorItem._id, {
      name: "Size",
      options: [{ name: "Large", priceAdjustment: 2, isActive: true, sortOrder: 0 }],
    });

    // Simulate Phase 19's clone-on-creation: same values, provenance fields set.
    const siblingCategory = await createTestCategory(sibling._id, {
      name: "Mains",
      sortOrder: 1,
      clonedFromCategoryId: anchorCategory._id,
    });
    const siblingItem = await createTestMenuItem(sibling._id, siblingCategory._id, {
      name: "Burger",
      price: 10,
      clonedFromMenuItemId: anchorItem._id,
    });
    await createTestModifierGroup(sibling._id, siblingItem._id, {
      name: "Size",
      options: [{ name: "Large", priceAdjustment: 2, isActive: true, sortOrder: 0 }],
    });

    // Both locations start with the identical effective menu (an untouched clone) — the expected
    // "before" shape, hand-built once and reused for both, since toComparableMenu resolves
    // category membership by name (never by id, which legitimately changes through migration).
    const expectedBefore = {
      items: [{ name: "Burger", price: 10, isAvailable: true, categoryName: "Mains" }],
      categories: [{ name: "Mains", isActive: true }],
    };

    const summary = await migrateBusinessMenu(business._id);
    expect(summary.categoriesMatchedUnchanged).toBe(1);
    expect(summary.itemsMatchedUnchanged).toBe(1);
    expect(summary.modifierGroupsMatchedUnchanged).toBe(1);

    // Sibling's redundant documents were deleted.
    expect(await Category.findById(siblingCategory._id)).toBeNull();
    expect(await MenuItem.findById(siblingItem._id)).toBeNull();
    // No override rows needed — nothing diverged.
    expect(await MenuItemLocationOverride.countDocuments({ locationId: sibling._id })).toBe(0);

    const afterSnapshots = await snapshotEffectiveMenus(business.id, [anchor.id, sibling.id]);
    expect(toComparableMenu(afterSnapshots[anchor.id])).toEqual(expectedBefore);
    expect(toComparableMenu(afterSnapshots[sibling.id])).toEqual(expectedBefore);
  });
});

describe("migrateBusinessMenu — multi-location, diverged clones", () => {
  it("creates override rows capturing the sibling's actual diverged values, and each location keeps its own pre-migration effective price", async () => {
    const business = await createTestBusiness();
    const anchor = await createTestRestaurant({ businessId: business._id, createdAt: new Date("2024-01-01") });
    const sibling = await createTestRestaurant({ businessId: business._id, createdAt: new Date("2024-02-01") });

    const anchorCategory = await createTestCategory(anchor._id, { name: "Mains" });
    const anchorItem = await createTestMenuItem(anchor._id, anchorCategory._id, { name: "Burger", price: 10, isAvailable: true });

    const siblingCategory = await createTestCategory(sibling._id, { name: "Mains", clonedFromCategoryId: anchorCategory._id });
    await createTestMenuItem(sibling._id, siblingCategory._id, {
      name: "Burger",
      price: 12, // diverged price
      isAvailable: false, // diverged availability
      clonedFromMenuItemId: anchorItem._id,
    });

    const summary = await migrateBusinessMenu(business._id);
    expect(summary.itemsMatchedDiverged).toBe(1);

    const resolvedAnchor = await resolveMenuForLocation(business.id, anchor.id, { includeHidden: false });
    expect(resolvedAnchor.items.find((i) => i.name === "Burger")?.price).toBe(10);

    const resolvedSibling = await resolveMenuForLocation(business.id, sibling.id, { includeHidden: true });
    const siblingItem = resolvedSibling.items.find((i) => i.name === "Burger");
    expect(siblingItem?.price).toBe(12);
    expect(siblingItem?.isAvailable).toBe(false);
  });
});

describe("migrateBusinessMenu — multi-location, organic/no-provenance menus", () => {
  it("promotes an unmatched sibling item into canonical (hidden by default) with an exclusive override re-enabling it only at its own location", async () => {
    const business = await createTestBusiness();
    const anchor = await createTestRestaurant({ businessId: business._id, createdAt: new Date("2024-01-01") });
    const sibling = await createTestRestaurant({ businessId: business._id, createdAt: new Date("2024-02-01") });

    const anchorCategory = await createTestCategory(anchor._id, { name: "Mains" });
    await createTestMenuItem(anchor._id, anchorCategory._id, { name: "Burger", price: 10 });

    // Built independently — no clonedFrom*Id, no name overlap with anything at the anchor.
    const siblingCategory = await createTestCategory(sibling._id, { name: "Regional Specials" });
    const exclusiveItem = await createTestMenuItem(sibling._id, siblingCategory._id, { name: "Local Fish Stew", price: 18 });

    const summary = await migrateBusinessMenu(business._id);
    expect(summary.itemsPromotedAsExclusive).toBe(1);
    expect(summary.categoriesPromotedAsExclusive).toBe(1);

    const resolvedAnchor = await resolveMenuForLocation(business.id, anchor.id, { includeHidden: false });
    expect(resolvedAnchor.items.some((i) => i.name === "Local Fish Stew")).toBe(false);

    const resolvedSibling = await resolveMenuForLocation(business.id, sibling.id, { includeHidden: false });
    const stew = resolvedSibling.items.find((i) => i.name === "Local Fish Stew");
    expect(stew?.price).toBe(18);
    expect(stew?.id).toBe(exclusiveItem.id); // promoted in place, same underlying document id
  });
});

describe("migrateBusinessMenu — idempotency and no-locations edge case", () => {
  it("is a no-op the second time it runs for the same business", async () => {
    const business = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: business._id });
    const category = await createTestCategory(location._id);
    await createTestMenuItem(location._id, category._id, { price: 7 });

    await migrateBusinessMenu(business._id);
    const beforeSecondRun = await resolveMenuForLocation(business.id, location.id, { includeHidden: false });

    const second = await migrateBusinessMenu(business._id);
    expect(second.skippedAlreadyMigrated).toBe(true);

    const afterSecondRun = await resolveMenuForLocation(business.id, location.id, { includeHidden: false });
    expect(afterSecondRun).toEqual(beforeSecondRun);
  });

  it("skips cleanly for a business with no locations at all", async () => {
    const business = await createTestBusiness();
    const summary = await migrateBusinessMenu(business._id);
    expect(summary.skippedNoLocations).toBe(true);
  });
});
