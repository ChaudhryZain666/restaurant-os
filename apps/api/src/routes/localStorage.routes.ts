import { Router } from "express";
import { LocalDiskStorageService, getLocalDiskStorageRoot } from "../storage/index.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

/** Dev-only file server for LocalDiskStorageService — the counterpart to a real S3/R2 bucket's
 *  public URL. Mounted by app.ts only when isLocalDiskStorageActive() is true at boot (never in
 *  production, since production always requires real S3-compatible credentials — see
 *  storage/index.ts). Publicly reachable by design, same as a real object-storage bucket's public
 *  URL would be: storage keys are unguessable IDs, never used to gate authorization on their own,
 *  matching how the real S3StorageService's getUrl() already behaves.
 */
export const localStorageRouter = Router();

const storage = new LocalDiskStorageService({ baseDir: getLocalDiskStorageRoot(), publicBaseUrl: "" });

localStorageRouter.get(
  "/:key(*)",
  asyncHandler(async (req, res) => {
    const key = req.params.key;
    let body: Buffer;
    try {
      body = await storage.download(key);
    } catch {
      throw ApiError.notFound("File not found.");
    }
    const contentType = await storage.readContentType(key);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(body);
  })
);
