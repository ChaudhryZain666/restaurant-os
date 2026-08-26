import type {
  MenuImportColumnMapping,
  MenuImportFieldKey,
  MenuImportModifierGroupPreview,
  MenuImportRowIssue,
} from "@restaurant/types";
import type { ParsedSheet } from "./parseFile.js";

export interface NormalizedImportRow {
  /** 1-based, counting only data rows — matches what the user sees in their spreadsheet minus
   *  the header row (row 1 in the file's data is rowNumber 1, not 2). */
  rowNumber: number;
  categoryName: string;
  itemName: string;
  description?: string;
  price?: number;
  isAvailable: boolean;
  sortOrder?: number;
  imageUrl?: string;
  modifierGroups: MenuImportModifierGroupPreview[];
  issues: MenuImportRowIssue[];
}

function buildFieldToColumn(mapping: MenuImportColumnMapping): Partial<Record<MenuImportFieldKey, string>> {
  const out: Partial<Record<MenuImportFieldKey, string>> = {};
  // Later columns win on a genuinely ambiguous mapping (two source columns both assigned the same
  // field) — an edge case the UI shouldn't normally produce, but the server stays deterministic
  // either way rather than silently picking whichever happened to iterate first.
  for (const [column, field] of Object.entries(mapping)) {
    if (field) out[field] = column;
  }
  return out;
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const TRUE_VALUES = new Set(["true", "yes", "y", "1", "available", "in stock"]);
const FALSE_VALUES = new Set(["false", "no", "n", "0", "unavailable", "out of stock"]);

/** Returns undefined only for a non-empty value that doesn't match a recognized boolean word —
 *  caller treats undefined as an "invalid availability" issue, never a silent default. */
function normalizeBoolean(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  return undefined;
}

/** Strips a single optional leading currency symbol/code and thousands-separator commas, then
 *  requires a clean non-negative decimal. Returns undefined for anything that isn't confidently a
 *  price — this never guesses at a suspicious value (e.g. "12.99.99", "twelve", "-5"). */
function normalizePrice(raw: string): number | undefined {
  const cleaned = raw
    .trim()
    .replace(/^(rs\.?|pkr|\$|£|€)\s*/i, "")
    .replace(/,(?=\d{3}(\D|$))/g, "")
    .trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  return Number(cleaned);
}

/** Non-negative integer only — a sort position can't be fractional or negative. */
function normalizeSortOrder(raw: string): number | undefined {
  const cleaned = raw.trim();
  if (!/^\d+$/.test(cleaned)) return undefined;
  return Number(cleaned);
}

interface RawLine {
  rowNumber: number;
  values: Partial<Record<MenuImportFieldKey, string>>;
}

function extractLines(rows: Array<Record<string, string>>, fieldToColumn: Partial<Record<MenuImportFieldKey, string>>): RawLine[] {
  return rows.map((row, i) => {
    const values: Partial<Record<MenuImportFieldKey, string>> = {};
    for (const [field, column] of Object.entries(fieldToColumn) as Array<[MenuImportFieldKey, string]>) {
      values[field] = row[column] ?? "";
    }
    return { rowNumber: i + 1, values };
  });
}

/**
 * Phase 30 — turns raw parsed spreadsheet rows into the normalized import contract every future
 * import source (CSV, XLSX, and later PDF/OCR/AI — see docs/menu-import-architecture.md) is
 * required to converge on. A "modifier continuation row" (blank category AND item name, but
 * modifier group/option present) attaches its option to the most recently seen item rather than
 * starting a new one — see docs/menu-import-architecture.md's exact supported modifier layout.
 * This function only normalizes and flags issues; it never touches the database and never decides
 * create/update/skip (see resolveCategories.ts/detectDuplicates.ts for that).
 */
export function normalizeRows(sheet: ParsedSheet, mapping: MenuImportColumnMapping): NormalizedImportRow[] {
  const fieldToColumn = buildFieldToColumn(mapping);
  const lines = extractLines(sheet.rows, fieldToColumn);

  const result: NormalizedImportRow[] = [];
  let current: NormalizedImportRow | null = null;
  // (groupName, current item) -> the group object already pushed onto current.modifierGroups,
  // so repeated option rows for the same group accumulate options instead of creating duplicate
  // groups on the same item.
  let currentGroups = new Map<string, MenuImportModifierGroupPreview>();

  for (const line of lines) {
    const categoryRaw = (line.values.categoryName ?? "").trim();
    const itemRaw = (line.values.itemName ?? "").trim();
    const hasModifierData = Boolean((line.values.modifierGroupName ?? "").trim() || (line.values.modifierOptionName ?? "").trim());
    const isContinuation = categoryRaw === "" && itemRaw === "" && hasModifierData;

    if (isContinuation) {
      if (!current) {
        result.push({
          rowNumber: line.rowNumber,
          categoryName: "",
          itemName: "",
          isAvailable: true,
          modifierGroups: [],
          issues: [{ message: "Modifier data with no preceding item — add a category and item name first, or remove this row." }],
        });
        continue;
      }
      appendModifierLine(current, currentGroups, line);
      continue;
    }

    if (categoryRaw === "" && itemRaw === "" && !hasModifierData) {
      // A fully-blank line by our mapped fields (some unmapped column may still have content) —
      // parseFile already drops truly empty rows, so this is a row where every MAPPED field is
      // blank. Skip silently rather than reporting a phantom "missing category and item" error.
      continue;
    }

    const row: NormalizedImportRow = {
      rowNumber: line.rowNumber,
      categoryName: collapseWhitespace(categoryRaw),
      itemName: collapseWhitespace(itemRaw),
      isAvailable: true,
      modifierGroups: [],
      issues: [],
    };

    if (categoryRaw === "") row.issues.push({ field: "categoryName", message: "Category is missing." });
    if (itemRaw === "") row.issues.push({ field: "itemName", message: "Item name is missing." });

    const descriptionRaw = line.values.description;
    if (descriptionRaw !== undefined && descriptionRaw.trim() !== "") {
      row.description = descriptionRaw.replace(/^\s+|\s+$/g, "");
    }

    const priceRaw = (line.values.price ?? "").trim();
    if (priceRaw === "") {
      row.issues.push({ field: "price", message: "Price is missing." });
    } else {
      const price = normalizePrice(priceRaw);
      if (price === undefined) {
        row.issues.push({ field: "price", message: `Price "${priceRaw}" is not valid.` });
      } else {
        row.price = price;
      }
    }

    const availableRaw = (line.values.isAvailable ?? "").trim();
    if (availableRaw !== "") {
      const parsed = normalizeBoolean(availableRaw);
      if (parsed === undefined) {
        row.issues.push({ field: "isAvailable", message: `Availability "${availableRaw}" is not valid — use true/false or yes/no.` });
      } else {
        row.isAvailable = parsed;
      }
    }

    const sortOrderRaw = (line.values.sortOrder ?? "").trim();
    if (sortOrderRaw !== "") {
      const parsed = normalizeSortOrder(sortOrderRaw);
      if (parsed === undefined) {
        row.issues.push({ field: "sortOrder", message: `Sort order "${sortOrderRaw}" is not a valid whole number.` });
      } else {
        row.sortOrder = parsed;
      }
    }

    const imageUrlRaw = (line.values.imageUrl ?? "").trim();
    if (imageUrlRaw !== "") row.imageUrl = imageUrlRaw;

    currentGroups = new Map();
    if (hasModifierData) appendModifierLine(row, currentGroups, line);

    current = row;
    result.push(row);
  }

  return result;
}

function appendModifierLine(
  target: NormalizedImportRow,
  groups: Map<string, MenuImportModifierGroupPreview>,
  line: RawLine
): void {
  const groupName = collapseWhitespace((line.values.modifierGroupName ?? "").trim());
  const optionName = collapseWhitespace((line.values.modifierOptionName ?? "").trim());

  if (groupName === "" || optionName === "") {
    target.issues.push({
      message: `Row ${line.rowNumber}: a modifier row needs both a group name and an option name.`,
    });
    return;
  }

  const priceRaw = (line.values.modifierPrice ?? "").trim();
  let priceAdjustment = 0;
  if (priceRaw !== "") {
    const parsed = normalizePrice(priceRaw);
    if (parsed === undefined) {
      target.issues.push({ message: `Row ${line.rowNumber}: modifier price "${priceRaw}" is not valid.` });
      return;
    }
    priceAdjustment = parsed;
  }

  const key = groupName.toLowerCase();
  let group = groups.get(key);
  if (!group) {
    const minRaw = (line.values.modifierMinSelect ?? "").trim();
    const maxRaw = (line.values.modifierMaxSelect ?? "").trim();
    const min = minRaw === "" ? 0 : normalizeSortOrder(minRaw);
    const max = maxRaw === "" ? 1 : normalizeSortOrder(maxRaw);
    if (min === undefined || max === undefined) {
      target.issues.push({ message: `Row ${line.rowNumber}: modifier min/max select must be whole numbers.` });
      return;
    }
    if (min > max) {
      target.issues.push({ message: `Row ${line.rowNumber}: modifier group "${groupName}" has min select greater than max select.` });
      return;
    }
    group = { name: groupName, minSelect: min, maxSelect: max, options: [] };
    groups.set(key, group);
    target.modifierGroups.push(group);
  }

  if (group.options.some((o) => o.name.toLowerCase() === optionName.toLowerCase())) {
    target.issues.push({ message: `Row ${line.rowNumber}: duplicate modifier option "${optionName}" in group "${groupName}".` });
    return;
  }
  group.options.push({ name: optionName, priceAdjustment });
}
