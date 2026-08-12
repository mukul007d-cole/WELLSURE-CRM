import type { FalconPrismaClient } from '@falcon/database';
import { NotificationService } from '../notifications/service.js';
import { CampaignTriggerService } from '../campaigns/trigger-service.js';
import { TriggerDispatcher } from './trigger-dispatch.js';

export const shareCapabilities = ['view', 'edit', 'comment'] as const;
export type ShareCapability = (typeof shareCapabilities)[number];

export interface LeadShare {
  id: string;
  userId: string;
  userName: string;
  grantedByUserId: string;
  capabilities: readonly ShareCapability[];
  createdAt: Date;
}

export class LeadSharingService {
  constructor(
    private readonly prisma: FalconPrismaClient,
    private readonly notifications?: NotificationService,
  ) {}

  list(organizationId: string, leadId: string): Promise<LeadShare[]> {
    return this.prisma.userAccessGrant
      .findMany({
        where: {
          organizationId,
          leadId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          userId: row.userId,
          userName: row.user.name,
          grantedByUserId: row.grantedByUserId,
          capabilities: row.actions as ShareCapability[],
          createdAt: row.createdAt,
        })),
      );
  }

  async create(input: {
    organizationId: string;
    leadId: string;
    userId: string;
    actorUserId: string;
    capabilities: readonly string[];
  }) {
    const capabilities = validateCapabilities(input.capabilities);
    if (input.userId === input.actorUserId) throw new Error('self_share');
    return this.prisma.$transaction(async (tx) => {
      const [lead, user, existing] = await Promise.all([
        tx.lead.findFirst({
          where: { organizationId: input.organizationId, id: input.leadId, active: true },
        }),
        tx.user.findFirst({
          where: { organizationId: input.organizationId, id: input.userId, active: true },
        }),
        tx.userAccessGrant.findFirst({
          where: {
            organizationId: input.organizationId,
            leadId: input.leadId,
            userId: input.userId,
            revokedAt: null,
          },
        }),
      ]);
      if (!lead || !user) throw new Error('not_found');
      if (existing) throw new Error('already_shared');
      const share = await tx.userAccessGrant.create({
        data: {
          organizationId: input.organizationId,
          leadId: input.leadId,
          userId: input.userId,
          grantedByUserId: input.actorUserId,
          actions: capabilities,
        },
      });
      await tx.activityLog.create({
        data: {
          organizationId: input.organizationId,
          leadId: input.leadId,
          actorUserId: input.actorUserId,
          actionType: 'share_changed',
          source: 'lead_api',
          newValue: { shareId: share.id, userId: input.userId, capabilities },
        },
      });
      return share;
    });
  }

  async update(input: {
    organizationId: string;
    leadId: string;
    shareId: string;
    actorUserId: string;
    capabilities: readonly string[];
  }) {
    const capabilities = validateCapabilities(input.capabilities);
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.userAccessGrant.findFirst({
        where: {
          organizationId: input.organizationId,
          leadId: input.leadId,
          id: input.shareId,
          revokedAt: null,
        },
      });
      if (!old) throw new Error('not_found');
      const share = await tx.userAccessGrant.update({
        where: { organizationId_id: { organizationId: input.organizationId, id: input.shareId } },
        data: { actions: capabilities },
      });
      await tx.activityLog.create({
        data: {
          organizationId: input.organizationId,
          leadId: input.leadId,
          actorUserId: input.actorUserId,
          actionType: 'share_changed',
          source: 'lead_api',
          oldValue: { shareId: old.id, userId: old.userId, capabilities: old.actions },
          newValue: { shareId: old.id, userId: old.userId, capabilities },
        },
      });
      return share;
    });
  }

  async revoke(input: {
    organizationId: string;
    leadId: string;
    shareId: string;
    actorUserId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.userAccessGrant.findFirst({
        where: {
          organizationId: input.organizationId,
          leadId: input.leadId,
          id: input.shareId,
          revokedAt: null,
        },
      });
      if (!old) throw new Error('not_found');
      const revokedAt = new Date();
      await tx.userAccessGrant.update({
        where: { organizationId_id: { organizationId: input.organizationId, id: input.shareId } },
        data: { revokedAt },
      });
      await tx.activityLog.create({
        data: {
          organizationId: input.organizationId,
          leadId: input.leadId,
          actorUserId: input.actorUserId,
          actionType: 'share_changed',
          source: 'lead_api',
          oldValue: { shareId: old.id, userId: old.userId, capabilities: old.actions },
          newValue: { revokedAt: revokedAt.toISOString() },
        },
      });
    });
  }

  async comment(input: {
    organizationId: string;
    leadId: string;
    processInstanceId?: string;
    actorUserId: string;
    text: string;
  }) {
    if (!input.text.trim()) throw new Error('validation_error');
    return this.prisma.activityLog.create({
      data: {
        organizationId: input.organizationId,
        leadId: input.leadId,
        ...(input.processInstanceId === undefined
          ? {}
          : { processInstanceId: input.processInstanceId }),
        actorUserId: input.actorUserId,
        actionType: 'comment',
        source: 'lead_api',
        commentText: input.text.trim(),
      },
    });
  }

  async reassign(input: {
    organizationId: string;
    leadId: string;
    processInstanceId: string;
    assignmentType: string;
    userId: string;
    actorUserId: string;
  }) {
    if (!input.assignmentType.trim()) throw new Error('validation_error');
    return this.prisma.$transaction(async (tx) => {
      const [old, user] = await Promise.all([
        tx.assignment.findFirst({
          where: {
            organizationId: input.organizationId,
            processInstanceId: input.processInstanceId,
            assignmentType: input.assignmentType,
            isCurrent: true,
          },
        }),
        tx.user.findFirst({
          where: { organizationId: input.organizationId, id: input.userId, active: true },
        }),
      ]);
      if (!old || !user) throw new Error('not_found');
      await tx.assignment.update({
        where: { organizationId_id: { organizationId: input.organizationId, id: old.id } },
        data: { isCurrent: false },
      });
      const assignment = await tx.assignment.create({
        data: {
          organizationId: input.organizationId,
          processInstanceId: input.processInstanceId,
          assignmentType: input.assignmentType,
          userId: input.userId,
        },
      });
      const activity = await tx.activityLog.create({
        data: {
          organizationId: input.organizationId,
          leadId: input.leadId,
          processInstanceId: input.processInstanceId,
          actorUserId: input.actorUserId,
          actionType: 'reassignment',
          source: 'lead_api',
          oldValue: { assignmentType: input.assignmentType, userId: old.userId },
          newValue: { assignmentType: input.assignmentType, userId: input.userId },
        },
      });
      /*
       * Through the shared dispatcher, not straight at one consumer.
       *
       * This path used to call `NotificationService` directly, which meant a
       * manual reassignment reached Notification Rules and never reached
       * campaign triggers — invisible only because campaigns ignore everything
       * but `status_changed`. Phase 14b needed a third consumer, so the list
       * moved to one place and this writer joined it. Routing is deliberately
       * absent: it fires on status entry, not on a manual reassignment.
       */
      if (this.notifications)
        await new TriggerDispatcher([
          new NotificationService(tx as never),
          new CampaignTriggerService(tx as never),
        ]).dispatch({
          organizationId: input.organizationId,
          activityLogId: activity.id,
          leadId: input.leadId,
          processInstanceId: input.processInstanceId,
          actorUserId: input.actorUserId,
          triggerType: 'lead_reassigned',
          oldValue: { assignmentType: input.assignmentType, userId: old.userId },
          newValue: { assignmentType: input.assignmentType, userId: input.userId },
        });
      return assignment;
    });
  }

  async deactivate(input: { organizationId: string; leadId: string; actorUserId: string }) {
    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { organizationId: input.organizationId, id: input.leadId, active: true },
      });
      if (!lead) throw new Error('not_found');
      const deactivatedAt = new Date();
      await tx.lead.update({
        where: { organizationId_id: { organizationId: input.organizationId, id: input.leadId } },
        data: { active: false, deactivatedAt, deactivatedByUserId: input.actorUserId },
      });
      await tx.processInstance.updateMany({
        where: { organizationId: input.organizationId, leadId: input.leadId, active: true },
        data: { active: false },
      });
      await tx.userAccessGrant.updateMany({
        where: { organizationId: input.organizationId, leadId: input.leadId, revokedAt: null },
        data: { revokedAt: deactivatedAt },
      });
      const activity = await tx.activityLog.create({
        data: {
          organizationId: input.organizationId,
          leadId: input.leadId,
          actorUserId: input.actorUserId,
          actionType: 'lead_deactivated',
          source: 'lead_api',
          oldValue: { active: true },
          newValue: { active: false, deactivatedAt: deactivatedAt.toISOString() },
        },
      });
      if (this.notifications)
        await new NotificationService(tx as never).evaluate({
          organizationId: input.organizationId,
          activityLogId: activity.id,
          leadId: input.leadId,
          actorUserId: input.actorUserId,
          triggerType: 'lead_deactivated',
          oldValue: { active: true },
        });
      return activity;
    });
  }
}

function validateCapabilities(values: readonly string[]): ShareCapability[] {
  const unique = [...new Set(values)];
  if (
    !unique.includes('view') ||
    unique.some((value) => !shareCapabilities.includes(value as ShareCapability))
  )
    throw new Error('invalid_capabilities');
  return unique as ShareCapability[];
}
