import { resolve } from "node:path";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";
import { S3StorageService } from "./S3StorageService.js";
import { LocalDiskStorageService } from "./LocalDiskStorageService.js";
import type { StorageService } from "./StorageService.js";

export type { StorageService, UploadResult } from "./StorageService.js";
export { LocalDiskStorageService } from "./LocalDiskStorageService.js";

let instance: StorageService | null = null;

/** Whether getStorageService() will (or already did) fall back to local-disk storage — the same
 *  condition it applies internally, but exposed statically so app.ts can decide whether to mount
 *  local-storage.routes.ts at boot, before any request has actually called getStorageService().
 *  Never true in production. */
export function isLocalDiskStorageActive(): boolean {
  return env.NODE_ENV !== "production" && (!env.STORAGE_BUCKET || !env.STORAGE_ACCESS_KEY || !env.STORAGE_SECRET_KEY);
}

/** The directory local-disk storage reads/writes under when active. */
export function getLocalDiskStorageRoot(): string {
  return resolve(process.cwd(), ".local-storage");
}

/** Throws only when actually used without storage configured — not at boot. Falls back to real
 *  (not mocked) local-disk storage outside production when no S3/R2 credentials are set, so
 *  file-upload features are genuinely testable without a cloud storage account; production always
 *  requires real credentials and never falls back. */
export function getStorageService(): StorageService {
  if (instance) return instance;

  if (!env.STORAGE_BUCKET || !env.STORAGE_ACCESS_KEY || !env.STORAGE_SECRET_KEY) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "File storage is not configured. Set STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY " +
          "(and STORAGE_ENDPOINT for R2/S3-compatible providers) in the environment."
      );
    }
    logger.warn(
      "[storage] No S3/R2 credentials configured — falling back to local-disk storage for development. " +
        "Never used in production (NODE_ENV=production always requires real credentials)."
    );
    instance = new LocalDiskStorageService({
      baseDir: getLocalDiskStorageRoot(),
      publicBaseUrl: `http://localhost:${env.PORT}/local-storage`,
    });
    return instance;
  }

  instance = new S3StorageService({
    bucket: env.STORAGE_BUCKET,
    region: env.STORAGE_REGION ?? "auto",
    endpoint: env.STORAGE_ENDPOINT,
    accessKeyId: env.STORAGE_ACCESS_KEY,
    secretAccessKey: env.STORAGE_SECRET_KEY,
    publicBaseUrl: env.STORAGE_PUBLIC_URL ?? env.STORAGE_ENDPOINT ?? "",
  });
  return instance;
}

/** Test-only injection point — mirrors resetGeocodingServiceForTests/resetEmailServiceForTests.
 *  Lets upload.controller.test.ts exercise a real successful-upload path against an in-memory
 *  fake, without needing real S3-compatible credentials in the test environment. Pass undefined
 *  to clear back to the real factory. */
export function setStorageServiceForTests(service: StorageService | undefined): void {
  instance = service ?? null;
}
