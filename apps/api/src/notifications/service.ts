import type { FalconPrismaClient } from '@falcon/database';

export const notificationTriggers = [
  'field_edited',
  'status_changed',
  'lead_reassigned',
  'shared_lead_modified_by_non_owner',
  'lead_deactivated',
] as const;
export const recipientResolvers = [
  'assignment_holder',
  'assignment_holder_manager',
  'previous_assignment_holder',
  'share_creator',
  'active_shared_users_except_actor',
  'feature_permission_holders',
] as const;

export class NotificationService {
  constructor(private readonly prisma: FalconPrismaClient) {}

  async list(organizationId: string, userId: string, page = 1, pageSize = 25) {
    const where = { organizationId, userId };
    const [total, items] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(1, page) - 1) * Math.min(100, pageSize),
        take: Math.min(100, pageSize),
      }),
    ]);
    return { total, items };
  }
  countUnread(organizationId: string, userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { organizationId, userId, read: false } });
  }
  async isActiveShareActor(
    organizationId: string,
    leadId: string,
    userId: string,
  ): Promise<boolean> {
    return Boolean(
      await this.prisma.userAccessGrant.findFirst({
        where: {
          organizationId,
          leadId,
          userId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      }),
    );
  }
  async markRead(organizationId: string, userId: string, id: string) {
    const row = await this.prisma.notification.findFirst({ where: { organizationId, userId, id } });
    if (!row) return null;
    const readAt = row.readAt ?? new Date();
    return this.prisma.notification.update({
      where: { organizationId_id: { organizationId, id } },
      data: { read: true, readAt },
    });
  }

  async listRules(organizationId: string, page = 1, pageSize = 25) {
    const where = { organizationId };
    const [total, items] = await Promise.all([
      this.prisma.notificationRule.count({ where }),
      this.prisma.notificationRule.findMany({
        where,
        include: { recipients: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'asc' },
        skip: (Math.max(1, page) - 1) * Math.min(100, pageSize),
        take: Math.min(100, pageSize),
      }),
    ]);
    return { total, items };
  }
  async createRule(input: {
    organizationId: string;
    actorUserId: string;
    key: string;
    name: string;
    triggerType: string;
    scope?: unknown;
    recipients: Array<{ resolverType: string; parameters?: unknown }>;
  }) {
    validateRule(input);
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.notificationRule.create({
        data: {
          organizationId: input.organizationId,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
          key: input.key,
          name: input.name.trim(),
          triggerType: input.triggerType,
          scope: input.scope as never,
          recipients: {
            create: input.recipients.map((r, i) => ({
              resolverType: r.resolverType,
              parameters: (r.parameters ?? {}) as never,
              sortOrder: i,
            })),
          },
        },
        include: { recipients: true },
      });
      await tx.systemAuditLog.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          entityType: 'notification_rule',
          entityId: rule.id,
          action: 'create',
          newValue: rule as never,
        },
      });
      return rule;
    });
  }
  async updateRule(input: {
    organizationId: string;
    actorUserId: string;
    id: string;
    name: string;
    triggerType: string;
    scope?: unknown;
    active: boolean;
    recipients: Array<{ resolverType: string; parameters?: unknown }>;
  }) {
    validateRule({ ...input, key: 'existing' });
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.notificationRule.findFirst({
        where: { organizationId: input.organizationId, id: input.id },
        include: { recipients: true },
      });
      if (!old) return null;
      await tx.notificationRuleRecipient.deleteMany({
        where: { organizationId: input.organizationId, ruleId: input.id },
      });
      const rule = await tx.notificationRule.update({
        where: { organizationId_id: { organizationId: input.organizationId, id: input.id } },
        data: {
          name: input.name.trim(),
          triggerType: input.triggerType,
          scope: input.scope as never,
          active: input.active,
          version: { increment: 1 },
          updatedById: input.actorUserId,
          recipients: {
            create: input.recipients.map((r, i) => ({
              resolverType: r.resolverType,
              parameters: (r.parameters ?? {}) as never,
              sortOrder: i,
            })),
          },
        },
        include: { recipients: true },
      });
      await tx.systemAuditLog.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          entityType: 'notification_rule',
          entityId: rule.id,
          action: input.active ? 'edit' : 'deactivate',
          oldValue: old as never,
          newValue: rule as never,
        },
      });
      return rule;
    });
  }

  async evaluate(input: {
    organizationId: string;
    activityLogId: string;
    leadId: string;
    processInstanceId?: string | null;
    actorUserId: string;
    triggerType: string;
    oldValue?: unknown;
  }) {
    const rules = await this.prisma.notificationRule.findMany({
      where: { organizationId: input.organizationId, active: true, triggerType: input.triggerType },
      include: { recipients: { orderBy: { sortOrder: 'asc' } } },
    });
    for (const rule of rules) {
      const users = new Set<string>();
      for (const resolver of rule.recipients)
        for (const id of await this.resolve(input, resolver.resolverType, resolver.parameters))
          users.add(id);
      for (const userId of users)
        await this.prisma.notification.upsert({
          where: {
            organizationId_notificationRuleId_activityLogId_userId: {
              organizationId: input.organizationId,
              notificationRuleId: rule.id,
              activityLogId: input.activityLogId,
              userId,
            },
          },
          update: {},
          create: {
            organizationId: input.organizationId,
            userId,
            type: input.triggerType,
            referenceLeadId: input.leadId,
            message: rule.name,
            notificationRuleId: rule.id,
            activityLogId: input.activityLogId,
          },
        });
    }
  }

  private async resolve(
    input: {
      organizationId: string;
      leadId: string;
      processInstanceId?: string | null;
      actorUserId: string;
      oldValue?: unknown;
    },
    type: string,
    raw: unknown,
  ): Promise<string[]> {
    const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (type === 'previous_assignment_holder') {
      const id = (input.oldValue as Record<string, unknown> | undefined)?.userId;
      return typeof id === 'string' ? [id] : [];
    }
    if (type === 'share_creator' && typeof p.userId === 'string') {
      const row = await this.prisma.userAccessGrant.findFirst({
        where: {
          organizationId: input.organizationId,
          leadId: input.leadId,
          userId: p.userId,
          revokedAt: null,
        },
      });
      return row ? [row.grantedByUserId] : [];
    }
    if (type === 'active_shared_users_except_actor') {
      const rows = await this.prisma.userAccessGrant.findMany({
        where: {
          organizationId: input.organizationId,
          leadId: input.leadId,
          revokedAt: null,
          userId: { not: input.actorUserId },
          user: { active: true },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      return rows.map((r) => r.userId);
    }
    if (
      type === 'feature_permission_holders' &&
      typeof p.module === 'string' &&
      typeof p.action === 'string'
    ) {
      const rows = await this.prisma.user.findMany({
        where: {
          organizationId: input.organizationId,
          active: true,
          role: { active: true, permissions: { some: { module: p.module, action: p.action } } },
        },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }
    if (
      (type === 'assignment_holder' || type === 'assignment_holder_manager') &&
      typeof p.assignmentType === 'string' &&
      input.processInstanceId
    ) {
      const row = await this.prisma.assignment.findFirst({
        where: {
          organizationId: input.organizationId,
          processInstanceId: input.processInstanceId,
          assignmentType: p.assignmentType,
          isCurrent: true,
        },
        include: { user: { select: { id: true, managerId: true } } },
      });
      if (!row) return [];
      return type === 'assignment_holder'
        ? [row.user.id]
        : row.user.managerId
          ? [row.user.managerId]
          : [];
    }
    return [];
  }
}

function validateRule(input: {
  key: string;
  name: string;
  triggerType: string;
  scope?: unknown;
  recipients: Array<{ resolverType: string }>;
}) {
  if (
    !/^[a-z][a-z0-9_]{1,62}$/.test(input.key) ||
    !input.name.trim() ||
    !notificationTriggers.includes(input.triggerType as never) ||
    !input.recipients.length ||
    input.recipients.some((r) => !recipientResolvers.includes(r.resolverType as never))
  )
    throw new Error('validation_error');
  if (input.scope !== undefined && input.triggerType !== 'field_edited')
    throw new Error('validation_error');
}
