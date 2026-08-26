import Papa from "papaparse";
import ExcelJS from "exceljs";
import { ApiError } from "../../utils/ApiError.js";

export interface ParsedSheet {
  headers: string[];
  /** Raw string cell values, keyed by the exact source header text. Missing trailing cells on a
   *  short row become "" rather than undefined, so every row has every header key. */
  rows: Array<Record<string, string>>;
  /** Non-empty only for a multi-sheet XLSX workbook — sheet names past the first, which Phase 30
   *  deliberately does not read (see docs/menu-import-architecture.md). Always [] for CSV. */
  extraSheetsIgnored: string[];
}

const MAX_ROWS = 5000;

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    // Rich text / formula / hyperlink cells — ExcelJS returns an object shape for these; take the
    // best plain-text representation rather than "[object Object]".
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return String((value as { result: unknown }).result ?? "");
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text).join("");
    }
    return "";
  }
  return String(value);
}

function rowsFromMatrix(headers: string[], matrix: string[][]): Array<Record<string, string>> {
  return matrix
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((header, i) => {
        record[header] = (row[i] ?? "").trim();
      });
      return record;
    });
}

/**
 * CSV parsing safety: papaparse never executes file content — a cell that happens to start with
 * "=", "+", "-", or "@" (the classic spreadsheet-formula-injection prefixes) is read here as an
 * inert string, same as every other cell. The injection risk this codebase actually has to guard
 * against is the OPPOSITE direction — generating a CSV (the error report, Step 14) that a victim
 * later opens in Excel — see menuImportReport.ts's own sanitization for that.
 */
export function parseCsv(buffer: Buffer): ParsedSheet {
  const text = buffer.toString("utf-8").replace(/^﻿/, ""); // strip a UTF-8 BOM if present
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  if (result.errors.length > 0 && result.data.length === 0) {
    throw ApiError.badRequest(`Could not parse this CSV file: ${result.errors[0].message}`);
  }
  const matrix = result.data;
  if (matrix.length === 0) throw ApiError.badRequest("This CSV file has no rows.");
  const headers = matrix[0].map((h) => h.trim());
  if (headers.every((h) => h === "")) throw ApiError.badRequest("This CSV file's header row is empty.");
  if (matrix.length - 1 > MAX_ROWS) {
    throw ApiError.badRequest(`This file has more than ${MAX_ROWS} rows — split it into smaller imports.`);
  }
  return { headers, rows: rowsFromMatrix(headers, matrix.slice(1)), extraSheetsIgnored: [] };
}

/**
 * XLSX parsing — reads the FIRST worksheet only (documented, not silent — see
 * docs/menu-import-architecture.md's "Excel" section). ExcelJS streams the file rather than
 * loading a DOM-like model eagerly for every cell type, and never executes formulas — a formula
 * cell is read via its cached `result`, never recalculated server-side.
 */
export async function parseXlsx(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  try {
    // A real Buffer at runtime either way — this repo resolves two structurally-incompatible
    // @types/node Buffer declarations (workspace hoisting quirk), which `unknown` alone can't
    // bridge since both sides say "Buffer". `any` is the narrowest available escape for this one
    // cross-package type-definition mismatch, not a general type-safety opt-out.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
  } catch (err) {
    throw ApiError.badRequest(`Could not read this Excel file: ${(err as Error).message}`);
  }
  if (workbook.worksheets.length === 0) throw ApiError.badRequest("This Excel file has no sheets.");

  const [sheet, ...rest] = workbook.worksheets;
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(cellToString(cell.value));
    });
    matrix.push(cells);
  });
  if (matrix.length === 0) throw ApiError.badRequest("This Excel file's first sheet has no rows.");
  const headers = matrix[0].map((h) => h.trim());
  if (headers.every((h) => h === "")) throw ApiError.badRequest("This Excel file's header row is empty.");
  if (matrix.length - 1 > MAX_ROWS) {
    throw ApiError.badRequest(`This file has more than ${MAX_ROWS} rows — split it into smaller imports.`);
  }
  return {
    headers,
    rows: rowsFromMatrix(headers, matrix.slice(1)),
    extraSheetsIgnored: rest.map((s) => s.name),
  };
}
