import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";
import type { StorageService, UploadResult } from "./StorageService.js";

export interface LocalDiskStorageConfig {
  /** Absolute path to the directory files are written under. Created on first use. */
  baseDir: string;
  /** Base URL local-storage.routes.ts serves files back from (e.g. http://localhost:4000/local-storage). */
  publicBaseUrl: string;
}

/** Dev-only fallback storage adapter — real disk I/O, not a mock. Activates only when no S3/R2
 *  credentials are configured AND NODE_ENV !== "production" (see storage/index.ts's factory);
 *  production always requires real S3-compatible storage and never falls back to this. Exists so
 *  file-upload-dependent features (menu item photos, the Phase 81 PDF/image menu importer) are
 *  genuinely exercisable — uploaded, stored, read back, served — on a laptop with no cloud storage
 *  account, rather than only type-checked. Same provider-abstraction pattern already established
 *  for payments/marketplace/menu-extraction: one interface, a real "local" implementation alongside
 *  the real "cloud" one. */
export class LocalDiskStorageService implements StorageService {
  constructor(private readonly config: LocalDiskStorageConfig) {}

  /** Rejects any key that would escape baseDir via ../ segments — keys are built internally from
   *  restaurant/job/user IDs (never raw user input), but this is a one-line guard against that
   *  ever changing silently. */
  private resolvePath(key: string): string {
    const full = normalize(join(this.config.baseDir, key));
    if (relative(this.config.baseDir, full).startsWith("..")) {
      throw new Error(`Refusing to write storage key outside the local storage root: "${key}"`);
    }
    return full;
  }

  async upload(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<UploadResult> {
    const filePath = this.resolvePath(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    await writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType: contentType ?? "application/octet-stream" }));
    return { key, url: this.getUrl(key) };
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    await rm(filePath, { force: true });
    await rm(`${filePath}.meta.json`, { force: true });
  }

  async download(key: string): Promise<Buffer> {
    return readFile(this.resolvePath(key));
  }

  /** Reads back the content-type sidecar written at upload time — used by local-storage.routes.ts
   *  when serving a file, mirroring what S3 would return as the object's own Content-Type. */
  async readContentType(key: string): Promise<string> {
    try {
      const meta = await readFile(`${this.resolvePath(key)}.meta.json`, "utf-8");
      return (JSON.parse(meta).contentType as string) ?? "application/octet-stream";
    } catch {
      return "application/octet-stream";
    }
  }

  getUrl(key: string): string {
    return `${this.config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
  }
}
