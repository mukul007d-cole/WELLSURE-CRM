import type { FalconPrismaClient } from '@falcon/database';

import type { ExportAuditWriter, ExportFieldRepository } from '../routes/export.js';
import type { ExportFieldColumn } from './service.js';

export class PrismaExportRepository implements ExportFieldRepository, ExportAuditWriter {
  constructor(private readonly prisma: FalconPrismaClient) {}

  /**
   * Every active Field, offered to the permission engine as the requested set.
   *
   * The engine then strips the ones this caller cannot see, so the CSV header
   * is decided by `field_visibility` rather than by whatever the client asked
   * for. Ordered by name so two exports of the same data have the same columns
   * in the same order.
   */
  async listActiveFields(organizationId: string): Promise<ExportFieldColumn[]> {
    return this.prisma.field.findMany({
      where: { organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * The export's audit row.
   *
   * `docs/permissions/access-model.md` requires every export to write one.
   * `system_audit_logs.entity_id` is a non-null uuid and an export has no
   * entity, so the run's own generated id stands in — which is also what the
   * response header reports, so a row in the log can be tied to a download.
   */
  async writeExportAudit(input: {
    organizationId: string;
    actorUserId: string;
    runId: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.systemAuditLog.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        entityType: 'lead_export',
        entityId: input.runId,
        action: 'export',
        newValue: input.detail as never,
      },
    });
  }
}
