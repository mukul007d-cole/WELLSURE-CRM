import type { FalconPrismaClient } from '@falcon/database';
import type { RecordPredicate } from '@falcon/permission-engine';

import { buildSellerListQuery } from '../leads/filter-sql.js';

/**
 * Follow-ups (ADR-0026): the `tasks` table, type `follow_up`.
 *
 * Scheduling lives in `LeadService` because it rides on a lead edit; this
 * service is everything a user does with follow-ups afterwards — the "my
 * follow-ups" list, a lead's follow-ups, and completing or rescheduling one.
 */

export const followUpType = 'follow_up' as const;
export const followUpViews = ['overdue', 'today', 'upcoming', 'done'] as const;
export type FollowUpView = (typeof followUpViews)[number];
export const followUpActions = ['complete', 'reopen', 'reschedule', 'cancel'] as const;
export type FollowUpAction = (typeof followUpActions)[number];

/** Above this many candidate rows, the list is cut rather than scanned forever. */
const candidateLimit = 2000;

export class TaskError extends Error {
  constructor(
    readonly code: 'validation_error' | 'not_found',
    message: string,
  ) {
    super(message);
  }
}

export interface FollowUpItem {
  id: string;
  leadId: string;
  leadName: string;
  processInstanceId: string | null;
  journeyId: string | null;
  journeyName: string | null;
  statusId: string | null;
  statusName: string | null;
  assignedToUserId: string;
  assignedToName: string;
  dueDate: string;
  status: string;
  note: string | null;
  completedAt: string | null;
  completedByName: string | null;
  createdAt: string;
}

const taskInclude = {
  lead: { select: { id: true, name: true } },
  processInstance: {
    select: {
      id: true,
      journeyId: true,
      journey: { select: { name: true } },
      currentStatusId: true,
      currentStatus: { select: { name: true } },
    },
  },
  assignedTo: { select: { name: true } },
  completedBy: { select: { name: true } },
} as const;

interface TaskRow {
  id: string;
  leadId: string;
  processInstanceId: string | null;
  assignedToUserId: string;
  dueDate: Date;
  status: string;
  note: string | null;
  completedAt: Date | null;
  createdAt: Date;
  lead: { id: string; name: string };
  processInstance: {
    id: string;
    journeyId: string;
    journey: { name: string };
    currentStatusId: string;
    currentStatus: { name: string };
  } | null;
  assignedTo: { name: string };
  completedBy: { name: string } | null;
}

function serialize(row: TaskRow): FollowUpItem {
  return {
    id: row.id,
    leadId: row.leadId,
    leadName: row.lead.name,
    processInstanceId: row.processInstanceId,
    journeyId: row.processInstance?.journeyId ?? null,
    journeyName: row.processInstance?.journey.name ?? null,
    statusId: row.processInstance?.currentStatusId ?? null,
    statusName: row.processInstance?.currentStatus.name ?? null,
    assignedToUserId: row.assignedToUserId,
    assignedToName: row.assignedTo.name,
    dueDate: row.dueDate.toISOString(),
    status: row.status,
    note: row.note,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedByName: row.completedBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The bounds of the caller's "today", in UTC. `tzOffsetMinutes` is the
 * browser's `Date#getTimezoneOffset()` (minutes *behind* UTC), so the server
 * never assumes where its users are.
 */
export function dayBounds(now: Date, tzOffsetMinutes: number): { start: Date; end: Date } {
  const local = new Date(now.getTime() - tzOffsetMinutes * 60_000);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = new Date(startLocal + tzOffsetMinutes * 60_000);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export class TaskService {
  constructor(private readonly prisma: FalconPrismaClient) {}

  /**
   * The caller's own follow-ups for one view, restricted to leads the caller
   * can still see — a follow-up must not reveal a lead that has since been
   * reassigned out of their reach.
   */
  async listMine(input: {
    organizationId: string;
    userId: string;
    view: FollowUpView;
    page: number;
    pageSize: number;
    now: Date;
    tzOffsetMinutes: number;
    predicate: RecordPredicate;
  }): Promise<{
    page: number;
    pageSize: number;
    total: number;
    truncated: boolean;
    items: FollowUpItem[];
  }> {
    const { end } = dayBounds(input.now, input.tzOffsetMinutes);
    const base = {
      organizationId: input.organizationId,
      assignedToUserId: input.userId,
      type: followUpType,
    };
    const where =
      input.view === 'done'
        ? { ...base, status: 'done' }
        : input.view === 'overdue'
          ? { ...base, status: 'open', dueDate: { lt: input.now } }
          : input.view === 'today'
            ? { ...base, status: 'open', dueDate: { gte: input.now, lt: end } }
            : { ...base, status: 'open', dueDate: { gte: end } };
    const candidates = await this.prisma.task.findMany({
      where,
      select: { id: true, leadId: true },
      orderBy:
        input.view === 'done'
          ? [{ completedAt: 'desc' }, { id: 'asc' }]
          : [{ dueDate: 'asc' }, { id: 'asc' }],
      take: candidateLimit + 1,
    });
    const truncated = candidates.length > candidateLimit;
    const bounded = candidates.slice(0, candidateLimit);
    const visible = await this.visibleLeadIds(input.organizationId, input.predicate, [
      ...new Set(bounded.map((row) => row.leadId)),
    ]);
    const ids = bounded.filter((row) => visible.has(row.leadId)).map((row) => row.id);
    const pageIds = ids.slice((input.page - 1) * input.pageSize, input.page * input.pageSize);
    const rows = (await this.prisma.task.findMany({
      where: { organizationId: input.organizationId, id: { in: pageIds } },
      include: taskInclude,
    })) as unknown as TaskRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      page: input.page,
      pageSize: input.pageSize,
      total: ids.length,
      truncated,
      items: pageIds.flatMap((id) => {
        const row = byId.get(id);
        return row === undefined ? [] : [serialize(row)];
      }),
    };
  }

  /** Open counts per view, for the sidebar badge and the page's tabs. */
  async countMine(input: {
    organizationId: string;
    userId: string;
    now: Date;
    tzOffsetMinutes: number;
    predicate: RecordPredicate;
  }): Promise<{ overdue: number; today: number; upcoming: number }> {
    const { end } = dayBounds(input.now, input.tzOffsetMinutes);
    const open = await this.prisma.task.findMany({
      where: {
        organizationId: input.organizationId,
        assignedToUserId: input.userId,
        type: followUpType,
        status: 'open',
      },
      select: { leadId: true, dueDate: true },
      take: candidateLimit,
    });
    const visible = await this.visibleLeadIds(input.organizationId, input.predicate, [
      ...new Set(open.map((row) => row.leadId)),
    ]);
    const counts = { overdue: 0, today: 0, upcoming: 0 };
    for (const row of open) {
      if (!visible.has(row.leadId)) continue;
      if (row.dueDate < input.now) counts.overdue += 1;
      else if (row.dueDate < end) counts.today += 1;
      else counts.upcoming += 1;
    }
    return counts;
  }

  /** Every follow-up on the given process instances, open first. */
  async listForProcesses(
    organizationId: string,
    leadId: string,
    processInstanceIds: readonly string[],
  ): Promise<FollowUpItem[]> {
    if (processInstanceIds.length === 0) return [];
    const rows = (await this.prisma.task.findMany({
      where: {
        organizationId,
        leadId,
        type: followUpType,
        processInstanceId: { in: [...processInstanceIds] },
      },
      include: taskInclude,
      orderBy: [{ dueDate: 'desc' }, { id: 'asc' }],
      take: 200,
    })) as unknown as TaskRow[];
    const items = rows.map(serialize);
    return [
      ...items.filter((item) => item.status === 'open'),
      ...items.filter((item) => item.status !== 'open'),
    ];
  }

  find(
    organizationId: string,
    taskId: string,
  ): Promise<{
    id: string;
    leadId: string;
    processInstanceId: string | null;
    assignedToUserId: string;
    status: string;
    dueDate: Date;
    note: string | null;
  } | null> {
    return this.prisma.task.findFirst({
      where: { organizationId, id: taskId, type: followUpType },
      select: {
        id: true,
        leadId: true,
        processInstanceId: true,
        assignedToUserId: true,
        status: true,
        dueDate: true,
        note: true,
      },
    });
  }

  /**
   * Complete, reopen, cancel or reschedule. Rescheduling closes this one as
   * `rescheduled` and opens a new one, so the history keeps every date the
   * lead was promised. Each change writes a `follow_up` activity row.
   */
  async apply(input: {
    organizationId: string;
    actorUserId: string;
    taskId: string;
    action: FollowUpAction;
    dueAt?: Date;
    note?: string | null;
  }): Promise<FollowUpItem> {
    const note = input.note === undefined ? undefined : (input.note?.trim() ?? '') || null;
    if (note !== undefined && note !== null && note.length > 2000)
      throw new TaskError('validation_error', 'follow-up note is too long');
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { organizationId: input.organizationId, id: input.taskId, type: followUpType },
      });
      if (task === null) throw new TaskError('not_found', 'follow-up not found');
      const now = new Date();
      let resultId = task.id;
      let activity: Record<string, string>;
      switch (input.action) {
        case 'complete':
        case 'cancel': {
          if (task.status !== 'open')
            throw new TaskError('validation_error', 'only an open follow-up can be closed');
          const status = input.action === 'complete' ? 'done' : 'cancelled';
          await tx.task.update({
            where: { organizationId_id: { organizationId: input.organizationId, id: task.id } },
            data: {
              status,
              completedAt: now,
              completedByUserId: input.actorUserId,
              ...(note === undefined ? {} : { note }),
            },
          });
          activity = { taskId: task.id, status, ...(note ? { note } : {}) };
          break;
        }
        case 'reopen': {
          if (task.status !== 'done' && task.status !== 'cancelled')
            throw new TaskError('validation_error', 'only a closed follow-up can be reopened');
          if (task.processInstanceId !== null) await this.closeOpen(tx, task, input.actorUserId);
          await tx.task.update({
            where: { organizationId_id: { organizationId: input.organizationId, id: task.id } },
            data: { status: 'open', completedAt: null, completedByUserId: null },
          });
          activity = { taskId: task.id, status: 'open' };
          break;
        }
        case 'reschedule': {
          if (input.dueAt === undefined || Number.isNaN(input.dueAt.getTime()))
            throw new TaskError('validation_error', 'a new follow-up date is required');
          if (task.status !== 'open')
            throw new TaskError('validation_error', 'only an open follow-up can be rescheduled');
          await tx.task.update({
            where: { organizationId_id: { organizationId: input.organizationId, id: task.id } },
            data: { status: 'rescheduled', completedAt: now, completedByUserId: input.actorUserId },
          });
          const next = await tx.task.create({
            data: {
              organizationId: input.organizationId,
              leadId: task.leadId,
              processInstanceId: task.processInstanceId,
              assignedToUserId: task.assignedToUserId,
              dueDate: input.dueAt,
              type: followUpType,
              status: 'open',
              createdFromStatusId: task.createdFromStatusId,
              source: 'lead_api',
              note: note === undefined ? task.note : note,
            },
          });
          resultId = next.id;
          activity = {
            taskId: next.id,
            dueAt: input.dueAt.toISOString(),
            assignedToUserId: task.assignedToUserId,
            ...(next.note ? { note: next.note } : {}),
          };
          break;
        }
      }
      await tx.activityLog.create({
        data: {
          organizationId: input.organizationId,
          leadId: task.leadId,
          processInstanceId: task.processInstanceId,
          actorUserId: input.actorUserId,
          actionType: 'follow_up',
          source: 'lead_api',
          oldValue: { taskId: task.id, status: task.status, dueAt: task.dueDate.toISOString() },
          newValue: activity,
        },
      });
      const row = (await tx.task.findFirst({
        where: { organizationId: input.organizationId, id: resultId },
        include: taskInclude,
      })) as unknown as TaskRow;
      return serialize(row);
    });
  }

  private async closeOpen(
    tx: Pick<FalconPrismaClient, 'task'>,
    task: { organizationId: string; processInstanceId: string | null },
    actorUserId: string,
  ) {
    await tx.task.updateMany({
      where: {
        organizationId: task.organizationId,
        processInstanceId: task.processInstanceId,
        type: followUpType,
        status: 'open',
      },
      data: { status: 'rescheduled', completedAt: new Date(), completedByUserId: actorUserId },
    });
  }

  private async visibleLeadIds(
    organizationId: string,
    predicate: RecordPredicate,
    leadIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (leadIds.length === 0) return new Set();
    const query = buildSellerListQuery({
      organizationId,
      predicate,
      conditions: [],
      leadIds,
      page: 1,
      pageSize: leadIds.length,
    });
    const rows = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      query.ids.text,
      ...query.ids.values,
    );
    return new Set(rows.map((row) => row.id));
  }
}
