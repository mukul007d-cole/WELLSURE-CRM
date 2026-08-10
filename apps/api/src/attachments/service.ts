import { randomUUID } from 'node:crypto';

import type { AttachmentStorage } from './storage.js';
import { objectKey } from './storage.js';

export interface AttachmentRecord {
  id: string;
  leadId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedById: string;
  uploadedByName: string | null;
  uploadedAt: string;
  s3Key: string;
}

export interface AttachmentRepository {
  listForLead(organizationId: string, leadId: string): Promise<AttachmentRecord[]>;
  findById(organizationId: string, attachmentId: string): Promise<AttachmentRecord | null>;
  create(input: {
    organizationId: string;
    leadId: string;
    s3Key: string;
    fileName: string;
    mimeType: string | null;
    sizeBytes: number;
    uploadedById: string;
  }): Promise<AttachmentRecord>;
  deactivate(organizationId: string, attachmentId: string): Promise<void>;
}

/** Refused above this, before anything is buffered or stored. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export class AttachmentService {
  constructor(
    private readonly repository: AttachmentRepository,
    private readonly storage: AttachmentStorage,
  ) {}

  list(organizationId: string, leadId: string): Promise<AttachmentRecord[]> {
    return this.repository.listForLead(organizationId, leadId);
  }

  findById(organizationId: string, attachmentId: string): Promise<AttachmentRecord | null> {
    return this.repository.findById(organizationId, attachmentId);
  }

  /**
   * Store the object first, then the row.
   *
   * That order means a crash between the two leaves an orphaned object — waste,
   * but invisible. The reverse order would leave a row pointing at nothing,
   * which is a download that 500s and a document the user believes they have.
   */
  async upload(input: {
    organizationId: string;
    leadId: string;
    uploadedById: string;
    fileName: string;
    mimeType: string | null;
    body: Buffer;
  }): Promise<AttachmentRecord> {
    const attachmentId = randomUUID();
    const key = objectKey({
      organizationId: input.organizationId,
      leadId: input.leadId,
      attachmentId,
      fileName: input.fileName,
    });
    await this.storage.put({
      key,
      body: input.body,
      contentType: input.mimeType ?? undefined,
    });
    return this.repository.create({
      organizationId: input.organizationId,
      leadId: input.leadId,
      s3Key: key,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.body.byteLength,
      uploadedById: input.uploadedById,
    });
  }

  download(
    record: AttachmentRecord,
  ): Promise<{ body: NodeJS.ReadableStream; contentType?: string | undefined }> {
    return this.storage.get(record.s3Key);
  }

  /**
   * Soft-delete. The row is the record of what was here; removing the object
   * without it would leave the audit trail claiming a document that cannot be
   * accounted for.
   */
  async remove(organizationId: string, record: AttachmentRecord): Promise<void> {
    await this.repository.deactivate(organizationId, record.id);
    try {
      await this.storage.remove(record.s3Key);
    } catch {
      // The row is already inactive, so the document is gone as far as anyone
      // can see. A stranded object is a cleanup job's problem, not the
      // caller's error.
    }
  }
}
