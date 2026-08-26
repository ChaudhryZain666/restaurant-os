import mongoose from "mongoose";
import type { MenuImportColumnMapping, MenuImportReport } from "@restaurant/types";
import { Category } from "../../models/Category.js";
import { MenuItem } from "../../models/MenuItem.js";
import { ModifierGroup } from "../../models/ModifierGroup.js";
import { AuditLog } from "../../models/AuditLog.js";
import { ApiError } from "../../utils/ApiError.js";
import { invalidateMenuCache, invalidateMenuCacheForBusiness } from "../menuCache.service.js";
import { normalizeRows } from "./normalizeRows.js";
import { resolveImport, normalizeKey, type ImportScope } from "./resolveImport.js";
import { suggestColumnMapping, missingRequiredFields } from "./columnMapping.js";
import { parseUploadedSheet, type MenuImportFileKind } from "./buildPreview.js";

interface CommitParams {
  fileName: string;
  buffer: Buffer;
  kind: MenuImportFileKind;
  requestedMapping: MenuImportColumnMapping;
  scope: ImportScope;
  duplicateStrategy: "skip" | "update";
  actorUserId: string;
  actorRole: string;
}

/**
 * Phase 30 — the single server-authoritative write path. Deliberately re-runs the ENTIRE
 * parse/normalize/resolve pipeline fresh (never trusts a client-echoed preview result — see
 * docs/menu-import-architecture.md's "why the file is re-uploaded on commit" section) so nothing
 * about what actually gets written to the database ever passed through client hands unverified.
 * All category/item/modifier writes happen inside one MongoDB transaction: either every intended
 * change commits, or none do (see docs/menu-import-architecture.md's transaction-limits note for
 * why this is safe up to Phase 30's own MAX_ROWS cap).
 */
export async function commitImport(params: CommitParams): Promise<MenuImportReport> {
  const sheet = await parseUploadedSheet(params.buffer, params.kind);
  const suggestedMapping = suggestColumnMapping(sheet.headers);
  const appliedMapping: MenuImportColumnMapping = { ...suggestedMapping };
  for (const header of sheet.headers) {
    if (header in params.requestedMapping) appliedMapping[header] = params.requestedMapping[header];
  }
  const unmapped = missingRequiredFields(appliedMapping);
  if (unmapped.length > 0) {
    throw ApiError.badRequest(`This mapping is missing required fields: ${unmapped.join(", ")}.`);
  }

  const normalized = normalizeRows(sheet, appliedMapping);
  const resolved = await resolveImport(normalized, params.scope, params.duplicateStrategy);

  const report = {
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsSkipped: 0,
    errors: resolved.rows.filter((r) => r.action === "error").length,
    categoriesCreated: 0,
    modifierGroupsCreated: 0,
    modifierOptionsCreated: 0,
  };

  const scopeFields = params.scope.canonicalBusinessId
    ? { businessId: params.scope.canonicalBusinessId }
    : { restaurantId: params.scope.restaurantId };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const categoryIdByName = new Map(resolved.existingCategoryIdByName);

      if (resolved.categoriesToCreate.length > 0) {
        const created = await Category.create(
          resolved.categoriesToCreate.map((name, i) => ({ name, sortOrder: i, ...scopeFields })),
          { session, ordered: true }
        );
        created.forEach((doc, i) => categoryIdByName.set(normalizeKey(resolved.categoriesToCreate[i]), doc.id as string));
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

      const toUpdate = resolved.rows.filter((r) => r.action === "update" && r.matchedItemId);
      for (const row of toUpdate) {
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
      report.itemsUpdated = toUpdate.length;
      report.itemsSkipped = resolved.rows.filter((r) => r.action === "skip").length;
    });
  } finally {
    await session.endSession();
  }

  if (params.scope.canonicalBusinessId) {
    await invalidateMenuCacheForBusiness(params.scope.canonicalBusinessId);
  } else {
    await invalidateMenuCache(params.scope.restaurantId);
  }

  const importId = new mongoose.Types.ObjectId();
  const createdAt = new Date();
  // Fire-and-forget-but-awaited, same discipline as every other recordAuditEvent call — a failed
  // audit write must never be mistaken for the import itself having failed (it already committed
  // above by this point).
  try {
    await AuditLog.create({
      restaurantId: params.scope.restaurantId,
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
    // logged inside AuditLog write paths elsewhere in this codebase via recordAuditEvent; this one
    // write is simple enough not to need a second wrapper, but must still never throw past here.
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
