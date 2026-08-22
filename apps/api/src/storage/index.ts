import { env } from "../config/env.js";
import { S3StorageService } from "./S3StorageService.js";
import type { StorageService } from "./StorageService.js";

export type { StorageService, UploadResult } from "./StorageService.js";

let instance: StorageService | null = null;

/** Throws only when actually used without storage configured — not at boot. */
export function getStorageService(): StorageService {
  if (instance) return instance;

  if (!env.STORAGE_BUCKET || !env.STORAGE_ACCESS_KEY || !env.STORAGE_SECRET_KEY) {
    throw new Error(
      "File storage is not configured. Set STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY " +
        "(and STORAGE_ENDPOINT for R2/S3-compatible providers) in the environment."
    );
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
