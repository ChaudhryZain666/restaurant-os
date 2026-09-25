import multer from "multer";
import type { Request, Response } from "express";
import { updateMenuImportDraftRowSchema, createUrlMenuImportJobSchema, publishMenuImportJobSchema } from "@restaurant/validation";
import type { MenuImportSourceType } from "../models/MenuImportJob.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import {
  createMenuImportJob,
  getMenuImportJobForTenant,
  listMenuImportJobsForTenant,
  updateMenuImportDraftRow,
  cancelMenuImportJob,
  publishMenuImportJob,
} from "../services/menuImport/menuImportJob.service.js";
import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGES_PER_JOB, MAX_IMAGE_SIZE_BYTES, MAX_PDF_SIZE_BYTES } from "../services/menuImport/menuImportLimits.js";

const UNSUPPORTED_FILE_TYPE = "UNSUPPORTED_FILE_TYPE";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(MAX_PDF_SIZE_BYTES, MAX_IMAGE_SIZE_BYTES) },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "application/pdf" || (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype);
    if (!ok) {
      cb(new Error(UNSUPPORTED_FILE_TYPE));
      return;
    }
    cb(null, true);
  },
}).array("files", MAX_IMAGES_PER_JOB);

async function runUpload(req: Request, res: Response): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      upload(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      throw ApiError.badRequest("One of your files is too large.");
    }
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_COUNT") {
      throw ApiError.badRequest(`You can upload at most ${MAX_IMAGES_PER_JOB} files at once.`);
    }
    if (err instanceof Error && err.message === UNSUPPORTED_FILE_TYPE) {
      throw ApiError.badRequest("Unsupported file type — upload a PDF or a JPEG/PNG/WebP image.");
    }
    throw err;
  }
}

function isSourceType(value: unknown): value is MenuImportSourceType {
  return value === "pdf" || value === "image" || value === "images" || value === "url";
}

/**
 * POST /restaurants/:restaurantId/menu/import-jobs — the entry point for the async PDF/image/URL
 * menu importer (CSV/XLSX keeps its own separate, synchronous /menu/import/{preview,commit}
 * endpoints — see menuImport.controller.ts — untouched by this phase). Branches on Content-Type:
 * a JSON body (sourceType "url") never touches multer at all; a multipart body (pdf/image/images)
 * runs multer first. Never processes the source inline — createMenuImportJob only validates,
 * persists, and enqueues; see extractionPipeline.service.ts for the actual work, run by the
 * background worker.
 */
export async function createMenuImportJobHandler(req: Request, res: Response): Promise<void> {
  const { restaurantId } = req.params;
  const contentType = req.headers["content-type"] ?? "";

  if (contentType.startsWith("multipart/form-data")) {
    await runUpload(req, res);
    const sourceType = req.body?.sourceType;
    if (!isSourceType(sourceType) || sourceType === "url") {
      throw ApiError.badRequest('sourceType must be one of "pdf", "image", or "images" for a file upload.');
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw ApiError.badRequest("At least one file is required.");

    if (sourceType === "pdf") {
      if (files.length !== 1 || files[0].mimetype !== "application/pdf") {
        throw ApiError.badRequest("A PDF import needs exactly one PDF file.");
      }
      if (files[0].size > MAX_PDF_SIZE_BYTES) {
        throw ApiError.badRequest(`That PDF is too large — the maximum size is ${Math.round(MAX_PDF_SIZE_BYTES / (1024 * 1024))}MB.`);
      }
    } else {
      if (sourceType === "image" && files.length !== 1) {
        throw ApiError.badRequest("A single-photo import needs exactly one image.");
      }
      for (const file of files) {
        if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
          throw ApiError.badRequest("Every file must be a JPEG, PNG, or WebP image.");
        }
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
          throw ApiError.badRequest(`One of your images is too large — the maximum size is ${Math.round(MAX_IMAGE_SIZE_BYTES / (1024 * 1024))}MB.`);
        }
      }
    }

    const job = await createMenuImportJob({
      restaurantId,
      requestedByUserId: req.user!.id,
      sourceType,
      files: files.map((f) => ({ buffer: f.buffer, originalFileName: f.originalname, contentType: f.mimetype })),
    });
    sendSuccess(res, { job }, 201);
    return;
  }

  const parsed = createUrlMenuImportJobSchema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest("A valid url is required.");
  const job = await createMenuImportJob({
    restaurantId,
    requestedByUserId: req.user!.id,
    sourceType: "url",
    sourceUrl: parsed.data.url,
  });
  sendSuccess(res, { job }, 201);
}

export async function listMenuImportJobsHandler(req: Request, res: Response): Promise<void> {
  const jobs = await listMenuImportJobsForTenant(req.params.restaurantId);
  sendSuccess(res, { jobs });
}

/** GET .../menu/import-jobs/:jobId — the poll target while non-terminal, and the review payload
 *  once ready_for_review. */
export async function getMenuImportJobHandler(req: Request, res: Response): Promise<void> {
  const job = await getMenuImportJobForTenant(req.params.jobId, req.params.restaurantId);
  sendSuccess(res, { job });
}

export async function updateMenuImportDraftRowHandler(req: Request, res: Response): Promise<void> {
  const rowNumber = Number(req.params.rowNumber);
  if (!Number.isInteger(rowNumber)) throw ApiError.badRequest("Invalid row number.");
  const parsed = updateMenuImportDraftRowSchema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest("Invalid row edit.", parsed.error.flatten());
  const job = await updateMenuImportDraftRow(req.params.jobId, req.params.restaurantId, rowNumber, parsed.data);
  sendSuccess(res, { job });
}

export async function publishMenuImportJobHandler(req: Request, res: Response): Promise<void> {
  const parsed = publishMenuImportJobSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw ApiError.badRequest("Invalid publish request.");
  const job = await publishMenuImportJob({
    jobId: req.params.jobId,
    restaurantId: req.params.restaurantId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    defaultDuplicateStrategy: parsed.data.defaultDuplicateStrategy,
  });
  sendSuccess(res, { job });
}

export async function cancelMenuImportJobHandler(req: Request, res: Response): Promise<void> {
  const job = await cancelMenuImportJob(req.params.jobId, req.params.restaurantId);
  sendSuccess(res, { job });
}
