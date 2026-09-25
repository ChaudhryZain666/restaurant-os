import { connectDB } from "../../config/db.js";
import { MenuItem } from "../../models/MenuItem.js";
import { Category } from "../../models/Category.js";
import { closeTestConnections, createTestRestaurant, createTestCategory, createTestMenuItem, createTestUser } from "../../test-utils/fixtures.js";
import { writeResolvedImport } from "./writeResolvedImport.js";
import type { ResolvedImport } from "./resolveImport.js";

let restaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
let user: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
  await connectDB();
  restaurant = await createTestRestaurant();
  user = await createTestUser("restaurant_owner", restaurant._id);
});

afterAll(async () => {
  await closeTestConnections();
});

function baseResolved(overrides: Partial<ResolvedImport> = {}): ResolvedImport {
  return {
    rows: [],
    categories: [],
    categoriesToCreate: [],
    existingCategoryIdByName: new Map(),
    ...overrides,
  };
}

describe("writeResolvedImport", () => {
  it("creates a new category and item for a 'create' action row", async () => {
    const resolved = baseResolved({
      rows: [
        {
          rowNumber: 1,
          categoryName: "Appetizers",
          itemName: "Garlic Bread",
          description: "Fresh baked",
          price: 7,
          isAvailable: true,
          sortOrder: 0,
          action: "create",
          issues: [],
          modifierGroups: [],
        },
      ],
    });

    const report = await writeResolvedImport({
      resolved,
      scope: { restaurantId: restaurant.id as string, canonicalBusinessId: undefined },
      actorUserId: user.id as string,
      actorRole: "restaurant_owner",
      fileName: "test",
    });

    expect(report.created).toBe(1);
    expect(report.categoriesCreated).toBe(1);
    const item = await MenuItem.findOne({ restaurantId: restaurant._id, name: "Garlic Bread" });
    expect(item?.price).toBe(7);
  });

  it("'update' (replace) action overwrites every field unconditionally", async () => {
    const category = await createTestCategory(restaurant._id);
    const existing = await createTestMenuItem(restaurant._id, category._id, {
      name: "Truffle Pasta",
      price: 20,
      description: "Old description",
      imageUrl: "https://old.example.com/img.jpg",
    });

    const resolved = baseResolved({
      rows: [
        {
          rowNumber: 1,
          categoryName: category.name,
          itemName: "Truffle Pasta",
          description: "New description",
          price: 22,
          isAvailable: true,
          sortOrder: 0,
          action: "update",
          matchedItemId: existing.id as string,
          previousValues: { price: 20, description: "Old description", isAvailable: true, sortOrder: 0, imageUrl: "https://old.example.com/img.jpg" },
          issues: [],
          modifierGroups: [],
          imageUrl: "https://new.example.com/img.jpg",
        },
      ],
      existingCategoryIdByName: new Map([[category.name.toLowerCase(), category.id as string]]),
    });

    await writeResolvedImport({
      resolved,
      scope: { restaurantId: restaurant.id as string, canonicalBusinessId: undefined },
      actorUserId: user.id as string,
      actorRole: "restaurant_owner",
      fileName: "test",
    });

    const reloaded = await MenuItem.findById(existing._id);
    expect(reloaded?.price).toBe(22);
    expect(reloaded?.description).toBe("New description");
    expect(reloaded?.imageUrl).toBe("https://new.example.com/img.jpg");
  });

  it("'merge' action only fills currently-empty fields, leaving a populated price untouched", async () => {
    const category = await createTestCategory(restaurant._id);
    const existing = await createTestMenuItem(restaurant._id, category._id, {
      name: "Caesar Salad",
      price: 12, // already populated — merge must NOT touch this even though the row has a different price
      description: "", // empty — merge SHOULD fill this
      imageUrl: undefined, // empty — merge SHOULD fill this
    });

    const resolved = baseResolved({
      rows: [
        {
          rowNumber: 1,
          categoryName: category.name,
          itemName: "Caesar Salad",
          description: "Crisp romaine, parmesan, croutons",
          price: 15, // different from existing — must be IGNORED by merge
          isAvailable: true,
          sortOrder: 0,
          action: "merge",
          matchedItemId: existing.id as string,
          previousValues: { price: 12, description: "", isAvailable: true, sortOrder: 0, imageUrl: undefined },
          issues: [],
          modifierGroups: [],
          imageUrl: "https://new.example.com/salad.jpg",
        },
      ],
      existingCategoryIdByName: new Map([[category.name.toLowerCase(), category.id as string]]),
    });

    const report = await writeResolvedImport({
      resolved,
      scope: { restaurantId: restaurant.id as string, canonicalBusinessId: undefined },
      actorUserId: user.id as string,
      actorRole: "restaurant_owner",
      fileName: "test",
    });

    const reloaded = await MenuItem.findById(existing._id);
    expect(reloaded?.price).toBe(12); // untouched — was already populated
    expect(reloaded?.description).toBe("Crisp romaine, parmesan, croutons"); // filled — was empty
    expect(reloaded?.imageUrl).toBe("https://new.example.com/salad.jpg"); // filled — was empty
    expect(report.updated).toBe(1); // merge still counts toward the aggregate "updated" report figure
  });

  it("'merge' action with nothing empty to fill makes no write at all", async () => {
    const category = await createTestCategory(restaurant._id);
    const existing = await createTestMenuItem(restaurant._id, category._id, {
      name: "Bruschetta",
      price: 9,
      description: "Already has a description",
      imageUrl: "https://already.example.com/img.jpg",
    });

    const resolved = baseResolved({
      rows: [
        {
          rowNumber: 1,
          categoryName: category.name,
          itemName: "Bruschetta",
          description: "A different description from extraction",
          price: 10,
          isAvailable: true,
          sortOrder: 0,
          action: "merge",
          matchedItemId: existing.id as string,
          previousValues: { price: 9, description: "Already has a description", isAvailable: true, sortOrder: 0, imageUrl: "https://already.example.com/img.jpg" },
          issues: [],
          modifierGroups: [],
          imageUrl: "https://different.example.com/img.jpg",
        },
      ],
      existingCategoryIdByName: new Map([[category.name.toLowerCase(), category.id as string]]),
    });

    await writeResolvedImport({
      resolved,
      scope: { restaurantId: restaurant.id as string, canonicalBusinessId: undefined },
      actorUserId: user.id as string,
      actorRole: "restaurant_owner",
      fileName: "test",
    });

    const reloaded = await MenuItem.findById(existing._id);
    expect(reloaded?.price).toBe(9);
    expect(reloaded?.description).toBe("Already has a description");
    expect(reloaded?.imageUrl).toBe("https://already.example.com/img.jpg");
  });

  it("a 'skip' action row makes no write and counts toward itemsSkipped", async () => {
    const category = await createTestCategory(restaurant._id);
    const resolved = baseResolved({
      rows: [
        {
          rowNumber: 1,
          categoryName: category.name,
          itemName: "Untouched Item",
          price: 5,
          isAvailable: true,
          sortOrder: 0,
          action: "skip",
          issues: [],
          modifierGroups: [],
        },
      ],
      existingCategoryIdByName: new Map([[category.name.toLowerCase(), category.id as string]]),
    });

    const report = await writeResolvedImport({
      resolved,
      scope: { restaurantId: restaurant.id as string, canonicalBusinessId: undefined },
      actorUserId: user.id as string,
      actorRole: "restaurant_owner",
      fileName: "test",
    });

    expect(report.skipped).toBe(1);
    const item = await MenuItem.findOne({ restaurantId: restaurant._id, name: "Untouched Item" });
    expect(item).toBeNull();
  });

  it("recomputes category-creation needs from the final action values, never trusting resolved.categoriesToCreate", async () => {
    // Simulates a caller overriding a row's action to "create" AFTER resolveImport() ran (the
    // async-job publish flow does exactly this for a reviewer's explicit "create new" override) —
    // resolved.categoriesToCreate deliberately does NOT include this category (stale, pre-override
    // snapshot), proving writeResolvedImport recomputes it itself rather than trusting that field.
    const resolved = baseResolved({
      rows: [
        {
          rowNumber: 1,
          categoryName: "Brand New Category",
          itemName: "Brand New Item",
          price: 11,
          isAvailable: true,
          sortOrder: 0,
          action: "create",
          issues: [],
          modifierGroups: [],
        },
      ],
      categoriesToCreate: [], // deliberately stale/empty
    });

    const report = await writeResolvedImport({
      resolved,
      scope: { restaurantId: restaurant.id as string, canonicalBusinessId: undefined },
      actorUserId: user.id as string,
      actorRole: "restaurant_owner",
      fileName: "test",
    });

    expect(report.categoriesCreated).toBe(1);
    const category = await Category.findOne({ restaurantId: restaurant._id, name: "Brand New Category" });
    expect(category).not.toBeNull();
  });
});
