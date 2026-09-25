/**
 * Phase 81 — single source of truth for every size/count/timeout boundary in the async menu-import
 * pipeline (PDF/URL/image sources). menuImportJob.controller.ts's multer config, the extraction
 * pipeline worker, and the Claude adapter's own request timeout all import from here rather than
 * each hardcoding a number — mirrors this codebase's existing discipline of a named constant per
 * boundary (e.g. StripeProvider.ts's REQUEST_TIMEOUT_MS), just centralized since this feature has
 * many more boundaries than a single provider adapter does.
 */
export const MAX_PDF_SIZE_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_PAGES = 20;
export const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES_PER_JOB = 12;
export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const URL_FETCH_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const URL_FETCH_TIMEOUT_MS = 15_000;
export const URL_FETCH_MAX_REDIRECTS = 3;
export const URL_FETCH_ALLOWED_CONTENT_TYPES = ["text/html", "application/pdf"] as const;

/** Own AbortController in the Claude adapter, independent of BullMQ's job-level timeout — a hung
 *  vision/document request must not hold a worker slot indefinitely. */
export const EXTRACTION_PROVIDER_TIMEOUT_MS = 90_000;

export const MENU_IMPORT_JOB_ATTEMPTS = 3;
export const MENU_IMPORT_JOB_BACKOFF_DELAY_MS = 5_000;

/** Checked at job creation (any non-terminal status counts) — prevents one restaurant from
 *  queue-flooding the shared "notifications" queue and inflating every other tenant's latency. */
export const MAX_CONCURRENT_IMPORT_JOBS_PER_RESTAURANT = 3;

/** Source files are deleted this many days after a job reaches a terminal state (completed/
 *  failed/cancelled) — the job document itself (draft rows, confidence, report) is kept
 *  indefinitely, same as AuditLog. Only the raw uploaded bytes are perishable. */
export const SOURCE_FILE_RETENTION_DAYS = 14;

export const MENU_IMPORT_CONFIDENCE_THRESHOLDS = {
  looksGood: 0.85,
  checkThis: 0.6,
} as const;
