import { Router } from "express";
import { env } from "../config/env.js";
import { LocalDiskStorageService } from "../storage/index.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Pre-launch — GET /files/<key> for the production "disk" storage driver (STORAGE_DRIVER=disk).
 * Mounted by app.ts only when that driver is active.
 *
 * Serves ONLY the public images upload.controller.ts creates —
 * `restaurants/<restaurantId>/<logo|coverImage|menuItemImage>/<uuid>.<jpg|png|webp|gif>`. Anything
 * else under the storage root (menu-import source PDFs/photos, which are read back internally and
 * never meant to be public) answers 404, as does any key that isn't exactly that shape, so path
 * tricks never reach the disk. The Content-Type comes from the extension the upload controller
 * chose, never from stored metadata, and the response can't be sniffed or run as a page.
 */
export const PUBLIC_IMAGE_KEY =
  /^restaurants\/[a-f0-9]{24}\/(logo|coverImage|menuItemImage)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/;

const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export const publicFilesRouter = Router();
// Read per request (cheap) so the directory always follows the current configuration.
const storageRoot = () => new LocalDiskStorageService({ baseDir: env.STORAGE_DISK_DIR, publicBaseUrl: "" });

publicFilesRouter.get(
  "/:key(*)",
  asyncHandler(async (req, res) => {
    const key = req.params.key;
    const match = PUBLIC_IMAGE_KEY.exec(key);
    if (!match) throw ApiError.notFound("File not found.");
    let body: Buffer;
    try {
      body = await storageRoot().download(key);
    } catch {
      throw ApiError.notFound("File not found.");
    }
    res.setHeader("Content-Type", CONTENT_TYPES[match[2]]);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    // Storefronts (order.* and restaurants' own custom domains) are other origins; helmet's default
    // same-origin policy would make browsers refuse to show these images there.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    // Every upload gets a fresh UUID key and is never overwritten, so the bytes for a URL never change.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(body);
  })
);
