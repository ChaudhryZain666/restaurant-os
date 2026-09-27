import { Types } from "mongoose";
import { MenuImportJob, type MenuImportJobDoc, type MenuImportDraftRowSubdoc } from "../../models/MenuImportJob.js";
import { getStorageService } from "../../storage/index.js";
import { getMenuExtractionProvider, type MenuExtractionInput } from "../../menuExtraction/index.js";
import { safeUrlFetch, SafeFetchError } from "../../utils/safeUrlFetch.js";
import { resolveImport, type ImportScope } from "./resolveImport.js";
import { extractionResultToNormalizedRows, reviewCategoryFor } from "./extractionResultToRows.js";
import type { NormalizedImportRow } from "./normalizeRows.js";
import {
  URL_FETCH_ALLOWED_CONTENT_TYPES,
  URL_FETCH_MAX_REDIRECTS,
  URL_FETCH_MAX_RESPONSE_BYTES,
  URL_FETCH_TIMEOUT_MS,
} from "./menuImportLimits.js";
import { logger } from "../../common/logger.js";

/** Re-reads status directly from the DB rather than trusting an in-memory copy — a cancel request
 *  can arrive from a completely separate process/request at any point while this runs. */
async function isCancelled(jobId: string): Promise<boolean> {
  const current = await MenuImportJob.findById(jobId).select("status");
  return current?.status === "cancelled";
}

async function buildExtractionInput(job: MenuImportJobDoc): Promise<MenuExtractionInput> {
  if (job.sourceType === "url") {
    if (!job.sourceUrl) throw new Error("URL import job has no sourceUrl.");
    let fetched;
    try {
      fetched = await safeUrlFetch(job.sourceUrl, {
        allowedContentTypes: URL_FETCH_ALLOWED_CONTENT_TYPES,
        maxBytes: URL_FETCH_MAX_RESPONSE_BYTES,
        maxRedirects: URL_FETCH_MAX_REDIRECTS,
        timeoutMs: URL_FETCH_TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof SafeFetchError) throw new Error(describeSafeFetchError(err));
      throw err;
    }
    if (fetched.contentType === "application/pdf") {
      return { kind: "pdf", buffer: fetched.body, fileName: "menu.pdf" };
    }
    return { kind: "html", html: fetched.body.toString("utf-8"), sourceUrl: fetched.finalUrl };
  }

  const storage = getStorageService();
  // sourceFiles is already in upload order (order is assigned once at creation, never reassigned)
  // — the array's own iteration order IS the page/photo order, deliberately never re-sorted here.
  const files = await Promise.all(job.sourceFiles.map((f) => storage.download(f.storageKey)));

  if (job.sourceType === "pdf") {
    return { kind: "pdf", buffer: files[0], fileName: job.sourceFiles[0].originalFileName };
  }
  return {
    kind: "images",
    buffers: files,
    fileNames: job.sourceFiles.map((f) => f.originalFileName),
    mimeTypes: job.sourceFiles.map((f) => f.contentType),
  };
}

function describeSafeFetchError(err: SafeFetchError): string {
  switch (err.code) {
    case "invalid_protocol":
      return "That URL couldn't be used — only https:// links are supported.";
    case "private_ip":
      return "That URL points to a private or internal address and can't be fetched.";
    case "too_many_redirects":
      return "That page redirected too many times.";
    case "response_too_large":
      return "That page was too large to read.";
    case "timeout":
      return "That page took too long to respond.";
    case "unsupported_content_type":
      return "That URL didn't return a web page or PDF we can read.";
    case "dns_resolution_failed":
      return "That URL's address couldn't be found.";
    case "http_error":
      return "That page couldn't be reached.";
    default:
      return "That URL couldn't be read.";
  }
}

/** resolveImport() never actually returns "merge" (that value only ever comes from an explicit
 *  reviewer userAction override, applied later at publish time — see menuImportJob.service.ts) —
 *  this narrows the shared MenuImportRowAction union down to what a freshly-computed systemAction
 *  can legitimately be, falling back to "error" for anything unexpected rather than an unsafe cast. */
function toSystemAction(action: string): "create" | "update" | "skip" | "error" {
  return action === "create" || action === "update" || action === "skip" ? action : "error";
}

function buildDraftRow(row: NormalizedImportRow, systemAction: "create" | "update" | "skip" | "error", matchedItemId?: string): MenuImportDraftRowSubdoc {
  return {
    rowNumber: row.rowNumber,
    categoryName: row.categoryName,
    itemName: row.itemName,
    description: row.description,
    price: row.price,
    isAvailable: row.isAvailable,
    sortOrder: row.sortOrder ?? 0,
    imageUrl: row.imageUrl,
    modifierGroups: row.modifierGroups,
    issues: row.issues,
    overallConfidence: row.overallConfidence ?? 0,
    fieldConfidence: row.fieldConfidence ?? [],
    reviewCategory: reviewCategoryFor(row),
    sourcePageIndex: row.sourcePageIndex,
    systemAction,
    matchedItemId: matchedItemId ? new Types.ObjectId(matchedItemId) : undefined,
  };
}

/**
 * Phase 81 — the worker-invoked orchestration for one async menu-import job: load -> read source
 * (StorageService or SafeUrlFetcher) -> call the extraction provider -> normalize ->
 * resolveImport() (REUSED UNCHANGED from the CSV pipeline) -> persist as ready_for_review. Never
 * writes to the live menu itself — that only ever happens via publishMenuImportJob's explicit,
 * human-triggered call. Called from queues/notification.queue.ts's "menu_import.extract" branch;
 * failure handling (whether to mark the job "failed" or leave it for BullMQ's own retry) is that
 * caller's responsibility — see this function's own throw-always-on-error contract below.
 */
export async function runMenuImportExtraction(jobId: string, attemptInfo: { attemptsMade: number; maxAttempts: number }): Promise<void> {
  // Atomic claim (findOneAndUpdate, not read-then-write) — closes a real TOCTOU race where two
  // concurrent deliveries of the same attempt (BullMQ stalled-job recovery re-delivering after a
  // lock expiry) could both read status "pending" before either had written "processing". A
  // retry (attemptsMade > 0) can also only proceed if the catch block below has first reset a
  // failed prior attempt's status back to "pending" — see there for why that matters.
  const job = await MenuImportJob.findOneAndUpdate(
    { _id: jobId, status: "pending" },
    { $set: { status: "processing", progress: { stage: "processing", percent: 10 } } },
    { new: true }
  );
  if (!job) return; // already claimed by another delivery, already terminal, or already cancelled

  try {
    if (await isCancelled(jobId)) return;

    const input = await buildExtractionInput(job);
    if (await isCancelled(jobId)) return;

    job.status = "extracting";
    job.progress = { stage: "extracting", percent: 40, totalUnits: input.kind === "images" ? input.buffers.length : undefined };
    await job.save();

    const provider = getMenuExtractionProvider();
    const result = await provider.extract(input);
    if (await isCancelled(jobId)) return;

    job.status = "normalizing";
    job.progress = { stage: "normalizing", percent: 80 };
    await job.save();

    const normalized = extractionResultToNormalizedRows(result);
    const scope: ImportScope = { restaurantId: job.restaurantId.toString(), canonicalBusinessId: job.businessId?.toString() };
    const resolved = await resolveImport(normalized, scope, "skip");

    job.draftRows = resolved.rows.map((row, i) => buildDraftRow(normalized[i], toSystemAction(row.action), row.matchedItemId));
    job.categories = resolved.categories;
    job.extractionProviderName = provider.name;
    job.extractionModel = result.modelUsed;
    job.status = "ready_for_review";
    job.progress = { stage: "ready_for_review", percent: 100 };
    await job.save();
  } catch (err) {
    const isLastAttempt = attemptInfo.attemptsMade >= attemptInfo.maxAttempts;
    // Both branches exclude an already-"cancelled" job: a user-triggered cancel (a separate,
    // synchronous API call — see cancelMenuImportJob) can land at any instant, including the
    // narrow window between this attempt throwing and this update running. Without the $ne
    // guard, either branch would silently resurrect a job the user already cancelled.
    if (isLastAttempt) {
      await MenuImportJob.updateOne(
        { _id: jobId, status: { $ne: "cancelled" } },
        { $set: { status: "failed", error: { message: (err as Error).message, stage: job.status, occurredAt: new Date() } } }
      );
      logger.error("menu import extraction failed permanently", { jobId, error: (err as Error).message });
    } else {
      // Reset to "pending" so the next retry's own atomic claim above can actually acquire the
      // job — without this, a retry would find status still "processing"/"extracting"/
      // "normalizing" (whatever this failed attempt last advanced it to) and silently no-op
      // instead of retrying, permanently wedging the job in a non-terminal state forever (this
      // was a real, confirmed bug: BullMQ would report the retry as "succeeded" — no exception
      // thrown — so it would never schedule another attempt, and the owner's UI would poll
      // forever with no error and no result).
      await MenuImportJob.updateOne({ _id: jobId, status: { $ne: "cancelled" } }, { $set: { status: "pending" } });
    }
    throw err; // BullMQ's own retry/backoff applies unless this was the last attempt
  }
}
