/**
 * Phase 30 — the "normalized import representation" every current and future menu import source
 * (CSV, XLSX, and eventually PDF/OCR/AI) is required to converge on before it ever touches
 * validation, category resolution, duplicate detection, or the database. See
 * docs/menu-import-architecture.md for the full contract and column-mapping rules. Nothing past
 * this file's boundary should know or care whether a row originally came from a spreadsheet cell.
 */

/** The logical fields a source column can map onto. Anything else in the uploaded file is ignored. */
export const MENU_IMPORT_FIELD_KEYS = [
  "categoryName",
  "itemName",
  "description",
  "price",
  "isAvailable",
  "sortOrder",
  "imageUrl",
  "modifierGroupName",
  "modifierOptionName",
  "modifierPrice",
  "modifierMinSelect",
  "modifierMaxSelect",
] as const;
export type MenuImportFieldKey = (typeof MENU_IMPORT_FIELD_KEYS)[number];

export const MENU_IMPORT_REQUIRED_FIELDS: MenuImportFieldKey[] = ["categoryName", "itemName", "price"];

/** Keyed by the RAW source column header exactly as it appeared in the uploaded file's header row. */
export type MenuImportColumnMapping = Record<string, MenuImportFieldKey | null>;

export interface MenuImportRowIssue {
  field?: MenuImportFieldKey;
  message: string;
}

export type MenuImportRowAction = "create" | "update" | "skip" | "error";

export interface MenuImportModifierOptionPreview {
  name: string;
  priceAdjustment: number;
}

export interface MenuImportModifierGroupPreview {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MenuImportModifierOptionPreview[];
}

export interface MenuImportPreviewRow {
  /** 1-based, counting only data rows (the header row is never row 1). */
  rowNumber: number;
  categoryName: string;
  itemName: string;
  description?: string;
  price?: number;
  isAvailable: boolean;
  sortOrder: number;
  imageUrl?: string;
  action: MenuImportRowAction;
  /** Set only when this row matched an existing MenuItem (action is "update" or would be "skip"). */
  matchedItemId?: string;
  /** The matched item's CURRENT field values, set only when action is "update" — lets the UI show
   *  an explicit before/after diff rather than just "this will change". */
  previousValues?: {
    price: number;
    description: string;
    isAvailable: boolean;
    sortOrder: number;
    imageUrl?: string;
  };
  issues: MenuImportRowIssue[];
  modifierGroups: MenuImportModifierGroupPreview[];
}

export interface MenuImportCategorySummary {
  name: string;
  status: "existing" | "new";
  itemCount: number;
}

export interface MenuImportSummary {
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  rowsWithErrors: number;
  newCategories: number;
  existingCategories: number;
  modifierGroups: number;
  modifierOptions: number;
}

export interface MenuImportPreviewResponse {
  fileName: string;
  headers: string[];
  suggestedMapping: MenuImportColumnMapping;
  appliedMapping: MenuImportColumnMapping;
  /** Required fields the applied mapping doesn't cover — a non-empty array means preview couldn't
   *  validate rows at all and commit must not be attempted until this is resolved. */
  unmappedRequiredFields: MenuImportFieldKey[];
  rows: MenuImportPreviewRow[];
  categories: MenuImportCategorySummary[];
  summary: MenuImportSummary;
  /** True only when the uploaded workbook had more than one sheet — Phase 30 reads the first sheet
   *  only and surfaces this so the user isn't silently missing data on sheet 2+. */
  extraSheetsIgnored: string[];
}

export interface MenuImportReport {
  importId: string;
  fileName: string;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  categoriesCreated: number;
  itemsCreated: number;
  modifierGroupsCreated: number;
  modifierOptionsCreated: number;
  createdAt: string;
  actorName?: string;
}
