export interface UploadResult {
  key: string;
  url: string;
}

/** Provider-agnostic file storage. Concrete adapters (S3, R2, local disk, ...) implement this. */
export interface StorageService {
  upload(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<UploadResult>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
  /** Phase 81 — reads an object's bytes back. Added for the async menu-import pipeline: unlike
   *  the CSV/XLSX importer (parsed in-memory, never persisted — see commitImport.ts), an async
   *  PDF/image import job's source file must survive past the request that uploaded it, so the
   *  worker that later processes it needs to read it back rather than assume it's still in memory. */
  download(key: string): Promise<Buffer>;
}
