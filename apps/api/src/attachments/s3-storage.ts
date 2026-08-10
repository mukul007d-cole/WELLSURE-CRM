import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import type { AttachmentStorage, StorageConfig } from './storage.js';

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
    if (!result.Body) throw new Error('attachment object has no body');
    return {
      body: result.Body as NodeJS.ReadableStream,
      ...(result.ContentType ? { contentType: result.ContentType } : {}),
    };
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}
