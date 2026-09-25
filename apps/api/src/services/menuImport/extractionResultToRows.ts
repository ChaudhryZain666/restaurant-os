import type { MenuExtractionResult, ExtractedRow } from "../../menuExtraction/MenuExtractionProvider.js";
import { normalizeBoolean, normalizePrice, type NormalizedImportRow } from "./normalizeRows.js";
import { MENU_IMPORT_CONFIDENCE_THRESHOLDS } from "./menuImportLimits.js";

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export type MenuImportReviewCategory = "looks_good" | "check_this" | "missing" | "needs_review";

/** Mirrors extraction-time review-bucketing so a freshly-extracted job's draftRows can be shown
 *  with a review category before any human touches them — the SAME thresholds
 *  menuImportJob.service.ts uses when persisting draftRows onto the job document. */
export function reviewCategoryFor(row: NormalizedImportRow): MenuImportReviewCategory {
  const missingRequired = row.categoryName === "" || row.itemName === "" || row.price === undefined;
  if (missingRequired) return "missing";
  const hasNonRequiredIssue = row.issues.some((i) => i.field !== "categoryName" && i.field !== "itemName" && i.field !== "price");
  const confidence = row.overallConfidence ?? 1;
  if (confidence < MENU_IMPORT_CONFIDENCE_THRESHOLDS.checkThis || hasNonRequiredIssue) return "needs_review";
  if (confidence < MENU_IMPORT_CONFIDENCE_THRESHOLDS.looksGood) return "check_this";
  return "looks_good";
}

/**
 * Phase 81 — converts a MenuExtractionProvider's raw result into the SAME NormalizedImportRow[]
 * shape the CSV/XLSX pipeline produces, so every downstream stage (resolveImport, buildPreview's
 * summary logic, the eventual writer) is reused verbatim. Provider output is treated as untrusted
 * input, exactly like a spreadsheet cell — reuses normalizeRows.ts's own price/boolean-parsing
 * guards rather than trusting a provider-returned value to already be clean (a "confident" AI
 * price string like "12.99 PKR" still has to pass the same validation a CSV cell would).
 */
export function extractionResultToNormalizedRows(result: MenuExtractionResult): NormalizedImportRow[] {
  return result.rows.map((row, i) => normalizedRowFromExtracted(row, i + 1));
}

function normalizedRowFromExtracted(extracted: ExtractedRow, rowNumber: number): NormalizedImportRow {
  const issues: NormalizedImportRow["issues"] = [];
  const categoryName = collapseWhitespace(extracted.categoryName ?? "");
  const itemName = collapseWhitespace(extracted.itemName ?? "");

  if (categoryName === "") issues.push({ field: "categoryName", message: "Category is missing." });
  if (itemName === "") issues.push({ field: "itemName", message: "Item name is missing." });

  let price: number | undefined;
  if (extracted.price === undefined || extracted.price.trim() === "") {
    issues.push({ field: "price", message: "Price is missing." });
  } else {
    price = normalizePrice(extracted.price);
    if (price === undefined) {
      issues.push({ field: "price", message: `Price "${extracted.price}" is not valid.` });
    }
  }

  // The extraction schema already types isAvailable as a real boolean (not a free-text cell), so
  // there's no equivalent "invalid availability word" issue to raise the way CSV's raw-string
  // column has — normalizeBoolean is reused only for the rare case a provider returns a string
  // here instead of a boolean, kept honest rather than silently coerced.
  let isAvailable = true;
  const rawAvailable = extracted.isAvailable as unknown;
  if (typeof rawAvailable === "boolean") {
    isAvailable = rawAvailable;
  } else if (typeof rawAvailable === "string" && rawAvailable.trim() !== "") {
    const parsed = normalizeBoolean(rawAvailable);
    if (parsed === undefined) {
      issues.push({ field: "isAvailable", message: `Availability "${rawAvailable}" is not valid.` });
    } else {
      isAvailable = parsed;
    }
  }

  const modifierGroups = (extracted.modifierGroups ?? []).map((g) => ({
    name: collapseWhitespace(g.name),
    minSelect: g.minSelect ?? 0,
    maxSelect: g.maxSelect ?? 1,
    options: (g.options ?? []).map((o) => ({ name: collapseWhitespace(o.name), priceAdjustment: o.priceAdjustment ?? 0 })),
  }));

  const fieldConfidence = (extracted.fieldConfidence ?? []).map((f) => ({ field: f.field, score: f.score }));
  const overallConfidence = typeof extracted.overallConfidence === "number" ? extracted.overallConfidence : 0;

  return {
    rowNumber,
    categoryName,
    itemName,
    description: extracted.description?.trim() || undefined,
    price,
    isAvailable,
    imageUrl: extracted.imageUrl?.trim() || undefined,
    modifierGroups,
    issues,
    overallConfidence,
    fieldConfidence,
    sourcePageIndex: extracted.sourcePageIndex,
  };
}
