import type { MenuImportColumnMapping, MenuImportPreviewResponse, MenuImportSummary } from "@restaurant/types";
import { parseCsv, parseXlsx, type ParsedSheet } from "./parseFile.js";
import { suggestColumnMapping, missingRequiredFields } from "./columnMapping.js";
import { normalizeRows } from "./normalizeRows.js";
import { resolveImport, type ImportScope } from "./resolveImport.js";
import { ApiError } from "../../utils/ApiError.js";

export type MenuImportFileKind = "csv" | "xlsx";

export function detectFileKind(originalName: string, mimetype: string): MenuImportFileKind {
  if (mimetype === "text/csv" || /\.csv$/i.test(originalName)) return "csv";
  if (
    mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    /\.xlsx$/i.test(originalName)
  ) {
    return "xlsx";
  }
  throw ApiError.badRequest("Unsupported file type — upload a .csv or .xlsx file.");
}

export async function parseUploadedSheet(buffer: Buffer, kind: MenuImportFileKind): Promise<ParsedSheet> {
  return kind === "csv" ? parseCsv(buffer) : await parseXlsx(buffer);
}

function summarize(preview: Awaited<ReturnType<typeof resolveImport>>): MenuImportSummary {
  let toCreate = 0;
  let toUpdate = 0;
  let toSkip = 0;
  let rowsWithErrors = 0;
  let modifierGroups = 0;
  let modifierOptions = 0;
  for (const row of preview.rows) {
    if (row.action === "create") toCreate++;
    else if (row.action === "update") toUpdate++;
    else if (row.action === "skip") toSkip++;
    else rowsWithErrors++;
    if (row.action !== "error") {
      modifierGroups += row.modifierGroups.length;
      modifierOptions += row.modifierGroups.reduce((n, g) => n + g.options.length, 0);
    }
  }
  return {
    totalRows: preview.rows.length,
    toCreate,
    toUpdate,
    toSkip,
    rowsWithErrors,
    newCategories: preview.categories.filter((c) => c.status === "new").length,
    existingCategories: preview.categories.filter((c) => c.status === "existing").length,
    modifierGroups,
    modifierOptions,
  };
}

/**
 * Phase 30 — the whole non-mutating preview pipeline: parse -> normalize -> resolve (category
 * matching + duplicate detection against the live database). Shared verbatim by the preview
 * endpoint and the first half of commit (commit re-runs this exact function fresh rather than
 * trusting anything the client echoes back — see commitImport.ts).
 */
export async function buildPreview(
  fileName: string,
  buffer: Buffer,
  kind: MenuImportFileKind,
  requestedMapping: MenuImportColumnMapping | undefined,
  scope: ImportScope,
  duplicateStrategy: "skip" | "update"
): Promise<MenuImportPreviewResponse> {
  const sheet = await parseUploadedSheet(buffer, kind);
  const suggestedMapping = suggestColumnMapping(sheet.headers);
  // A caller-supplied mapping only ever narrows/overrides for headers that actually exist in this
  // file — an unrelated header name from a stale client-side mapping silently has no effect.
  const appliedMapping: MenuImportColumnMapping = { ...suggestedMapping };
  if (requestedMapping) {
    for (const header of sheet.headers) {
      if (header in requestedMapping) appliedMapping[header] = requestedMapping[header];
    }
  }

  const unmappedRequiredFields = missingRequiredFields(appliedMapping);
  if (unmappedRequiredFields.length > 0) {
    return {
      fileName,
      headers: sheet.headers,
      suggestedMapping,
      appliedMapping,
      unmappedRequiredFields,
      rows: [],
      categories: [],
      summary: { totalRows: 0, toCreate: 0, toUpdate: 0, toSkip: 0, rowsWithErrors: 0, newCategories: 0, existingCategories: 0, modifierGroups: 0, modifierOptions: 0 },
      extraSheetsIgnored: sheet.extraSheetsIgnored,
    };
  }

  const normalized = normalizeRows(sheet, appliedMapping);
  const resolved = await resolveImport(normalized, scope, duplicateStrategy);

  return {
    fileName,
    headers: sheet.headers,
    suggestedMapping,
    appliedMapping,
    unmappedRequiredFields: [],
    rows: resolved.rows,
    categories: resolved.categories,
    summary: summarize(resolved),
    extraSheetsIgnored: sheet.extraSheetsIgnored,
  };
}
