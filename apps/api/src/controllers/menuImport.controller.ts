import multer from "multer";
import type { Request, Response } from "express";
import type { MenuImportColumnMapping } from "@restaurant/types";
import { menuImportCommitRequestSchema } from "@restaurant/validation";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { AuditLog } from "../models/AuditLog.js";
import { User } from "../models/User.js";
import { buildPreview, detectFileKind } from "../services/menuImport/buildPreview.js";
import { commitImport } from "../services/menuImport/commitImport.js";
import { resolveImportScope } from "../services/menuImport/resolveImportScope.js";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const UNSUPPORTED_FILE_TYPE = "UNSUPPORTED_FILE_TYPE";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      /\.(csv|xlsx)$/i.test(file.originalname);
    if (!ok) {
      cb(new Error(UNSUPPORTED_FILE_TYPE));
      return;
    }
    cb(null, true);
  },
}).single("file");

/** Mirrors upload.controller.ts's own promise-wrapped multer invocation — multer's callback API
 *  predates promises and every route in this codebase that needs multipart parsing wraps it the
 *  same way, so req.file/req.body are populated before any of our own logic runs. */
async function runUpload(req: Request, res: Response): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      upload(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      throw ApiError.badRequest(`File too large — the maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`);
    }
    if (err instanceof Error && err.message === UNSUPPORTED_FILE_TYPE) {
      throw ApiError.badRequest("Unsupported file type — upload a .csv or .xlsx file");
    }
    throw err;
  }
  if (!req.file) throw ApiError.badRequest("No file was uploaded");
}

/** The `mapping`/`duplicateStrategy` fields arrive as plain multipart strings alongside the file,
 *  parsed and validated here (not via the router-level validateBody middleware, which assumes
 *  req.body is already a plain object by the time it runs — multer has to go first). */
function parseMapping(raw: unknown): MenuImportColumnMapping | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string") throw ApiError.badRequest("mapping must be a JSON object");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw ApiError.badRequest("mapping is not valid JSON");
  }
  const result = menuImportCommitRequestSchema.shape.mapping.safeParse(parsed);
  if (!result.success) throw ApiError.badRequest("mapping is not a valid column mapping");
  return result.data;
}

/**
 * POST /restaurants/:restaurantId/menu/import/preview — multipart file + optional `mapping` JSON
 * field. Never writes anything (see buildPreview.ts). requireTenantMatch + requireTenantPermission
 * on the route already confirm the caller can write to this restaurant's menu — Phase 30 reuses
 * that exact gate rather than inventing a parallel one, so agency/multi-location access works
 * identically to every other menu-write route (see docs/menu-import-architecture.md).
 */
export async function previewMenuImport(req: Request, res: Response): Promise<void> {
  await runUpload(req, res);
  const { restaurantId } = req.params;
  const mapping = parseMapping(req.body?.mapping);
  const duplicateStrategyRaw = req.body?.duplicateStrategy;
  const duplicateStrategy = duplicateStrategyRaw === "update" ? "update" : "skip";

  const kind = detectFileKind(req.file!.originalname, req.file!.mimetype);
  const scope = await resolveImportScope(restaurantId);
  const preview = await buildPreview(req.file!.originalname, req.file!.buffer, kind, mapping, scope, duplicateStrategy);
  sendSuccess(res, preview);
}

/**
 * POST /restaurants/:restaurantId/menu/import/commit — multipart file (the SAME file re-uploaded,
 * not a reference to the earlier preview call) + required `mapping` JSON + optional
 * `duplicateStrategy`. Re-parses and re-resolves everything fresh server-side — see
 * commitImport.ts's own doc comment for why nothing from an earlier preview call is trusted here.
 */
export async function commitMenuImport(req: Request, res: Response): Promise<void> {
  await runUpload(req, res);
  const { restaurantId } = req.params;
  const mapping = parseMapping(req.body?.mapping);
  if (!mapping) throw ApiError.badRequest("mapping is required to commit an import");
  const duplicateStrategyRaw = req.body?.duplicateStrategy;
  const duplicateStrategy = duplicateStrategyRaw === "update" ? "update" : "skip";

  const kind = detectFileKind(req.file!.originalname, req.file!.mimetype);
  const scope = await resolveImportScope(restaurantId);
  const report = await commitImport({
    fileName: req.file!.originalname,
    buffer: req.file!.buffer,
    kind,
    requestedMapping: mapping,
    scope,
    duplicateStrategy,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
  });
  sendSuccess(res, { report }, 201);
}

/** GET /restaurants/:restaurantId/menu/import/:importId — reuses the existing AuditLog as import
 *  history (Phase 30 audit finding: no dedicated import-log model needed, see
 *  docs/menu-import-architecture.md's "Import history" section) rather than a new collection. */
export async function getMenuImportReport(req: Request, res: Response): Promise<void> {
  const { restaurantId, importId } = req.params;
  const entry = await AuditLog.findOne({ restaurantId, targetType: "menu_import", targetId: importId, action: "menu.imported" });
  if (!entry) throw ApiError.notFound("Import not found");

  const actor = await User.findById(entry.actorUserId).select("name");
  const metadata = (entry.metadata ?? {}) as Record<string, number | string>;
  sendSuccess(res, {
    report: {
      importId: entry.targetId.toString(),
      fileName: String(metadata.fileName ?? ""),
      totalRows: Number(metadata.totalRows ?? 0),
      created: Number(metadata.created ?? 0),
      updated: Number(metadata.updated ?? 0),
      skipped: Number(metadata.skipped ?? 0),
      errors: Number(metadata.errors ?? 0),
      categoriesCreated: Number(metadata.categoriesCreated ?? 0),
      itemsCreated: Number(metadata.created ?? 0),
      modifierGroupsCreated: Number(metadata.modifierGroupsCreated ?? 0),
      modifierOptionsCreated: Number(metadata.modifierOptionsCreated ?? 0),
      createdAt: (entry.createdAt as unknown as Date).toISOString(),
      actorName: actor?.name,
    },
  });
}
