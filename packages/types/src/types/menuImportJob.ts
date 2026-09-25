/**
 * Phase 81 — the async menu-import-job contract (PDF/URL/image sources), built as a sibling to
 * menuImport.ts's CSV/XLSX contract, never a replacement for it. Every source ultimately produces
 * the same NormalizedImportRow[] shape the CSV pipeline already establishes (see
 * docs/menu-import-architecture.md) — this file's job-specific types are the async/durable/
 * reviewable wrapper around that shared shape, not a parallel menu-data model.
 */
import type { MenuImportCategorySummary, MenuImportModifierGroupPreview, MenuImportReport, MenuImportRowIssue } from "./menuImport.js";

export const MENU_IMPORT_JOB_STATUSES = [
  "pending",
  "processing",
  "extracting",
  "normalizing",
  "ready_for_review",
  "publishing",
  "completed",
  "failed",
  "cancelled",
] as const;
export type MenuImportJobStatus = (typeof MENU_IMPORT_JOB_STATUSES)[number];

export const MENU_IMPORT_JOB_TERMINAL_STATUSES: MenuImportJobStatus[] = ["completed", "failed", "cancelled"];

export const MENU_IMPORT_SOURCE_TYPES = ["pdf", "image", "images", "url"] as const;
export type MenuImportSourceType = (typeof MENU_IMPORT_SOURCE_TYPES)[number];

/** "looks_good" | "check_this" | "missing" | "needs_review" — the plain-language bucket a
 *  restaurant owner actually sees; never a raw confidence number in the UI. Derived server-side
 *  from `overallConfidence` + `issues`, never client-computed. */
export const MENU_IMPORT_REVIEW_CATEGORIES = ["looks_good", "check_this", "missing", "needs_review"] as const;
export type MenuImportReviewCategory = (typeof MENU_IMPORT_REVIEW_CATEGORIES)[number];

/** The reviewer's explicit per-row override of what publish should do with a matched duplicate —
 *  "create" only ever applies to a row that had no match in the first place. */
export const MENU_IMPORT_USER_ACTIONS = ["create", "update", "merge", "skip"] as const;
export type MenuImportUserAction = (typeof MENU_IMPORT_USER_ACTIONS)[number];

export interface MenuImportSourceFileSummary {
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  /** 1-based — preserves multi-page/photo ordering. Never reassigned after upload. */
  order: number;
}

export interface MenuImportFieldConfidence {
  field: string;
  score: number;
}

export interface MenuImportJobProgress {
  stage: MenuImportJobStatus;
  /** Real, stage-boundary values only (0/10/40/80/100) — never a fabricated animated value. */
  percent: number;
  /** Present only when the current stage has a genuinely countable unit of work (e.g. multi-image
   *  extraction) — absent, not faked, for single-call stages like one PDF or a URL fetch. */
  currentUnit?: number;
  totalUnits?: number;
  message?: string;
}

export interface MenuImportDraftRow {
  rowNumber: number;
  categoryName: string;
  itemName: string;
  description?: string;
  price?: number;
  isAvailable: boolean;
  sortOrder: number;
  imageUrl?: string;
  modifierGroups: MenuImportModifierGroupPreview[];
  issues: MenuImportRowIssue[];
  overallConfidence: number;
  fieldConfidence: MenuImportFieldConfidence[];
  reviewCategory: MenuImportReviewCategory;
  /** 1-based, matches sourceFiles[].order — which page/photo this row came from. Absent for url
   *  jobs (a single HTML document has no "page"). */
  sourcePageIndex?: number;
  /** What resolveImport() (re-run at publish time against current live data) would do with this
   *  row absent any reviewer override. */
  systemAction: "create" | "update" | "skip" | "error";
  /** Set only when this row matched an existing MenuItem (systemAction "update" or would-be "skip"). */
  matchedItemId?: string;
  userAction?: MenuImportUserAction;
  /** Set the moment a human PATCHes this row — lets the UI distinguish "never reviewed" from
   *  "reviewed, no changes needed." */
  reviewedAt?: string;
}

export interface MenuImportJobError {
  message: string;
  stage: MenuImportJobStatus;
  occurredAt: string;
}

export interface MenuImportJobSummary {
  id: string;
  restaurantId: string;
  businessId?: string;
  sourceType: MenuImportSourceType;
  status: MenuImportJobStatus;
  progress: MenuImportJobProgress;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  cancelledAt?: string;
}

export interface MenuImportJobDetail extends MenuImportJobSummary {
  sourceUrl?: string;
  sourceFiles: MenuImportSourceFileSummary[];
  draftRows: MenuImportDraftRow[];
  categories: MenuImportCategorySummary[];
  extractionProviderName?: string;
  extractionModel?: string;
  error?: MenuImportJobError;
  attempts: number;
  publishedReport?: MenuImportReport;
}

export interface MenuImportJobListResponse {
  jobs: MenuImportJobSummary[];
}
