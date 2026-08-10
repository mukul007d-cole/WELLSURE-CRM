import type { AttachmentRecord, AttachmentRepository } from './service.js';

interface AttachmentRow {
  id: string;
  leadId: string;
  s3Key: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: bigint | null;
  uploadedById: string;
  uploadedAt: Date;
  uploadedBy?: { id: string; name: string } | null;
}

export interface PrismaAttachmentClient {
  attachment: {
    findMany(args: unknown): Promise<AttachmentRow[]>;
    findFirst(args: unknown): Promise<AttachmentRow | null>;
    create(args: unknown): Promise<AttachmentRow>;
    update(args: unknown): Promise<unknown>;
  };
}

export class PrismaAttachmentRepository implements AttachmentRepository {
  constructor(private readonly prisma: PrismaAttachmentClient) {}

  async listForLead(organizationId: string, leadId: string): Promise<AttachmentRecord[]> {
    const rows = await this.prisma.attachment.findMany({
      where: { organizationId, leadId, active: true },
      include: { uploadedBy: { select: { id: true, name: true } } },
      // Matches attachments_lead_recent_idx.
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toRecord);
  }

  async findById(organizationId: string, attachmentId: string): Promise<AttachmentRecord | null> {
    const row = await this.prisma.attachment.findFirst({
      where: { organizationId, id: attachmentId, active: true },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
    return row === null ? null : toRecord(row);
  }

  async create(input: {
    organizationId: string;
    leadId: string;
    s3Key: string;
    fileName: string;
    mimeType: string | null;
    sizeBytes: number;
    uploadedById: string;
  }): Promise<AttachmentRecord> {
    const row = await this.prisma.attachment.create({
      data: {
        organizationId: input.organizationId,
        leadId: input.leadId,
        s3Key: input.s3Key,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        uploadedById: input.uploadedById,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
    return toRecord(row);
  }

  async deactivate(organizationId: string, attachmentId: string): Promise<void> {
    await this.prisma.attachment.update({
      where: { organizationId_id: { organizationId, id: attachmentId } },
      data: { active: false },
    });
  }
}

function toRecord(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    leadId: row.leadId,
    // Rows predating the metadata migration have no name; the key's last
    // segment is the closest thing to one.
    fileName: row.fileName ?? row.s3Key.split('/').pop() ?? 'document',
    mimeType: row.mimeType,
    // BigInt doesn't survive JSON.stringify, so narrow it at the boundary.
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    uploadedById: row.uploadedById,
    uploadedByName: row.uploadedBy?.name ?? null,
    uploadedAt: row.uploadedAt.toISOString(),
    s3Key: row.s3Key,
  };
}
