import type { RecordPredicate } from '@falcon/permission-engine';

import type { LeadActivityInput } from './activity.js';
import type {
  LeadAssignmentRecord,
  LeadCoreRecord,
  LeadProcessRecord,
  LeadRepository,
} from './service.js';
import type { LeadFieldSetting } from './validation.js';
import { NotificationService } from '../notifications/service.js';
import type {
  LeadDetailRecord,
  Seller360Record,
  SellerListInput,
  SellerListProcessSummary,
  SellerListRecord,
  SellerReadRepository,
  LeadReadRepository,
} from '../routes/leads.js';

type JsonRecord = Record<string, unknown>;

type PrismaTransactionClient = PrismaLeadClient;

export interface PrismaLeadClient {
  $transaction?<T>(work: (tx: PrismaTransactionClient) => Promise<T>): Promise<T>;
  journey: {
    findUnique(args: unknown): Promise<{ id: string; active: boolean } | null>;
  };
  status: {
    findUnique(args: unknown): Promise<StatusRow | null>;
    findFirst(args: unknown): Promise<StatusRow | null>;
  };
  fieldJourneySetting: {
    findMany(args: unknown): Promise<FieldSettingRow[]>;
  };
  lead: {
    findUnique(args: unknown): Promise<LeadRow | null>;
    findMany(args: unknown): Promise<LeadRow[]>;
    count(args: unknown): Promise<number>;
    create(args: unknown): Promise<LeadRow>;
    update(args: unknown): Promise<LeadRow>;
  };
  processInstance: {
    findUnique(args: unknown): Promise<ProcessRow | null>;
    findFirst(args: unknown): Promise<ProcessRow | null>;
    create(args: unknown): Promise<ProcessRow>;
    update(args: unknown): Promise<ProcessRow>;
  };
  assignment: {
    create(args: unknown): Promise<AssignmentRow>;
  };
  user: {
    findUnique(args: unknown): Promise<{ id: string } | null>;
  };
  activityLog: {
    create(args: unknown): Promise<unknown>;
  };
}

interface StatusRow {
  id: string;
  active: boolean;
  isDefaultOnCreate?: boolean;
}

interface FieldSettingRow {
  fieldId: string;
  journeyId: string;
  requirement: string;
  requiredFromStatusId: string | null;
  active: boolean;
  field: {
    id: string;
    fieldType: string;
    validationRule: unknown;
    active: boolean;
  };
}

interface LeadRow {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  email: string | null;
  fieldValues: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  processInstances?: ProcessRow[];
  grants?: Array<{ userId: string }>;
  active?: boolean;
}

interface ProcessRow {
  id: string;
  organizationId: string;
  leadId: string;
  journeyId: string;
  currentStatusId: string;
  isPrimary: boolean;
  active: boolean;
  journey?: { id: string; key: string; name: string };
  currentStatus?: {
    id: string;
    key: string;
    name: string;
    outcomeType?: string;
    behaviorType?: string;
  };
  assignments?: AssignmentRow[];
}

interface AssignmentRow {
  id: string;
  organizationId: string;
  processInstanceId: string;
  assignmentType: string;
  userId: string;
  isCurrent: boolean;
  user?: { id: string; name: string };
}

export class PrismaLeadRepository
  implements LeadRepository, LeadReadRepository, SellerReadRepository
{
  constructor(
    private readonly prisma: PrismaLeadClient,
    private readonly notifications?: NotificationService,
  ) {}

  async transaction<T>(work: (repository: LeadRepository) => Promise<T>): Promise<T> {
    if (this.prisma.$transaction === undefined) return work(this);
    return this.prisma.$transaction((tx) =>
      work(
        new PrismaLeadRepository(
          tx,
          this.notifications ? new NotificationService(tx as never) : undefined,
        ),
      ),
    );
  }

  async findJourney(organizationId: string, journeyId: string) {
    return this.prisma.journey.findUnique({
      where: { organizationId_id: { organizationId, id: journeyId } },
      select: { id: true, active: true },
    });
  }

  async findStatus(organizationId: string, journeyId: string, statusId: string) {
    return this.prisma.status.findUnique({
      where: { organizationId_journeyId_id: { organizationId, journeyId, id: statusId } },
      select: { id: true, active: true, isDefaultOnCreate: true },
    });
  }

  async findDefaultStatus(organizationId: string, journeyId: string) {
    return this.prisma.status.findFirst({
      where: { organizationId, journeyId, active: true, isDefaultOnCreate: true },
      select: { id: true, active: true, isDefaultOnCreate: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async listFieldSettings(organizationId: string, journeyId: string): Promise<LeadFieldSetting[]> {
    const rows = await this.prisma.fieldJourneySetting.findMany({
      where: { organizationId, journeyId, active: true },
      include: {
        field: { select: { id: true, fieldType: true, validationRule: true, active: true } },
      },
    });
    return rows.map((row) => ({
      fieldId: row.fieldId,
      journeyId: row.journeyId,
      requirement: row.requirement,
      requiredFromStatusId: row.requiredFromStatusId,
      active: row.active,
      field: row.field,
    }));
  }

  async findLead(organizationId: string, leadId: string): Promise<LeadCoreRecord | null> {
    const row = await this.prisma.lead.findUnique({
      where: { organizationId_id: { organizationId, id: leadId } },
    });
    return row === null ? null : lead(row);
  }

  async findLeadById(organizationId: string, leadId: string): Promise<LeadDetailRecord | null> {
    const row = await this.prisma.lead.findUnique({
      where: { organizationId_id: { organizationId, id: leadId } },
      include: {
        processInstances: { where: { active: true }, select: { journeyId: true, active: true } },
      },
    });
    return row === null
      ? null
      : {
          ...lead(row),
          processInstances: (row.processInstances ?? []).map((process) => ({
            journeyId: process.journeyId,
            active: process.active,
          })),
        };
  }

  async findProcessInstance(
    organizationId: string,
    processInstanceId: string,
  ): Promise<LeadProcessRecord | null> {
    const row = await this.prisma.processInstance.findUnique({
      where: { organizationId_id: { organizationId, id: processInstanceId } },
    });
    return row === null ? null : process(row);
  }

  async findActiveProcessInstanceByLeadJourney(
    organizationId: string,
    leadId: string,
    journeyId: string,
  ): Promise<LeadProcessRecord | null> {
    const row = await this.prisma.processInstance.findFirst({
      where: { organizationId, leadId, journeyId, active: true },
    });
    return row === null ? null : process(row);
  }

  async createLead(input: {
    organizationId: string;
    name: string;
    phone: string | null;
    email: string | null;
    fieldValues: JsonRecord;
  }): Promise<LeadCoreRecord> {
    return lead(await this.prisma.lead.create({ data: input }));
  }

  async updateLead(
    organizationId: string,
    leadId: string,
    input: Partial<Pick<LeadCoreRecord, 'name' | 'phone' | 'email' | 'fieldValues'>>,
  ): Promise<LeadCoreRecord | null> {
    const existing = await this.findLead(organizationId, leadId);
    if (existing === null) return null;
    return lead(
      await this.prisma.lead.update({
        where: { organizationId_id: { organizationId, id: leadId } },
        data: input,
      }),
    );
  }

  async createProcessInstance(input: {
    organizationId: string;
    leadId: string;
    journeyId: string;
    currentStatusId: string;
    isPrimary: boolean;
  }): Promise<LeadProcessRecord> {
    return process(await this.prisma.processInstance.create({ data: input }));
  }

  async updateProcessInstanceStatus(
    organizationId: string,
    processInstanceId: string,
    statusId: string,
  ): Promise<LeadProcessRecord | null> {
    const existing = await this.findProcessInstance(organizationId, processInstanceId);
    if (existing === null) return null;
    return process(
      await this.prisma.processInstance.update({
        where: { organizationId_id: { organizationId, id: processInstanceId } },
        data: { currentStatusId: statusId },
      }),
    );
  }

  async createAssignment(input: {
    organizationId: string;
    processInstanceId: string;
    assignmentType: string;
    userId: string;
  }): Promise<LeadAssignmentRecord> {
    return assignment(await this.prisma.assignment.create({ data: input }));
  }

  async userExists(organizationId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({
      where: { organizationId_id: { organizationId, id: userId } },
      select: { id: true },
    });
    return row !== null;
  }

  async writeActivity(input: LeadActivityInput): Promise<void> {
    const activity = await this.prisma.activityLog.create({
      data: {
        organizationId: input.organizationId,
        leadId: input.leadId,
        processInstanceId: input.processInstanceId,
        actorUserId: input.actorUserId,
        actionType: input.actionType,
        source: input.source,
        oldValue: input.oldValue,
        newValue: input.newValue,
      },
    });
    if (this.notifications && activity && typeof activity === 'object' && 'id' in activity) {
      const triggerType =
        input.actionType === 'field_edit'
          ? 'field_edited'
          : input.actionType === 'status_change'
            ? 'status_changed'
            : input.actionType === 'reassignment'
              ? 'lead_reassigned'
              : input.actionType === 'lead_deactivated'
                ? 'lead_deactivated'
                : undefined;
      if (triggerType)
        await this.notifications.evaluate({
          organizationId: input.organizationId,
          activityLogId: String(activity.id),
          leadId: input.leadId,
          ...(input.processInstanceId === undefined
            ? {}
            : { processInstanceId: input.processInstanceId }),
          actorUserId: input.actorUserId,
          triggerType,
          oldValue: input.oldValue,
        });
      if (
        input.actionType === 'field_edit' &&
        (await this.notifications.isActiveShareActor(
          input.organizationId,
          input.leadId,
          input.actorUserId,
        ))
      )
        await this.notifications.evaluate({
          organizationId: input.organizationId,
          activityLogId: String(activity.id),
          leadId: input.leadId,
          ...(input.processInstanceId === undefined
            ? {}
            : { processInstanceId: input.processInstanceId }),
          actorUserId: input.actorUserId,
          triggerType: 'shared_lead_modified_by_non_owner',
          oldValue: input.oldValue,
        });
    }
  }

  async findSeller360(organizationId: string, leadId: string): Promise<Seller360Record | null> {
    const row = await this.prisma.lead.findUnique({
      where: { organizationId_id: { organizationId, id: leadId } },
      include: {
        processInstances: {
          where: { active: true },
          include: {
            journey: { select: { id: true, key: true, name: true } },
            currentStatus: { select: { id: true, key: true, name: true } },
            assignments: { where: { isCurrent: true } },
          },
        },
      },
    });
    if (row === null) return null;
    return {
      ...lead(row),
      processInstances: (row.processInstances ?? []).map((item) => ({
        ...process(item),
        journey: item.journey!,
        currentStatus: item.currentStatus!,
        assignments: (item.assignments ?? []).map(assignment),
      })),
    };
  }

  async listSellers(
    input: SellerListInput & { organizationId: string; recordPredicate: RecordPredicate },
  ): Promise<{ rows: SellerListRecord[]; total: number }> {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));
    const where = sellerWhere(input);
    const sortOrder = orderBy(input);
    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: sortOrder,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          grants: {
            where: {
              userId: input.recordPredicate.includeDirectGrantsForUserId,
              revokedAt: null,
              actions: { has: 'view' },
            },
            select: { userId: true },
          },
          processInstances: {
            where: processWhere(input),
            include: {
              journey: { select: { id: true, key: true, name: true } },
              currentStatus: {
                select: { id: true, key: true, name: true, outcomeType: true, behaviorType: true },
              },
              assignments: {
                where: { isCurrent: true },
                include: { user: { select: { id: true, name: true } } },
              },
            },
          },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);
    return {
      rows: rows.map((row) => ({
        ...lead(row),
        processInstances: (row.processInstances ?? []).map(sellerListProcess),
        shared: Boolean(row.grants?.length),
      })),
      total,
    };
  }
}

function sellerWhere(
  input: SellerListInput & { organizationId: string; recordPredicate: RecordPredicate },
) {
  const currentProcessWhere = processWhere(input);
  return {
    organizationId: input.organizationId,
    active: true,
    ...(input.search === undefined || input.search.trim() === ''
      ? {}
      : {
          OR: [
            { name: { contains: input.search.trim(), mode: 'insensitive' } },
            { phone: { contains: input.search.trim(), mode: 'insensitive' } },
            { email: { contains: input.search.trim(), mode: 'insensitive' } },
          ],
        }),
    ...(input.accessMode === 'mine'
      ? { processInstances: { some: currentProcessWhere } }
      : input.accessMode === 'shared_with_me'
        ? {
            grants: {
              some: {
                organizationId: input.organizationId,
                userId: input.recordPredicate.includeDirectGrantsForUserId,
                revokedAt: null,
                actions: { has: 'view' },
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
            },
          }
        : {
            OR: [
              { processInstances: { some: currentProcessWhere } },
              {
                grants: {
                  some: {
                    organizationId: input.organizationId,
                    userId: input.recordPredicate.includeDirectGrantsForUserId,
                    revokedAt: null,
                    actions: { has: input.recordPredicate.directGrantAction },
                    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                  },
                },
                processInstances: {
                  some: {
                    organizationId: input.organizationId,
                    active: true,
                    journeyId: { in: [...input.recordPredicate.journeyIds] },
                  },
                },
              },
            ],
          }),
  };
}

function processWhere(
  input: SellerListInput & { organizationId: string; recordPredicate: RecordPredicate },
) {
  const allowedUsers = input.recordPredicate.allowedUserIds;
  return {
    organizationId: input.organizationId,
    active: true,
    journeyId: {
      in: input.journeyId === undefined ? [...input.recordPredicate.journeyIds] : [input.journeyId],
    },
    ...(input.statusId === undefined ? {} : { currentStatusId: input.statusId }),
    assignments: {
      some: {
        organizationId: input.organizationId,
        isCurrent: true,
        assignmentType: { in: [...input.recordPredicate.assignmentTypes] },
        ...(input.ownerUserId === undefined ? {} : { userId: input.ownerUserId }),
        ...(allowedUsers === 'ALL_ORGANIZATION_USERS' ? {} : { userId: { in: [...allowedUsers] } }),
      },
    },
  };
}

function orderBy(input: SellerListInput): Record<string, string> {
  const direction = input.sortDirection ?? 'desc';
  switch (input.sortBy ?? 'updatedAt') {
    case 'createdAt':
      return { createdAt: direction };
    case 'name':
      return { name: direction };
    case 'updatedAt':
      return { updatedAt: direction };
  }
}

function lead(row: LeadRow): LeadCoreRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    fieldValues: isRecord(row.fieldValues) ? row.fieldValues : {},
    ...(row.createdAt === undefined ? {} : { createdAt: row.createdAt }),
    ...(row.updatedAt === undefined ? {} : { updatedAt: row.updatedAt }),
  };
}

function process(row: ProcessRow): LeadProcessRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    leadId: row.leadId,
    journeyId: row.journeyId,
    currentStatusId: row.currentStatusId,
    isPrimary: row.isPrimary,
    active: row.active,
    ...(row.journey === undefined ? {} : { journey: row.journey }),
    ...(row.currentStatus === undefined ? {} : { currentStatus: row.currentStatus }),
    ...(row.assignments === undefined ? {} : { assignments: row.assignments.map(assignment) }),
  };
}

function sellerListProcess(row: ProcessRow): SellerListProcessSummary {
  return {
    processInstanceId: row.id,
    journeyId: row.journeyId,
    journeyName: row.journey?.name ?? '',
    statusId: row.currentStatusId,
    statusName: row.currentStatus?.name ?? '',
    statusOutcomeType: row.currentStatus?.outcomeType ?? 'open',
    statusBehaviorType: row.currentStatus?.behaviorType ?? 'default',
    ownerName: row.assignments?.[0]?.user?.name ?? null,
  };
}

function assignment(row: AssignmentRow): LeadAssignmentRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    processInstanceId: row.processInstanceId,
    assignmentType: row.assignmentType,
    userId: row.userId,
    isCurrent: row.isCurrent,
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
