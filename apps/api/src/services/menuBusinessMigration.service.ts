import mongoose, { type ClientSession, type Types } from "mongoose";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup, type ModifierOptionSubdoc } from "../models/ModifierGroup.js";
import { CategoryLocationOverride } from "../models/CategoryLocationOverride.js";
import { MenuItemLocationOverride } from "../models/MenuItemLocationOverride.js";
import { ModifierGroupLocationOverride } from "../models/ModifierGroupLocationOverride.js";
import { businessHasCanonicalMenu } from "./menuResolution.service.js";

/**
 * Phase 20 — migrates a business's per-location, restaurantId-scoped Category/MenuItem/
 * ModifierGroup documents into the canonical (businessId-scoped) + sparse per-location-override
 * architecture. Mirrors businessLocationMigration.service.ts's own shape: a pure, testable
 * service with no top-level CLI code, called by the thin scripts/migrateMenuToCanonical.ts
 * wrapper. See docs/multi-tenant-storefront-architecture.md's Phase 20 section for the full
 * design rationale.
 *
 * NOT run against the real dev database this phase — built and fixture-tested only. See the
 * Phase 20 plan/report for why (sibling-document deletion for multi-location businesses is not
 * byte-for-byte reversible, so this needs a documented backup runbook step before its first real
 * run — deferred to Phase 21 alongside actually flipping product code over to read canonical data
 * by default).
 */

export interface MenuMigrationSummary {
  businessId: string;
  anchorLocationId: string | null;
  siblingLocationCount: number;
  categoriesPromotedAsAnchor: number;
  categoriesMatchedUnchanged: number;
  categoriesMatchedDiverged: number;
  categoriesPromotedAsExclusive: number;
  itemsPromotedAsAnchor: number;
  itemsMatchedUnchanged: number;
  itemsMatchedDiverged: number;
  itemsPromotedAsExclusive: number;
  modifierGroupsPromotedAsAnchor: number;
  modifierGroupsMatchedUnchanged: number;
  modifierGroupsMatchedDiverged: number;
  modifierGroupsPromotedAsExclusive: number;
  skippedAlreadyMigrated: boolean;
  skippedNoLocations: boolean;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function emptySummary(
  businessId: string,
  flags: { skippedAlreadyMigrated: boolean; skippedNoLocations: boolean }
): MenuMigrationSummary {
  return {
    businessId,
    anchorLocationId: null,
    siblingLocationCount: 0,
    categoriesPromotedAsAnchor: 0,
    categoriesMatchedUnchanged: 0,
    categoriesMatchedDiverged: 0,
    categoriesPromotedAsExclusive: 0,
    itemsPromotedAsAnchor: 0,
    itemsMatchedUnchanged: 0,
    itemsMatchedDiverged: 0,
    itemsPromotedAsExclusive: 0,
    modifierGroupsPromotedAsAnchor: 0,
    modifierGroupsMatchedUnchanged: 0,
    modifierGroupsMatchedDiverged: 0,
    modifierGroupsPromotedAsExclusive: 0,
    ...flags,
  };
}

/**
 * Finds a matching anchor document for a sibling document, preferring the sibling's own
 * clonedFrom*Id provenance (set by Phase 19's one-time clone-on-creation) when it actually points
 * at one of the given candidates, and falling back to a case-insensitive name match only when
 * provenance is absent or points somewhere else (e.g. a business created before Phase 19's clone
 * tooling existed, or a menu built organically with no clone step at all).
 */
function findMatch<T extends { _id: Types.ObjectId; name: string }>(
  candidates: T[],
  siblingProvenanceId: Types.ObjectId | undefined,
  siblingName: string
): T | undefined {
  if (siblingProvenanceId) {
    const byProvenance = candidates.find((c) => c._id.equals(siblingProvenanceId));
    if (byProvenance) return byProvenance;
  }
  return candidates.find((c) => normalizeName(c.name) === normalizeName(siblingName));
}

async function migrateBusinessCategories(
  businessId: Types.ObjectId,
  anchorLocationId: Types.ObjectId,
  siblingLocationIds: Types.ObjectId[],
  session: ClientSession
): Promise<{
  categoryIdMapByLocation: Map<string, Map<string, Types.ObjectId>>;
  counts: Pick<
    MenuMigrationSummary,
    "categoriesPromotedAsAnchor" | "categoriesMatchedUnchanged" | "categoriesMatchedDiverged" | "categoriesPromotedAsExclusive"
  >;
}> {
  const anchorCategories = await Category.find({ restaurantId: anchorLocationId }).session(session);
  await Category.updateMany({ restaurantId: anchorLocationId }, { $set: { businessId } }, { session });

  const counts = {
    categoriesPromotedAsAnchor: anchorCategories.length,
    categoriesMatchedUnchanged: 0,
    categoriesMatchedDiverged: 0,
    categoriesPromotedAsExclusive: 0,
  };

  // Per sibling location, maps that sibling's OLD categoryId -> the canonical categoryId it now
  // resolves to (either a matched anchor category, or its own doc promoted in place) — needed so
  // MenuItem migration can remap categoryId references below.
  const categoryIdMapByLocation = new Map<string, Map<string, Types.ObjectId>>();

  for (const locationId of siblingLocationIds) {
    const siblingCategories = await Category.find({ restaurantId: locationId })
      .select("+clonedFromCategoryId")
      .session(session);
    const idMap = new Map<string, Types.ObjectId>();

    for (const sibling of siblingCategories) {
      const match = findMatch(anchorCategories, sibling.clonedFromCategoryId ?? undefined, sibling.name);

      if (match) {
        const diverged = sibling.sortOrder !== match.sortOrder || sibling.isActive !== match.isActive;
        if (diverged) {
          await CategoryLocationOverride.create(
            [
              {
                businessId,
                locationId,
                categoryId: match._id,
                ...(sibling.sortOrder !== match.sortOrder ? { sortOrderOverride: sibling.sortOrder } : {}),
                ...(sibling.isActive !== match.isActive ? { isActive: sibling.isActive } : {}),
              },
            ],
            { session }
          );
          counts.categoriesMatchedDiverged += 1;
        } else {
          counts.categoriesMatchedUnchanged += 1;
        }
        idMap.set(sibling.id, match._id);
        await Category.deleteOne({ _id: sibling._id }, { session });
      } else {
        // Organically independent category — promote it into canonical, hidden by default
        // everywhere else, then re-enable it explicitly at its own (sole) location.
        await Category.updateOne({ _id: sibling._id }, { $set: { businessId, isActive: false } }, { session });
        await CategoryLocationOverride.create([{ businessId, locationId, categoryId: sibling._id, isActive: true }], {
          session,
        });
        counts.categoriesPromotedAsExclusive += 1;
        idMap.set(sibling.id, sibling._id);
      }
    }
    categoryIdMapByLocation.set(locationId.toString(), idMap);
  }

  return { categoryIdMapByLocation, counts };
}

async function migrateBusinessMenuItems(
  businessId: Types.ObjectId,
  anchorLocationId: Types.ObjectId,
  siblingLocationIds: Types.ObjectId[],
  categoryIdMapByLocation: Map<string, Map<string, Types.ObjectId>>,
  session: ClientSession
): Promise<{
  itemIdMapByLocation: Map<string, Map<string, Types.ObjectId>>;
  counts: Pick<
    MenuMigrationSummary,
    "itemsPromotedAsAnchor" | "itemsMatchedUnchanged" | "itemsMatchedDiverged" | "itemsPromotedAsExclusive"
  >;
}> {
  const anchorItems = await MenuItem.find({ restaurantId: anchorLocationId }).session(session);
  await MenuItem.updateMany({ restaurantId: anchorLocationId }, { $set: { businessId } }, { session });

  const counts = {
    itemsPromotedAsAnchor: anchorItems.length,
    itemsMatchedUnchanged: 0,
    itemsMatchedDiverged: 0,
    itemsPromotedAsExclusive: 0,
  };
  const itemIdMapByLocation = new Map<string, Map<string, Types.ObjectId>>();

  for (const locationId of siblingLocationIds) {
    const categoryIdMap = categoryIdMapByLocation.get(locationId.toString())!;
    const siblingItems = await MenuItem.find({ restaurantId: locationId }).select("+clonedFromMenuItemId").session(session);
    const idMap = new Map<string, Types.ObjectId>();

    for (const sibling of siblingItems) {
      // Only consider anchor items whose (already-canonical) category corresponds to this
      // sibling's mapped category — an item can't organically "match" one under a different
      // category, even if the names happen to coincide.
      const mappedCategoryId = categoryIdMap.get(sibling.categoryId.toString());
      const candidateAnchorItems = anchorItems.filter(
        (a) => mappedCategoryId && a.categoryId.equals(mappedCategoryId)
      );
      const match = findMatch(candidateAnchorItems, sibling.clonedFromMenuItemId ?? undefined, sibling.name);

      if (match) {
        const diffFields: Record<string, unknown> = {};
        if (sibling.price !== match.price) diffFields.priceOverride = sibling.price;
        if (sibling.isAvailable !== match.isAvailable) diffFields.isAvailable = sibling.isAvailable;
        if (sibling.sortOrder !== match.sortOrder) diffFields.sortOrderOverride = sibling.sortOrder;

        if (Object.keys(diffFields).length > 0) {
          await MenuItemLocationOverride.create(
            [{ businessId, locationId, menuItemId: match._id, ...diffFields }],
            { session }
          );
          counts.itemsMatchedDiverged += 1;
        } else {
          counts.itemsMatchedUnchanged += 1;
        }
        idMap.set(sibling.id, match._id);
        await MenuItem.deleteOne({ _id: sibling._id }, { session });
      } else {
        const canonicalCategoryId = mappedCategoryId ?? sibling.categoryId;
        await MenuItem.updateOne(
          { _id: sibling._id },
          { $set: { businessId, categoryId: canonicalCategoryId, isAvailable: false } },
          { session }
        );
        await MenuItemLocationOverride.create(
          [{ businessId, locationId, menuItemId: sibling._id, isAvailable: true }],
          { session }
        );
        counts.itemsPromotedAsExclusive += 1;
        idMap.set(sibling.id, sibling._id);
      }
    }
    itemIdMapByLocation.set(locationId.toString(), idMap);
  }

  return { itemIdMapByLocation, counts };
}

async function migrateBusinessModifierGroups(
  businessId: Types.ObjectId,
  anchorLocationId: Types.ObjectId,
  siblingLocationIds: Types.ObjectId[],
  itemIdMapByLocation: Map<string, Map<string, Types.ObjectId>>,
  session: ClientSession
): Promise<
  Pick<
    MenuMigrationSummary,
    | "modifierGroupsPromotedAsAnchor"
    | "modifierGroupsMatchedUnchanged"
    | "modifierGroupsMatchedDiverged"
    | "modifierGroupsPromotedAsExclusive"
  >
> {
  const anchorGroups = await ModifierGroup.find({ restaurantId: anchorLocationId }).session(session);
  await ModifierGroup.updateMany({ restaurantId: anchorLocationId }, { $set: { businessId } }, { session });

  const counts = {
    modifierGroupsPromotedAsAnchor: anchorGroups.length,
    modifierGroupsMatchedUnchanged: 0,
    modifierGroupsMatchedDiverged: 0,
    modifierGroupsPromotedAsExclusive: 0,
  };

  for (const locationId of siblingLocationIds) {
    const itemIdMap = itemIdMapByLocation.get(locationId.toString())!;
    const siblingGroups = await ModifierGroup.find({ restaurantId: locationId })
      .select("+clonedFromModifierGroupId")
      .session(session);

    for (const sibling of siblingGroups) {
      const mappedMenuItemId = itemIdMap.get(sibling.menuItemId.toString());
      const candidateAnchorGroups = anchorGroups.filter(
        (a) => mappedMenuItemId && a.menuItemId.equals(mappedMenuItemId)
      );
      const match = findMatch(candidateAnchorGroups, sibling.clonedFromModifierGroupId, sibling.name);

      if (match) {
        const optionOverrides: Array<{ optionId: Types.ObjectId; isActive?: boolean; priceAdjustmentOverride?: number }> = [];
        for (const siblingOption of sibling.options) {
          const matchedOption = match.options.find((o) => normalizeName(o.name) === normalizeName(siblingOption.name));
          if (!matchedOption) continue; // An organically-added option with no canonical counterpart is dropped, not promoted — deliberately narrow scope for this fixture-tested pass.
          const optDiff: { optionId: Types.ObjectId; isActive?: boolean; priceAdjustmentOverride?: number } = {
            optionId: matchedOption._id,
          };
          if (siblingOption.isActive !== matchedOption.isActive) optDiff.isActive = siblingOption.isActive;
          if (siblingOption.priceAdjustment !== matchedOption.priceAdjustment) {
            optDiff.priceAdjustmentOverride = siblingOption.priceAdjustment;
          }
          if (optDiff.isActive !== undefined || optDiff.priceAdjustmentOverride !== undefined) {
            optionOverrides.push(optDiff);
          }
        }
        const groupDiverged = sibling.isActive !== match.isActive || sibling.sortOrder !== match.sortOrder;

        if (groupDiverged || optionOverrides.length > 0) {
          await ModifierGroupLocationOverride.create(
            [
              {
                businessId,
                locationId,
                modifierGroupId: match._id,
                ...(sibling.isActive !== match.isActive ? { isActive: sibling.isActive } : {}),
                optionOverrides,
              },
            ],
            { session }
          );
          counts.modifierGroupsMatchedDiverged += 1;
        } else {
          counts.modifierGroupsMatchedUnchanged += 1;
        }
        await ModifierGroup.deleteOne({ _id: sibling._id }, { session });
      } else {
        const canonicalMenuItemId = mappedMenuItemId ?? sibling.menuItemId;
        await ModifierGroup.updateOne(
          { _id: sibling._id },
          { $set: { businessId, menuItemId: canonicalMenuItemId, isActive: false } },
          { session }
        );
        await ModifierGroupLocationOverride.create(
          [{ businessId, locationId, modifierGroupId: sibling._id, isActive: true, optionOverrides: [] }],
          { session }
        );
        counts.modifierGroupsPromotedAsExclusive += 1;
      }
    }
  }

  return counts;
}

/**
 * Migrates one business. Idempotent: a no-op if this business's menu is already canonical.
 * `dryRun: true` runs the identical logic inside a real transaction (so every read sees a
 * consistent snapshot exactly like a live run would) but always aborts it at the end instead of
 * committing — nothing is persisted, but the returned summary reflects exactly what a real run
 * would have done.
 */
export async function migrateBusinessMenu(
  businessId: Types.ObjectId,
  options: { dryRun?: boolean } = {}
): Promise<MenuMigrationSummary> {
  const businessIdStr = businessId.toString();
  const alreadyMigrated = await businessHasCanonicalMenu(businessIdStr);
  if (alreadyMigrated) {
    return emptySummary(businessIdStr, { skippedAlreadyMigrated: true, skippedNoLocations: false });
  }

  const locations = await Restaurant.find({ businessId }).sort({ createdAt: 1 });
  if (locations.length === 0) {
    return emptySummary(businessIdStr, { skippedAlreadyMigrated: false, skippedNoLocations: true });
  }

  const anchor = locations[0];
  const siblings = locations.slice(1);
  const session = await mongoose.startSession();
  let categoryCounts!: Awaited<ReturnType<typeof migrateBusinessCategories>>["counts"];
  let itemCounts!: Awaited<ReturnType<typeof migrateBusinessMenuItems>>["counts"];
  let modifierCounts!: Awaited<ReturnType<typeof migrateBusinessModifierGroups>>;

  try {
    session.startTransaction();
    const siblingIds = siblings.map((s) => s._id);
    const { categoryIdMapByLocation, counts: catCounts } = await migrateBusinessCategories(
      businessId,
      anchor._id,
      siblingIds,
      session
    );
    categoryCounts = catCounts;

    const { itemIdMapByLocation, counts: itmCounts } = await migrateBusinessMenuItems(
      businessId,
      anchor._id,
      siblingIds,
      categoryIdMapByLocation,
      session
    );
    itemCounts = itmCounts;

    modifierCounts = await migrateBusinessModifierGroups(businessId, anchor._id, siblingIds, itemIdMapByLocation, session);

    if (options.dryRun) {
      await session.abortTransaction();
    } else {
      await session.commitTransaction();
    }
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    await session.endSession();
  }

  return {
    businessId: businessIdStr,
    anchorLocationId: anchor.id,
    siblingLocationCount: siblings.length,
    skippedAlreadyMigrated: false,
    skippedNoLocations: false,
    ...categoryCounts,
    ...itemCounts,
    ...modifierCounts,
  };
}

/** Migrates every business whose menu isn't canonical yet. Idempotent, per-business transactions
 *  (one business's failure doesn't roll back another's). */
export async function migrateAllBusinessMenus(options: { dryRun?: boolean } = {}): Promise<MenuMigrationSummary[]> {
  const businesses = await Business.find();
  const summaries: MenuMigrationSummary[] = [];
  for (const business of businesses) {
    const summary = await migrateBusinessMenu(business._id, options);
    summaries.push(summary);
  }
  return summaries;
}

export type { ModifierOptionSubdoc };
