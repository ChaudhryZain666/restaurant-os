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
  createTestRestaurant,
} from "../test-utils/fixtures.js";
import { computeReadiness } from "./restaurantReadiness.service.js";

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await closeTestConnections();
});

describe("computeReadiness — legacy (pre-migration) path, unchanged", () => {
  it("is not ready with no menu, ready once a category and available item exist", async () => {
    const restaurant = await createTestRestaurant();

    const before = await computeReadiness(restaurant);
    expect(before.ready).toBe(false);
    expect(before.checks.find((c) => c.key === "menu")?.complete).toBe(false);

    const category = await createTestCategory(restaurant._id);
    await createTestMenuItem(restaurant._id, category._id, { isAvailable: true });

    const after = await computeReadiness(restaurant);
    expect(after.checks.find((c) => c.key === "menu")?.complete).toBe(true);

    await Promise.all([
      MenuItem.deleteMany({ restaurantId: restaurant._id }),
      Category.deleteMany({ restaurantId: restaurant._id }),
    ]);
  });
});

describe("computeReadiness — canonical (migrated) path", () => {
  it("THE bug this fix closes: a non-anchor location's canonical menu (no restaurantId-scoped documents of its own) is still correctly reported ready", async () => {
    const business = await createTestBusiness();
    const anchor = await createTestRestaurant({ businessId: business._id });
    const nonAnchorLocation = await createTestRestaurant({ businessId: business._id });

    const category = await createTestCategory(anchor._id, { businessId: business._id });
    await createTestMenuItem(anchor._id, category._id, { businessId: business._id, isAvailable: true });

    // A naive `Category.countDocuments({restaurantId: nonAnchorLocation._id})` /
    // `MenuItem.countDocuments({restaurantId: nonAnchorLocation._id})` would read 0 here — this
    // location owns no restaurantId-scoped documents of its own, its menu lives entirely under
    // the business's canonical documents.
    const readiness = await computeReadiness(nonAnchorLocation);
    expect(readiness.checks.find((c) => c.key === "menu")?.complete).toBe(true);

    await Promise.all([
      MenuItem.deleteMany({ businessId: business._id }),
      Category.deleteMany({ businessId: business._id }),
    ]);
  });

  it("is not ready when every canonical item is overridden unavailable at this specific location, even though the business has items", async () => {
    const business = await createTestBusiness();
    const anchor = await createTestRestaurant({ businessId: business._id });
    const otherLocation = await createTestRestaurant({ businessId: business._id });

    const category = await createTestCategory(anchor._id, { businessId: business._id });
    const item = await createTestMenuItem(anchor._id, category._id, { businessId: business._id, isAvailable: true });
    await MenuItemLocationOverride.create({
      businessId: business._id,
      locationId: otherLocation._id,
      menuItemId: item._id,
      isAvailable: false,
    });

    // A naive `{businessId}`-scoped count would answer "does the business have any active item
    // anywhere" (yes) rather than "does THIS location's effective menu have one" (no) — the wrong
    // question in the opposite direction from the restaurantId-only bug above.
    const readiness = await computeReadiness(otherLocation);
    expect(readiness.checks.find((c) => c.key === "menu")?.complete).toBe(false);

    // The anchor location, with no override, is still correctly ready.
    const anchorReadiness = await computeReadiness(anchor);
    expect(anchorReadiness.checks.find((c) => c.key === "menu")?.complete).toBe(true);

    await Promise.all([
      MenuItem.deleteMany({ businessId: business._id }),
      Category.deleteMany({ businessId: business._id }),
      MenuItemLocationOverride.deleteMany({ businessId: business._id }),
    ]);
  });
});
