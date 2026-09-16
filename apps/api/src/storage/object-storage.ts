import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * The object store, as a caller needs it.
 *
 * A port rather than a direct S3 dependency so a consumer stays testable
 * without a bucket, and so the production adapter (a real bucket behind IAM,
 * versus the local MinIO one) is a swap rather than a rewrite.
 *
 * Originally built for the Attachments (document locker) feature — see
 * ADR-0012 — and relocated here, unchanged, once the Tools resource library
 * became a second, unrelated consumer of the same S3-compatible storage and
 * the same `S3_*` configuration contract. Each caller keeps its own object-key
 * scheme and its own metadata table; only the port and its S3 implementation
 * are shared.
 */
export interface AttachmentStorage {
  put(input: { key: string; body: Buffer; contentType: string | undefined }): Promise<void>;
  get(key: string): Promise<{ body: NodeJS.ReadableStream; contentType?: string | undefined }>;
  /** Best-effort: a failed delete must not block the soft-delete of the row it belongs to. */
  remove(key: string): Promise<void>;
}

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

/**
 * S3-compatible object storage.
 *
 * `forcePathStyle` is required for MinIO, which serves buckets as a path
 * segment rather than a host prefix; it is harmless against real S3.
 */
export class S3AttachmentStorage implements AttachmentStorage {
  private readonly client: S3Client;

  constructor(private readonly config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    });
  }

  async put(input: { key: string; body: Buffer; contentType: string | undefined }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        Body: input.body,
        ...(input.contentType ? { ContentType: input.contentType } : {}),
      }),
    );
  }

  async get(
    key: string,
  ): Promise<{ body: NodeJS.ReadableStream; contentType?: string | undefined }> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!result.Body) throw new Error('stored object has no body');
    return {
      body: result.Body as NodeJS.ReadableStream,
      ...(result.ContentType ? { contentType: result.ContentType } : {}),
    };
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}
