/**
 * The object store, as the attachment service needs it.
 *
 * A port rather than a direct S3 dependency so the service stays testable
 * without a bucket, and so the eventual production adapter (a real bucket
 * behind IAM, versus the local MinIO one) is a swap rather than a rewrite.
 */
export interface AttachmentStorage {
  put(input: { key: string; body: Buffer; contentType: string | undefined }): Promise<void>;
  get(key: string): Promise<{ body: NodeJS.ReadableStream; contentType?: string | undefined }>;
  /** Best-effort: a failed delete must not block the soft-delete of the row. */
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
 * Where a lead's document lives.
 *
 * Organisation first so a bucket policy can be scoped by prefix later, and the
 * attachment's own id last so two uploads of the same filename never collide —
 * the table's unique constraint is on (org, s3Key, version), and colliding keys
 * would turn a second upload into a constraint violation rather than a second
 * document.
 */
export function objectKey(input: {
  organizationId: string;
  leadId: string;
  attachmentId: string;
  fileName: string;
}): string {
  return `org/${input.organizationId}/leads/${input.leadId}/${input.attachmentId}/${sanitizeFileName(input.fileName)}`;
}

/**
 * Keep the name recognisable in the object store without letting it escape the
 * prefix. The display name is stored separately in `file_name`, so this only
 * has to be safe, not faithful.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, '_')
    .trim();
  // A name that sanitizes to nothing (or to a path traversal attempt) still
  // needs a key segment.
  const safe = cleaned.replace(/^\.+/, '');
  return safe === '' ? 'document' : safe.slice(0, 120);
}
