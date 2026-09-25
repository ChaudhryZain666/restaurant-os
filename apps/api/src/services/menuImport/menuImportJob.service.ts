import mongoose, { type HydratedDocument } from "mongoose";
import type { UpdateMenuImportDraftRowInput } from "@restaurant/validation";
import { MenuImportJob, type MenuImportJobDoc, type MenuImportSourceType } from "../../models/MenuImportJob.js";

type MenuImportJobHydrated = HydratedDocument<MenuImportJobDoc>;
import { Restaurant } from "../../models/Restaurant.js";
import { ApiError } from "../../utils/ApiError.js";
import { getStorageService } from "../../storage/index.js";
import { notificationQueue } from "../../queues/notification.queue.js";
import { logger } from "../../common/logger.js";
import { resolveImportScope } from "./resolveImportScope.js";
import { resolveImport, type ImportScope } from "./resolveImport.js";
import { writeResolvedImport } from "./writeResolvedImport.js";
import type { NormalizedImportRow } from "./normalizeRows.js";
import {
  MAX_CONCURRENT_IMPORT_JOBS_PER_RESTAURANT,
  MAX_IMAGES_PER_JOB,
  SOURCE_FILE_RETENTION_DAYS,
  MENU_IMPORT_JOB_ATTEMPTS,
  MENU_IMPORT_JOB_BACKOFF_DELAY_MS,
} from "./menuImportLimits.js";

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export interface CreateMenuImportJobFileInput {
  buffer: Buffer;
  originalFileName: string;
  contentType: string;
}

export interface CreateMenuImportJobParams {
  restaurantId: string;
  requestedByUserId: string;
  sourceType: MenuImportSourceType;
  sourceUrl?: string;
  files?: CreateMenuImportJobFileInput[];
}

/**
 * Phase 81 — creates the job document, persists any uploaded source file(s) to StorageService (the
 * CSV/XLSX importer never persists its file — see commitImport.ts's own comment — but an async job
 * must survive past the initial request, so its source has to be durable), and enqueues the
 * extraction job on the existing shared "notifications" queue. Never runs extraction inline.
 */
export async function createMenuImportJob(params: CreateMenuImportJobParams): Promise<MenuImportJobHydrated> {
  const activeCount = await MenuImportJob.countDocuments({
    restaurantId: params.restaurantId,
    status: { $nin: TERMINAL_STATUSES },
  });
  if (activeCount >= MAX_CONCURRENT_IMPORT_JOBS_PER_RESTAURANT) {
    throw ApiError.badRequest(
      `This restaurant already has ${MAX_CONCURRENT_IMPORT_JOBS_PER_RESTAURANT} menu imports in progress — wait for one to finish before starting another.`
    );
  }
  if (params.sourceType === "images" && (params.files?.length ?? 0) > MAX_IMAGES_PER_JOB) {
    throw ApiError.badRequest(`You can import at most ${MAX_IMAGES_PER_JOB} images in one job.`);
  }
  if (params.sourceType === "url" && !params.sourceUrl) {
    throw ApiError.badRequest("A URL is required for this import source.");
  }
  if (params.sourceType !== "url" && (!params.files || params.files.length === 0)) {
    throw ApiError.badRequest("At least one file is required for this import source.");
  }

  const scope = await resolveImportScope(params.restaurantId);
  const jobId = new mongoose.Types.ObjectId();

  const sourceFiles: MenuImportJobDoc["sourceFiles"] = [];
  if (params.files) {
    const storage = getStorageService();
    for (let i = 0; i < params.files.length; i++) {
      const file = params.files[i];
      const key = `restaurants/${params.restaurantId}/menu-imports/${jobId.toString()}/source/${i + 1}-${sanitizeFileName(file.originalFileName)}`;
      await storage.upload(key, file.buffer, file.contentType);
      sourceFiles.push({
        storageKey: key,
        originalFileName: file.originalFileName,
        contentType: file.contentType,
        sizeBytes: file.buffer.length,
        order: i + 1,
      });
    }
  }

  const job = await MenuImportJob.create({
    _id: jobId,
    restaurantId: params.restaurantId,
    businessId: scope.canonicalBusinessId,
    requestedByUserId: params.requestedByUserId,
    sourceType: params.sourceType,
    sourceUrl: params.sourceUrl,
    sourceFiles,
    status: "pending",
    progress: { stage: "pending", percent: 0 },
    attempts: 0,
  });

  // A failure to enqueue (e.g. a transient Redis hiccup) must never surface as a 500 on job
  // creation — the job record itself is already real and persisted. Mirrors
  // marketplaceWebhook.controller.ts's own "record the failure, never let it fail the whole
  // response" discipline: mark the job failed with an honest, specific error rather than leaving
  // it silently stuck in "pending" forever with no worker ever picking it up.
  try {
    await notificationQueue.add(
      "menu_import.extract",
      { jobId: job.id as string },
      { attempts: MENU_IMPORT_JOB_ATTEMPTS, backoff: { type: "exponential", delay: MENU_IMPORT_JOB_BACKOFF_DELAY_MS } }
    );
  } catch (err) {
    job.status = "failed";
    job.error = { message: "Could not schedule this import for processing — please try again.", stage: "pending", occurredAt: new Date() };
    await job.save();
    logger.error("failed to enqueue menu_import.extract", { jobId: job.id, error: (err as Error).message });
  }

  return job;
}

/** Resolves whether a loaded job is visible from the given restaurant's tenant context — a direct
 *  restaurantId match, OR (Phase 81, mirrors resolveImport.ts's own canonical-business scoping)
 *  the job's businessId matching the requesting restaurant's own resolved canonical business, so a
 *  job created from one location of a canonical multi-location business is visible from any of
 *  that business's other locations too, exactly like the menu itself already is. Never throws a
 *  distinguishable "wrong tenant" error from "not found" — both read as 404. */
async function assertJobVisibleToRestaurant(job: MenuImportJobHydrated, restaurantId: string): Promise<void> {
  if (job.restaurantId.toString() === restaurantId) return;
  if (job.businessId) {
    const restaurant = await Restaurant.findById(restaurantId).select("businessId");
    if (restaurant?.businessId && restaurant.businessId.toString() === job.businessId.toString()) return;
  }
  throw ApiError.notFound("Import job not found");
}

export async function getMenuImportJobForTenant(jobId: string, restaurantId: string): Promise<MenuImportJobHydrated> {
  if (!mongoose.isValidObjectId(jobId)) throw ApiError.notFound("Import job not found");
  const job = await MenuImportJob.findById(jobId);
  if (!job) throw ApiError.notFound("Import job not found");
  await assertJobVisibleToRestaurant(job, restaurantId);
  return job;
}

export async function listMenuImportJobsForTenant(restaurantId: string): Promise<MenuImportJobHydrated[]> {
  const scope = await resolveImportScope(restaurantId);
  const filter = scope.canonicalBusinessId
    ? { $or: [{ restaurantId }, { businessId: scope.canonicalBusinessId }] }
    : { restaurantId };
  return MenuImportJob.find(filter).sort({ createdAt: -1 }).limit(50);
}

export async function updateMenuImportDraftRow(
  jobId: string,
  restaurantId: string,
  rowNumber: number,
  patch: UpdateMenuImportDraftRowInput
): Promise<MenuImportJobHydrated> {
  const job = await getMenuImportJobForTenant(jobId, restaurantId);
  if (job.status !== "ready_for_review") {
    throw ApiError.badRequest(`This import can't be edited while it's "${job.status}" — only while it's ready for review.`);
  }
  const row = job.draftRows.find((r) => r.rowNumber === rowNumber);
  if (!row) throw ApiError.notFound(`Row ${rowNumber} not found on this import.`);

  if (patch.categoryName !== undefined) row.categoryName = patch.categoryName;
  if (patch.itemName !== undefined) row.itemName = patch.itemName;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.price !== undefined) row.price = patch.price;
  if (patch.isAvailable !== undefined) row.isAvailable = patch.isAvailable;
  if (patch.sortOrder !== undefined) row.sortOrder = patch.sortOrder;
  if (patch.imageUrl !== undefined) row.imageUrl = patch.imageUrl;
  if (patch.modifierGroups !== undefined) {
    row.modifierGroups = patch.modifierGroups.map((g) => ({
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: g.options.map((o) => ({ name: o.name, priceAdjustment: o.priceAdjustment })),
    }));
  }
  if (patch.userAction !== undefined) row.userAction = patch.userAction;
  row.reviewedAt = new Date();

  await job.save();
  return job;
}

/** Cooperative cancellation — sets status:"cancelled" from any non-terminal state. The worker
 *  (extractionPipeline.service.ts) re-checks job.status before each stage transition and bails out
 *  early once it's no longer one of the active in-flight statuses, rather than being forcibly
 *  killed mid-flight — same "observe, don't act destructively" spirit as this codebase's other
 *  background-job safety nets. */
export async function cancelMenuImportJob(jobId: string, restaurantId: string): Promise<MenuImportJobHydrated> {
  const job = await getMenuImportJobForTenant(jobId, restaurantId);
  if (TERMINAL_STATUSES.includes(job.status as (typeof TERMINAL_STATUSES)[number])) {
    throw ApiError.badRequest(`This import is already "${job.status}" and can't be cancelled.`);
  }
  job.status = "cancelled";
  job.cancelledAt = new Date();
  job.sourceRetentionDeleteAt = new Date(Date.now() + SOURCE_FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await job.save();
  return job;
}

export interface PublishMenuImportJobParams {
  jobId: string;
  restaurantId: string;
  actorUserId: string;
  actorRole: string;
  defaultDuplicateStrategy: "skip" | "update" | "merge";
}

/**
 * Phase 81 — the human-required publish gate. Nothing else in this pipeline ever writes to the
 * live menu; only this function does, and only once a human has reached "ready_for_review" and
 * explicitly called it. Re-runs resolveImport() against the job's CURRENT draftRows treated as
 * NormalizedImportRow[] (never trusts the systemAction computed back at extraction time — real
 * time may have passed, and someone could have manually edited the live menu in the meantime),
 * then overrides each row's action per the reviewer's explicit userAction where set, falling back
 * to the fresh systemAction resolveImport() just computed, then to the job-wide
 * defaultDuplicateStrategy for a row that matched but was never explicitly reviewed.
 */
export async function publishMenuImportJob(params: PublishMenuImportJobParams): Promise<MenuImportJobHydrated> {
  const job = await getMenuImportJobForTenant(params.jobId, params.restaurantId);
  if (job.status !== "ready_for_review") {
    throw ApiError.badRequest(`This import can't be published while it's "${job.status}" — only while it's ready for review.`);
  }

  // Guard against a concurrent double-publish (two rapid clicks) racing each other.
  const claimed = await MenuImportJob.findOneAndUpdate(
    { _id: job._id, status: "ready_for_review" },
    { $set: { status: "publishing" } },
    { new: true }
  );
  if (!claimed) throw ApiError.conflict("This import is already being published.");

  try {
    const scope: ImportScope = { restaurantId: params.restaurantId, canonicalBusinessId: job.businessId?.toString() };
    const asNormalizedRows: NormalizedImportRow[] = claimed.draftRows.map((row) => ({
      rowNumber: row.rowNumber,
      categoryName: row.categoryName,
      itemName: row.itemName,
      description: row.description,
      price: row.price,
      isAvailable: row.isAvailable,
      sortOrder: row.sortOrder,
      imageUrl: row.imageUrl,
      modifierGroups: row.modifierGroups,
      // The subdocument schema stores `field` as a plain string (it accepts whatever field name
      // extraction/review produced); every value ever actually written to it (by
      // extractionResultToRows.ts or updateMenuImportDraftRowSchema) is already a real
      // MenuImportFieldKey, so this narrows a structurally-looser Mongoose type back to the
      // stricter shared one rather than reflecting any real runtime ambiguity.
      issues: row.issues as NormalizedImportRow["issues"],
      overallConfidence: row.overallConfidence,
      fieldConfidence: row.fieldConfidence,
      sourcePageIndex: row.sourcePageIndex,
    }));

    const resolved = await resolveImport(asNormalizedRows, scope, params.defaultDuplicateStrategy === "update" ? "update" : "skip");

    const userActionByRow = new Map(claimed.draftRows.map((r) => [r.rowNumber, r.userAction]));
    for (const row of resolved.rows) {
      if (row.action === "error") continue; // never overridable — the row genuinely can't be written
      const userAction = userActionByRow.get(row.rowNumber);
      if (userAction) {
        row.action = userAction;
      } else if (row.action === "update" && params.defaultDuplicateStrategy === "merge") {
        // The job-wide default is "merge" and this row was never individually reviewed but did
        // match an existing item — apply the default the same way skip/update already would.
        row.action = "merge";
      }
    }

    const report = await writeResolvedImport({
      resolved,
      scope,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      fileName: job.sourceType === "url" ? (job.sourceUrl ?? "menu URL import") : `${job.sourceType} import`,
    });

    claimed.status = "completed";
    claimed.publishedAt = new Date();
    claimed.publishedReport = {
      importId: report.importId,
      totalRows: report.totalRows,
      created: report.created,
      updated: report.updated,
      skipped: report.skipped,
      errors: report.errors,
      categoriesCreated: report.categoriesCreated,
      modifierGroupsCreated: report.modifierGroupsCreated,
      modifierOptionsCreated: report.modifierOptionsCreated,
    };
    claimed.sourceRetentionDeleteAt = new Date(Date.now() + SOURCE_FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await claimed.save();
    return claimed;
  } catch (err) {
    claimed.status = "ready_for_review"; // publish failed — give the reviewer their draft back, not a wedged "publishing" state
    await claimed.save();
    throw err;
  }
}
