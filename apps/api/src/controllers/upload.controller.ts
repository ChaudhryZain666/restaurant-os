import { randomUUID } from "node:crypto";
import multer from "multer";
import type { Request, Response } from "express";
import { roleHasPermission, type Permission } from "@restaurant/types";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { getStorageService } from "../storage/index.js";

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const UNSUPPORTED_FILE_TYPE = "UNSUPPORTED_FILE_TYPE";

const UPLOAD_PURPOSES = ["logo", "coverImage", "menuItemImage"] as const;
type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

// Branding (logo/cover) is an owner-only setting (matches restaurant.controller.ts's
// updateRestaurant gate); a menu item's photo follows the same permission menu writes already
// require (owner or manager) — see rbac.ts. Checked here, not via requirePermission() at the
// router level, because which permission applies depends on the multipart body's `purpose`
// field, which isn't available until multer has already parsed the request.
const PURPOSE_PERMISSIONS: Record<UploadPurpose, Permission> = {
  logo: "restaurant.settings.manage",
  coverImage: "restaurant.settings.manage",
  menuItemImage: "restaurant.menu.write",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!(file.mimetype in ALLOWED_MIME_TYPES)) {
      cb(new Error(UNSUPPORTED_FILE_TYPE));
      return;
    }
    cb(null, true);
  },
}).single("file");

function isUploadPurpose(value: unknown): value is UploadPurpose {
  return typeof value === "string" && (UPLOAD_PURPOSES as readonly string[]).includes(value);
}

/**
 * POST /restaurants/:restaurantId/uploads — multipart form with a `file` and a `purpose` field.
 * Connects the storage abstraction that already existed (storage/StorageService.ts,
 * S3StorageService.ts) but had no route calling it. Only ever returns a URL — it does NOT itself
 * write that URL onto the Restaurant or MenuItem document; the caller still saves it through the
 * existing PATCH endpoints (updateRestaurant / updateMenuItem), exactly as if they'd pasted a URL
 * in by hand. That keeps this endpoint from becoming a second, divergent write-path for fields
 * those endpoints already own.
 */
export async function uploadRestaurantImage(req: Request, res: Response) {
  try {
    await new Promise<void>((resolve, reject) => {
      upload(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      throw ApiError.badRequest(`File too large — the maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`);
    }
    if (err instanceof Error && err.message === UNSUPPORTED_FILE_TYPE) {
      throw ApiError.badRequest("Unsupported file type — upload a JPEG, PNG, WebP, or GIF image");
    }
    throw err;
  }

  const purpose = req.body?.purpose;
  if (!isUploadPurpose(purpose)) {
    throw ApiError.badRequest(`purpose must be one of: ${UPLOAD_PURPOSES.join(", ")}`);
  }
  if (!roleHasPermission(req.user!.role, PURPOSE_PERMISSIONS[purpose])) {
    throw ApiError.forbidden();
  }
  if (!req.file) throw ApiError.badRequest("No file was uploaded");

  const { restaurantId } = req.params;
  const ext = ALLOWED_MIME_TYPES[req.file.mimetype];
  // restaurantId is baked into the storage key itself — even though requireTenantMatch() already
  // guarantees the caller belongs to this restaurant, this also keeps one tenant's uploaded
  // objects from ever colliding with another's at the storage layer.
  const key = `restaurants/${restaurantId}/${purpose}/${randomUUID()}.${ext}`;
  const result = await getStorageService().upload(key, req.file.buffer, req.file.mimetype);

  sendSuccess(res, { url: result.url }, 201);
}
