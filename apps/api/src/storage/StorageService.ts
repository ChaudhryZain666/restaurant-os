export interface UploadResult {
  key: string;
  url: string;
}

/** Provider-agnostic file storage. Concrete adapters (S3, R2, local disk, ...) implement this. */
export interface StorageService {
  upload(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<UploadResult>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
}
