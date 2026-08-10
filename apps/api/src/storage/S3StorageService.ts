import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { StorageService, UploadResult } from "./StorageService.js";

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public base URL to construct object links from (CDN domain, R2 public bucket URL, etc). */
  publicBaseUrl: string;
}

/** Works against AWS S3 or any S3-compatible provider (Cloudflare R2, MinIO, ...) via `endpoint`. */
export class S3StorageService implements StorageService {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: Boolean(config.endpoint),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async upload(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<UploadResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
    return { key, url: this.getUrl(key) };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  getUrl(key: string): string {
    return `${this.config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
  }
}
