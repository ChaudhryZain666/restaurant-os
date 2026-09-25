import mongoose from "mongoose";
import type { MenuImportReport } from "@restaurant/types";
import { Category } from "../../models/Category.js";
import { MenuItem } from "../../models/MenuItem.js";
import { ModifierGroup } from "../../models/ModifierGroup.js";
import { AuditLog } from "../../models/AuditLog.js";
import { invalidateMenuCache, invalidateMenuCacheForBusiness } from "../menuCache.service.js";
import { normalizeKey, type ImportScope, type ResolvedImport } from "./resolveImport.js";

export interface WriteResolvedImportParams {
  /** The result of resolveImport(), possibly with `.rows[].action` already reassigned by the
   *  caller (the async-job publish flow overrides each row's action per the reviewer's explicit
   *  userAction choice before calling this — see menuImportJob.service.ts's publishMenuImportJob).
   *  CSV's commitImport.ts passes this straight through unmodified. Category-creation needs are
   *  ALWAYS recomputed here from the final `action` values (never trusted from
   *  resolved.categoriesToCreate, which reflects resolveImport()'s own pre-override snapshot) —
   *  this is what keeps a caller's override self-consistent regardless of what resolveImport()
   *  itself originally decided. */
  resolved: ResolvedImport;
  scope: ImportScope;
  actorUserId: string;
  actorRole: string;
  fileName: string;
}

/**
 * Phase 81 — the single server-authoritative transactional writer, extracted from
 * commitImport.ts's own inline transaction block (behaviorally identical for the CSV path — see
 * that file's own comment) so the async-job publish flow can share it instead of forking a second
 * write path. All category/item/modifier writes happen inside one MongoDB transaction: either
 * every intended change commits, or none do — unchanged from CSV commit's own guarantee.
 *
 * "merge" (Phase 81, additive — CSV/XLSX never produces this action) only fills fields currently
 * empty/default on the matched existing item (description, imageUrl) — price/availability/
 * sortOrder are never considered "empty" on a live item (a MenuItem's price is a required,
 * already-real number) and are left untouched by a merge, distinguishing it from "update"'s
 * unconditional full-field replace.
 */
export async function writeResolvedImport(params: WriteResolvedImportParams): Promise<MenuImportReport> {
  const { resolved, scope } = params;

  const scopeFields = scope.canonicalBusinessId ? { businessId: scope.canonicalBusinessId } : { restaurantId: scope.restaurantId };

  // Recomputed from the FINAL action values, not resolved.categoriesToCreate — see this
  // function's own param doc comment for why.
  const categoriesToCreate: string[] = [];
  const seenCategoryCreate = new Set<string>();
  for (const row of resolved.rows) {
    if (row.action !== "create") continue;
    const key = normalizeKey(row.categoryName);
    if (resolved.existingCategoryIdByName.has(key) || seenCategoryCreate.has(key)) continue;
    seenCategoryCreate.add(key);
    categoriesToCreate.push(row.categoryName);
  }

  const report = {
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsSkipped: 0,
    errors: resolved.rows.filter((r) => r.action === "error").length,
    categoriesCreated: 0,
    modifierGroupsCreated: 0,
    modifierOptionsCreated: 0,
  };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const categoryIdByName = new Map(resolved.existingCategoryIdByName);

      if (categoriesToCreate.length > 0) {
        const created = await Category.create(
          categoriesToCreate.map((name, i) => ({ name, sortOrder: i, ...scopeFields })),
          { session, ordered: true }
        );
        created.forEach((doc, i) => categoryIdByName.set(normalizeKey(categoriesToCreate[i]), doc.id as string));
        report.categoriesCreated = created.length;
      }

      const toCreate = resolved.rows.filter((r) => r.action === "create");
      if (toCreate.length > 0) {
        const createdItems = await MenuItem.create(
          toCreate.map((row) => ({
            categoryId: categoryIdByName.get(normalizeKey(row.categoryName)),
            name: row.itemName,
            description: row.description ?? "",
            price: row.price,
            imageUrl: row.imageUrl,
            isAvailable: row.isAvailable,
            sortOrder: row.sortOrder,
            ...scopeFields,
          })),
          { session, ordered: true }
        );
        report.itemsCreated = createdItems.length;

        const modifierGroupDocs: Array<Record<string, unknown>> = [];
        createdItems.forEach((item, i) => {
          for (const group of toCreate[i].modifierGroups) {
            modifierGroupDocs.push({
              menuItemId: item._id,
              name: group.name,
              minSelect: group.minSelect,
              maxSelect: group.maxSelect,
              options: group.options.map((o) => ({ name: o.name, priceAdjustment: o.priceAdjustment })),
              ...scopeFields,
            });
            report.modifierGroupsCreated++;
            report.modifierOptionsCreated += group.options.length;
          }
        });
        if (modifierGroupDocs.length > 0) {
          await ModifierGroup.create(modifierGroupDocs, { session, ordered: true });
        }
      }

      const toReplace = resolved.rows.filter((r) => r.action === "update" && r.matchedItemId);
      for (const row of toReplace) {
        await MenuItem.updateOne(
          { _id: row.matchedItemId },
          {
            $set: {
              price: row.price,
              description: row.description ?? "",
              isAvailable: row.isAvailable,
              sortOrder: row.sortOrder,
              ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
            },
          },
          { session, runValidators: true }
        );
      }

      const toMerge = resolved.rows.filter((r) => r.action === "merge" && r.matchedItemId);
      for (const row of toMerge) {
        const setFields: Record<string, unknown> = {};
        const prev = row.previousValues;
        if ((prev?.description ?? "") === "" && row.description) setFields.description = row.description;
        if (!prev?.imageUrl && row.imageUrl) setFields.imageUrl = row.imageUrl;
        if (Object.keys(setFields).length > 0) {
          await MenuItem.updateOne({ _id: row.matchedItemId }, { $set: setFields }, { session, runValidators: true });
        }
      }

      report.itemsUpdated = toReplace.length + toMerge.length;
      report.itemsSkipped = resolved.rows.filter((r) => r.action === "skip").length;
    });
  } finally {
    await session.endSession();
  }

  if (scope.canonicalBusinessId) {
    await invalidateMenuCacheForBusiness(scope.canonicalBusinessId);
  } else {
    await invalidateMenuCache(scope.restaurantId);
  }

  const importId = new mongoose.Types.ObjectId();
  const createdAt = new Date();
  try {
    await AuditLog.create({
      restaurantId: scope.restaurantId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      action: "menu.imported",
      targetType: "menu_import",
      targetId: importId,
      metadata: {
        fileName: params.fileName,
        totalRows: resolved.rows.length,
        created: report.itemsCreated,
        updated: report.itemsUpdated,
        skipped: report.itemsSkipped,
        errors: report.errors,
        categoriesCreated: report.categoriesCreated,
        modifierGroupsCreated: report.modifierGroupsCreated,
        modifierOptionsCreated: report.modifierOptionsCreated,
      },
    });
  } catch {
    // Never let a failed audit write shadow the fact the import itself already committed above.
  }

  return {
    importId: importId.toString(),
    fileName: params.fileName,
    totalRows: resolved.rows.length,
    created: report.itemsCreated,
    updated: report.itemsUpdated,
    skipped: report.itemsSkipped,
    errors: report.errors,
    categoriesCreated: report.categoriesCreated,
    itemsCreated: report.itemsCreated,
    modifierGroupsCreated: report.modifierGroupsCreated,
    modifierOptionsCreated: report.modifierOptionsCreated,
    createdAt: createdAt.toISOString(),
  };
}
