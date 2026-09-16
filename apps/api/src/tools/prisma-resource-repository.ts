import type { StructuredDocument } from '@falcon/validation';
import type { FalconPrismaClient } from '@falcon/database';

import { ToolError } from './errors.js';
import type { ResourceCreateInput, ResourceRepository, ResourceUpdateInput } from './repository.js';
import type { Page, ResourceRow, ResourceType } from './types.js';

type Tx = FalconPrismaClient;
const orderBy = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }];
const pageArgs = (page: number, pageSize: number) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

export class PrismaResourceRepository implements ResourceRepository {
  constructor(private readonly prisma: FalconPrismaClient) {}

  async list(
    org: string,
    filter: { roleId: string | null; active: boolean | undefined },
    page: number,
    pageSize: number,
  ): Promise<Page<ResourceRow>> {
    const where = {
      organizationId: org,
      ...(filter.active === undefined ? {} : { active: filter.active }),
      ...(filter.roleId === null
        ? {}
        : { visibility: { some: { organizationId: org, roleId: filter.roleId } } }),
    };
    const [total, items] = await Promise.all([
      this.prisma.resource.count({ where }),
      this.prisma.resource.findMany({ where, ...pageArgs(page, pageSize), orderBy }),
    ]);
    return { page, pageSize, total, items: items.map(toRow) };
  }

  async findById(org: string, id: string): Promise<ResourceRow | null> {
    const row = await this.prisma.resource.findFirst({ where: { organizationId: org, id } });
    return row === null ? null : toRow(row);
  }

  async create(input: ResourceCreateInput): Promise<ResourceRow> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.resource.create({
        data: {
          ...(input.id ? { id: input.id } : {}),
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          category: input.category,
          type: input.type,
          url: input.url,
          s3Key: input.s3Key,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes === null ? null : BigInt(input.sizeBytes),
          instructions: input.instructions as never,
          sortOrder: input.sortOrder,
          ...(input.version === undefined ? {} : { version: input.version }),
          createdById: input.createdById,
          updatedById: input.updatedById,
        },
      });
      await audit(
        tx as Tx,
        input.organizationId,
        input.createdById,
        'resource',
        row.id,
        'create',
        null,
        toRow(row),
      );
      return toRow(row);
    });
  }

  async update(org: string, id: string, input: ResourceUpdateInput): Promise<ResourceRow | null> {
    return this.prisma.$transaction(async (tx) => {
      const old = await lockResource(tx as Tx, org, id);
      if (old === null) return null;
      const row = await tx.resource.update({
        where: { organizationId_id: { organizationId: org, id } },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.category === undefined ? {} : { category: input.category }),
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.url === undefined ? {} : { url: input.url }),
          ...(input.s3Key === undefined ? {} : { s3Key: input.s3Key }),
          ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
          ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
          ...(input.sizeBytes === undefined
            ? {}
            : { sizeBytes: input.sizeBytes === null ? null : BigInt(input.sizeBytes) }),
          ...(input.instructions === undefined
            ? {}
            : { instructions: input.instructions as never }),
          ...(input.version === undefined ? {} : { version: input.version }),
          updatedById: input.updatedById,
        },
      });
      await audit(tx as Tx, org, input.updatedById, 'resource', id, 'edit', toRow(old), toRow(row));
      return toRow(row);
    });
  }

  async deactivate(org: string, id: string, actorUserId: string): Promise<ResourceRow | null> {
    return this.prisma.$transaction(async (tx) => {
      const old = await lockResource(tx as Tx, org, id);
      if (old === null) return null;
      if (!old.active) return toRow(old);
      const row = await tx.resource.update({
        where: { organizationId_id: { organizationId: org, id } },
        data: { active: false, updatedById: actorUserId },
      });
      await audit(tx as Tx, org, actorUserId, 'resource', id, 'deactivate', toRow(old), toRow(row));
      return toRow(row);
    });
  }

  async countRolesInOrg(org: string, roleIds: readonly string[]): Promise<number> {
    if (roleIds.length === 0) return 0;
    return this.prisma.role.count({ where: { organizationId: org, id: { in: [...roleIds] } } });
  }

  async listVisibility(org: string, resourceId: string): Promise<string[] | null> {
    const resource = await this.prisma.resource.findFirst({
      where: { organizationId: org, id: resourceId },
      select: { id: true },
    });
    if (resource === null) return null;
    const rows = await this.prisma.resourceVisibility.findMany({
      where: { organizationId: org, resourceId },
      select: { roleId: true },
      orderBy: { roleId: 'asc' },
    });
    return rows.map((row) => row.roleId);
  }

  /**
   * Full replace of one Resource's role-id set, structurally identical to
   * `PrismaAdminRepository.replaceRoleVisibilityForField`: the affected role
   * set (payload roleIds ∪ existing rows' roleIds) is locked in sorted id
   * order so two concurrent replaces touching an overlapping role set queue
   * instead of deadlocking, and every affected Role's version is bumped —
   * Roles gaining *and* losing the grant alike.
   */
  async replaceVisibility(
    org: string,
    actorUserId: string,
    resourceId: string,
    roleIds: readonly string[],
  ): Promise<string[] | null> {
    return this.prisma.$transaction(async (tx) => {
      const resource = await lockResource(tx as Tx, org, resourceId);
      if (resource === null) return null;
      const old = await tx.resourceVisibility.findMany({
        where: { organizationId: org, resourceId },
        select: { roleId: true },
        orderBy: { roleId: 'asc' },
      });
      const oldRoleIds = old.map((row) => row.roleId);
      const affectedRoleIds = [...new Set([...roleIds, ...oldRoleIds])].sort();
      for (const roleId of affectedRoleIds) await lockRole(tx as Tx, org, roleId);
      await tx.resourceVisibility.deleteMany({ where: { organizationId: org, resourceId } });
      if (roleIds.length)
        await tx.resourceVisibility.createMany({
          data: roleIds.map((roleId) => ({ organizationId: org, resourceId, roleId })),
        });
      for (const roleId of affectedRoleIds) await bumpRole(tx as Tx, org, roleId, actorUserId);
      await audit(
        tx as Tx,
        org,
        actorUserId,
        'resource_visibility',
        resourceId,
        'replace',
        oldRoleIds,
        [...roleIds],
      );
      return [...roleIds].sort();
    });
  }
}

interface PrismaResourceRow {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  category: string | null;
  type: string;
  url: string | null;
  s3Key: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: bigint | null;
  instructions: unknown;
  sortOrder: number;
  active: boolean;
  version: number;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRow(row: PrismaResourceRow): ResourceRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    category: row.category,
    type: row.type as ResourceType,
    url: row.url,
    s3Key: row.s3Key,
    fileName: row.fileName,
    mimeType: row.mimeType,
    // BigInt doesn't survive JSON.stringify, so narrow it at the boundary.
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    instructions: row.instructions as StructuredDocument | null,
    sortOrder: row.sortOrder,
    active: row.active,
    version: row.version,
    createdById: row.createdById,
    updatedById: row.updatedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function audit(
  tx: Tx,
  organizationId: string,
  actorUserId: string | null,
  entityType: string,
  entityId: string,
  action: string,
  oldValue: unknown,
  newValue: unknown,
) {
  await tx.systemAuditLog.create({
    data: {
      organizationId,
      actorUserId,
      entityType,
      entityId,
      action,
      oldValue: oldValue as never,
      newValue: newValue as never,
    },
  });
}
async function lockResource(tx: Tx, org: string, id: string): Promise<PrismaResourceRow | null> {
  await tx.$queryRawUnsafe(
    'SELECT id FROM resources WHERE organization_id = $1::uuid AND id = $2::uuid FOR UPDATE',
    org,
    id,
  );
  return tx.resource.findFirst({ where: { organizationId: org, id } });
}
async function lockRole(tx: Tx, org: string, id: string): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT id FROM roles WHERE organization_id = $1::uuid AND id = $2::uuid FOR UPDATE',
    org,
    id,
  );
  const row = await tx.role.findFirst({ where: { organizationId: org, id } });
  if (!row)
    throw new ToolError('validation_error', 'one or more roles are outside the organization');
}
async function bumpRole(tx: Tx, org: string, id: string, actor: string): Promise<void> {
  await tx.role.update({
    where: { organizationId_id: { organizationId: org, id } },
    data: { version: { increment: 1 }, updatedById: actor },
  });
}
