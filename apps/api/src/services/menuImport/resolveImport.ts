import { Category } from "../../models/Category.js";
import { MenuItem } from "../../models/MenuItem.js";
import type { MenuImportCategorySummary, MenuImportPreviewRow } from "@restaurant/types";
import type { NormalizedImportRow } from "./normalizeRows.js";

export interface ImportScope {
  restaurantId: string;
  /** Set when this restaurant's business has already been migrated to canonical (Phase 20)
   *  menu sharing — see menuResolution.service.ts's resolveCanonicalBusinessId, reused verbatim
   *  by the controller so this module never re-derives that decision itself. */
  canonicalBusinessId: string | undefined;
}

export function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

interface ExistingCategory {
  id: string;
  name: string;
}

async function loadExistingCategories(scope: ImportScope): Promise<ExistingCategory[]> {
  const filter = scope.canonicalBusinessId ? { businessId: scope.canonicalBusinessId } : { restaurantId: scope.restaurantId };
  const docs = await Category.find(filter).select("name");
  return docs.map((d) => ({ id: d.id as string, name: d.name }));
}

interface ExistingItem {
  id: string;
  price: number;
  description: string;
  isAvailable: boolean;
  sortOrder: number;
  imageUrl?: string;
}

/** Keyed by `${categoryId}::${normalizedItemName}` for O(1) duplicate lookup per row. */
async function loadExistingItemsByCategory(scope: ImportScope, categoryIds: string[]): Promise<Map<string, ExistingItem>> {
  if (categoryIds.length === 0) return new Map();
  const filter = scope.canonicalBusinessId
    ? { businessId: scope.canonicalBusinessId, categoryId: { $in: categoryIds } }
    : { restaurantId: scope.restaurantId, categoryId: { $in: categoryIds } };
  const docs = await MenuItem.find(filter).select("categoryId name price description isAvailable sortOrder imageUrl");
  const map = new Map<string, ExistingItem>();
  for (const doc of docs) {
    map.set(`${doc.categoryId.toString()}::${normalizeKey(doc.name)}`, {
      id: doc.id as string,
      price: doc.price,
      description: doc.description ?? "",
      isAvailable: doc.isAvailable,
      sortOrder: doc.sortOrder,
      imageUrl: doc.imageUrl ?? undefined,
    });
  }
  return map;
}

export interface ResolvedImport {
  rows: MenuImportPreviewRow[];
  categories: MenuImportCategorySummary[];
  /** Distinct new category names, in first-seen order — what commitImport.ts actually creates. */
  categoriesToCreate: string[];
  /** normalized category name -> existing Category id, for rows resolving against a real category. */
  existingCategoryIdByName: Map<string, string>;
}

/**
 * Phase 30 — the read-only planning pass shared by preview and commit: in-file duplicate
 * detection, category matching (exact, trim/whitespace/case-insensitive only — never fuzzy, see
 * docs/menu-import-architecture.md), and existing-item duplicate detection, all against the
 * CURRENT live database state. Never writes anything — commitImport.ts calls this again fresh
 * inside its own transaction rather than trusting a client-echoed result from an earlier preview
 * call, so nothing here needs to be "session"-aware.
 */
export async function resolveImport(
  normalizedRows: NormalizedImportRow[],
  scope: ImportScope,
  duplicateStrategy: "skip" | "update"
): Promise<ResolvedImport> {
  // In-file duplicate detection — first occurrence of a (category, item) pair wins; every later
  // one gets a "duplicate row in file" issue and is never eligible to also match the database.
  const seenInFile = new Map<string, number>(); // key -> first rowNumber
  for (const row of normalizedRows) {
    if (row.categoryName === "" || row.itemName === "") continue; // already flagged missing-field
    const key = `${normalizeKey(row.categoryName)}::${normalizeKey(row.itemName)}`;
    const firstRow = seenInFile.get(key);
    if (firstRow === undefined) {
      seenInFile.set(key, row.rowNumber);
    } else {
      row.issues.push({ message: `Duplicate item "${row.itemName}" in category "${row.categoryName}" (already on row ${firstRow}).` });
    }
  }

  const existingCategories = await loadExistingCategories(scope);
  const existingByNormalizedName = new Map(existingCategories.map((c) => [normalizeKey(c.name), c]));

  // Distinct category names actually needed, in first-seen file order — only from rows that have
  // a real category name (issue-free enough to know what category they're asking for).
  const orderedCategoryNames: string[] = [];
  const seenCategoryKeys = new Set<string>();
  for (const row of normalizedRows) {
    if (row.categoryName === "") continue;
    const key = normalizeKey(row.categoryName);
    if (!seenCategoryKeys.has(key)) {
      seenCategoryKeys.add(key);
      orderedCategoryNames.push(row.categoryName);
    }
  }

  const newCategoryNames = orderedCategoryNames.filter((name) => !existingByNormalizedName.has(normalizeKey(name)));
  const existingCategoryIds = orderedCategoryNames
    .map((name) => existingByNormalizedName.get(normalizeKey(name))?.id)
    .filter((id): id is string => Boolean(id));

  const existingItems = await loadExistingItemsByCategory(scope, existingCategoryIds);

  // sortOrder is optional per row (many real menus don't bother numbering) — rows that specified
  // one keep it; rows that didn't get auto-incrementing values continuing from the highest
  // explicit value already used in that category, assigned in file order.
  const nextSortOrderByCategory = new Map<string, number>();
  for (const row of normalizedRows) {
    if (row.categoryName === "" || row.sortOrder === undefined) continue;
    const key = normalizeKey(row.categoryName);
    nextSortOrderByCategory.set(key, Math.max(nextSortOrderByCategory.get(key) ?? -1, row.sortOrder) + 1);
  }

  const itemCountByCategory = new Map<string, number>();
  const previewRows: MenuImportPreviewRow[] = normalizedRows.map((row) => {
    if (row.categoryName !== "") {
      itemCountByCategory.set(row.categoryName, (itemCountByCategory.get(row.categoryName) ?? 0) + 1);
    }

    let sortOrder = row.sortOrder;
    if (sortOrder === undefined && row.categoryName !== "") {
      const key = normalizeKey(row.categoryName);
      sortOrder = nextSortOrderByCategory.get(key) ?? 0;
      nextSortOrderByCategory.set(key, sortOrder + 1);
    }

    if (row.issues.length > 0) {
      return { ...row, sortOrder: sortOrder ?? 0, action: "error" };
    }

    const existingCategory = existingByNormalizedName.get(normalizeKey(row.categoryName));
    const matched = existingCategory ? existingItems.get(`${existingCategory.id}::${normalizeKey(row.itemName)}`) : undefined;

    if (matched) {
      return {
        ...row,
        sortOrder: sortOrder ?? 0,
        action: duplicateStrategy === "update" ? "update" : "skip",
        matchedItemId: matched.id,
        previousValues: {
          price: matched.price,
          description: matched.description,
          isAvailable: matched.isAvailable,
          sortOrder: matched.sortOrder,
          imageUrl: matched.imageUrl,
        },
      };
    }
    return { ...row, sortOrder: sortOrder ?? 0, action: "create" };
  });

  // A new category is only actually worth creating if at least one row referencing it will
  // really become a MenuItem — a category name that only ever appeared on rows that errored out
  // (bad price, missing item name, etc.) must never leave behind an empty, orphaned category.
  const newCategoriesActuallyNeeded = new Set(
    previewRows.filter((r) => r.action === "create").map((r) => normalizeKey(r.categoryName))
  );
  const categoriesToCreate = newCategoryNames.filter((name) => newCategoriesActuallyNeeded.has(normalizeKey(name)));

  const categories: MenuImportCategorySummary[] = orderedCategoryNames
    .filter((name) => existingByNormalizedName.has(normalizeKey(name)) || newCategoriesActuallyNeeded.has(normalizeKey(name)))
    .map((name) => ({
      name,
      status: existingByNormalizedName.has(normalizeKey(name)) ? "existing" : "new",
      itemCount: itemCountByCategory.get(name) ?? 0,
    }));

  return {
    rows: previewRows,
    categories,
    categoriesToCreate,
    existingCategoryIdByName: new Map(existingCategories.map((c) => [normalizeKey(c.name), c.id])),
  };
}
