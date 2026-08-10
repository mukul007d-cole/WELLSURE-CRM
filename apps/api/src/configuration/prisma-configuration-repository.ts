import type { FalconPrismaClient } from '@falcon/database';
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

import type { ConfigurationAuditInput, LeadActivityInput } from './audit.js';
import type { ConfigRow, ConfigurationRepository, ProcessInstanceStatusMove } from './service.js';

/** Prisma-backed configuration persistence; organization predicates preserve tenant isolation. */
export class PrismaConfigurationRepository implements ConfigurationRepository {
  constructor(private readonly prisma: FalconPrismaClient) {}

  async transaction<T>(work: (repository: ConfigurationRepository) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) =>
      work(new PrismaConfigurationRepository(tx as FalconPrismaClient)),
    );
  }
  async listJourneys(org: string, active: boolean | undefined, page: number, pageSize: number) {
    // No RoleJourneyAccess filter here. That table gates which journeys' *leads*
    // a role may reach; the configuration catalog is gated by the
    // journeys_statuses:view feature permission, already checked upstream in
    // readConfiguration. Filtering on both meant a role with the permission but
    // no grants — any role an admin creates before granting journey access —
    // saw an empty list and could never find the journey to grant.
    const where = {
      organizationId: org,
      ...(active === undefined ? {} : { active }),
    };
    const [total, items] = await Promise.all([
      this.prisma.journey.count({ where }),
      this.prisma.journey.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          statuses: {
            where: active === undefined ? {} : { active },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          },
        },
      }),
    ]);
    return { total, items: items as ConfigRow[] };
  }
  getJourneyDetail(org: string, id: string, active?: boolean) {
    return this.prisma.journey.findFirst({
      where: { organizationId: org, id, ...(active === undefined ? {} : { active }) },
      include: {
        statuses: {
          where: active === undefined ? {} : { active },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
    }) as Promise<ConfigRow | null>;
  }
  /**
   * `assignments.assignment_type` is a configurable free-text string, not an
   * enum, and nothing else in the system enumerates the permitted values. The
   * types actually in use on a Journey are therefore the only honest source
   * for a client that needs to assign someone — otherwise it has to invent a
   * literal, which the API explicitly does not require or define.
   */
  async listJourneyAssignmentTypes(org: string, journeyId: string): Promise<string[]> {
    const rows = await this.prisma.assignment.findMany({
      where: { organizationId: org, isCurrent: true, processInstance: { journeyId } },
      distinct: ['assignmentType'],
      select: { assignmentType: true },
      orderBy: { assignmentType: 'asc' },
    });
    return rows.map((row) => row.assignmentType);
  }
  async listServices(org: string, active: boolean | undefined, page: number, pageSize: number) {
    const where = { organizationId: org, ...(active === undefined ? {} : { active }) };
    const [total, items] = await Promise.all([
      this.prisma.service.count({ where }),
      this.prisma.service.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return { total, items: items as ConfigRow[] };
  }
  getServiceDetail(org: string, id: string, active?: boolean) {
    return this.prisma.service.findFirst({
      where: { organizationId: org, id, ...(active === undefined ? {} : { active }) },
    }) as Promise<ConfigRow | null>;
  }
  async listFields(org: string, active: boolean | undefined, page: number, pageSize: number) {
    const where = { organizationId: org, ...(active === undefined ? {} : { active }) };
    // Fields themselves were never filtered; their per-journey settings were,
    // so a zero-grant role saw every field with no journey mappings at all.
    const include = {
      settings: {
        where: { ...(active === undefined ? {} : { active }) },
        orderBy: { journeyId: 'asc' as const },
      },
    };
    const [total, items] = await Promise.all([
      this.prisma.field.count({ where }),
      this.prisma.field.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include,
      }),
    ]);
    return { total, items: items as ConfigRow[] };
  }
  getFieldDetail(org: string, id: string, active: boolean | undefined) {
    return this.prisma.field.findFirst({
      where: { organizationId: org, id, ...(active === undefined ? {} : { active }) },
      include: {
        settings: {
          where: { ...(active === undefined ? {} : { active }) },
          orderBy: { journeyId: 'asc' },
        },
      },
    }) as Promise<ConfigRow | null>;
  }
  listJourneyFieldSettings(org: string, journeyId: string) {
    return this.prisma.fieldJourneySetting.findMany({
      where: { organizationId: org, journeyId, active: true },
      orderBy: [{ fieldId: 'asc' }],
      include: { field: true },
    }) as Promise<ConfigRow[]>;
  }
  createJourney(input: Record<string, unknown>): Promise<ConfigRow> {
    return this.prisma.journey.create({ data: input as never }) as Promise<ConfigRow>;
  }
  /**
   * Journey access is an explicit per-role allow-list, and creating a Journey
   * used to add nobody to it — so a newly created Journey was invisible to
   * every role, including its author's. This grants it to the roles that can
   * already see Journey configuration, which is the set bootstrap seeds.
   *
   * Returns the roles granted so the caller can audit the change.
   */
  async grantJourneyAccessToConfigRoles(org: string, journeyId: string): Promise<string[]> {
    const roles = await this.prisma.role.findMany({
      where: {
        organizationId: org,
        active: true,
        permissions: { some: { organizationId: org, module: 'journeys_statuses', action: 'view' } },
      },
      select: { id: true },
    });
    if (roles.length === 0) return [];

    await this.prisma.roleJourneyAccess.createMany({
      data: roles.map((role) => ({ organizationId: org, roleId: role.id, journeyId })),
      skipDuplicates: true,
    });
    return roles.map((role) => role.id);
  }
  async updateJourney(
    org: string,
    id: string,
    input: Record<string, unknown>,
  ): Promise<ConfigRow | null> {
    return this.update(this.prisma.journey, org, id, input);
  }
  async findJourney(org: string, id: string): Promise<ConfigRow | null> {
    return this.prisma.journey.findFirst({
      where: { organizationId: org, id },
    }) as Promise<ConfigRow | null>;
  }
  countActiveProcessInstancesForJourney(org: string, id: string): Promise<number> {
    return this.prisma.processInstance.count({
      where: { organizationId: org, journeyId: id, active: true },
    });
  }
  createStatus(input: Record<string, unknown>): Promise<ConfigRow> {
    return this.prisma.status.create({ data: input as never }) as Promise<ConfigRow>;
  }
  async updateStatus(
    org: string,
    id: string,
    input: Record<string, unknown>,
  ): Promise<ConfigRow | null> {
    return this.update(this.prisma.status, org, id, input);
  }
  async findStatus(org: string, id: string): Promise<ConfigRow | null> {
    return this.prisma.status.findFirst({
      where: { organizationId: org, id },
    }) as Promise<ConfigRow | null>;
  }
  listActiveProcessInstancesForStatus(
    org: string,
    id: string,
  ): Promise<ProcessInstanceStatusMove[]> {
    return this.prisma.processInstance.findMany({
      where: { organizationId: org, currentStatusId: id, active: true },
      select: {
        id: true,
        organizationId: true,
        leadId: true,
        journeyId: true,
        currentStatusId: true,
      },
    }) as Promise<ProcessInstanceStatusMove[]>;
  }
  async reassignProcessInstances(input: {
    organizationId: string;
    fromStatusId: string;
    toStatusId: string;
  }): Promise<number> {
    const result = await this.prisma.processInstance.updateMany({
      where: {
        organizationId: input.organizationId,
        currentStatusId: input.fromStatusId,
        active: true,
      },
      data: { currentStatusId: input.toStatusId },
    });
    return result.count;
  }
  createService(input: Record<string, unknown>): Promise<ConfigRow> {
    return this.prisma.service.create({ data: input as never }) as Promise<ConfigRow>;
  }
  async updateService(
    org: string,
    id: string,
    input: Record<string, unknown>,
  ): Promise<ConfigRow | null> {
    return this.update(this.prisma.service, org, id, input);
  }
  async findService(org: string, id: string): Promise<ConfigRow | null> {
    return this.prisma.service.findFirst({
      where: { organizationId: org, id },
    }) as Promise<ConfigRow | null>;
  }
  countActiveLeadServicesForService(org: string, id: string): Promise<number> {
    return this.prisma.leadService.count({
      where: { organizationId: org, serviceId: id, active: true },
    });
  }
  createField(input: Record<string, unknown>): Promise<ConfigRow> {
    return this.prisma.field.create({ data: input as never }) as Promise<ConfigRow>;
  }
  async updateField(
    org: string,
    id: string,
    input: Record<string, unknown>,
  ): Promise<ConfigRow | null> {
    return this.update(this.prisma.field, org, id, input);
  }
  async findField(org: string, id: string): Promise<ConfigRow | null> {
    return this.prisma.field.findFirst({
      where: { organizationId: org, id },
    }) as Promise<ConfigRow | null>;
  }
  countFieldSettings(org: string, id: string): Promise<number> {
    return this.prisma.fieldJourneySetting.count({
      where: { organizationId: org, fieldId: id, active: true },
    });
  }
  countFieldVisibility(org: string, id: string): Promise<number> {
    return this.prisma.fieldVisibility.count({ where: { organizationId: org, fieldId: id } });
  }
  upsertJourneyService(input: {
    organizationId: string;
    journeyId: string;
    serviceId: string;
  }): Promise<ConfigRow> {
    return this.prisma.journeyService.upsert({
      where: { organizationId_journeyId_serviceId: input },
      create: { ...input, active: true },
      update: { active: true },
    }) as Promise<ConfigRow>;
  }
  async deleteJourneyService(
    org: string,
    journeyId: string,
    serviceId: string,
  ): Promise<ConfigRow | null> {
    return this.deactivate(this.prisma.journeyService, {
      organizationId: org,
      journeyId,
      serviceId,
    });
  }
  upsertFieldJourneySetting(input: Record<string, unknown>): Promise<ConfigRow> {
    const organizationId = String(input.organizationId);
    const fieldId = String(input.fieldId);
    const journeyId = String(input.journeyId);
    return this.prisma.fieldJourneySetting.upsert({
      where: { organizationId_fieldId_journeyId: { organizationId, fieldId, journeyId } },
      create: input as never,
      update: input as never,
    }) as Promise<ConfigRow>;
  }
  async deleteFieldJourneySetting(
    org: string,
    fieldId: string,
    journeyId: string,
  ): Promise<ConfigRow | null> {
    return this.deactivate(this.prisma.fieldJourneySetting, {
      organizationId: org,
      fieldId,
      journeyId,
    });
  }
  upsertFieldVisibility(input: {
    organizationId: string;
    fieldId: string;
    roleId: string;
    accessLevel: string;
  }): Promise<ConfigRow> {
    return this.prisma.fieldVisibility.upsert({
      where: {
        organizationId_fieldId_roleId: {
          organizationId: input.organizationId,
          roleId: input.roleId,
          fieldId: input.fieldId,
        },
      },
      create: input as never,
      update: { accessLevel: input.accessLevel as never },
    }) as Promise<ConfigRow>;
  }
  async deleteFieldVisibility(
    org: string,
    fieldId: string,
    roleId: string,
  ): Promise<ConfigRow | null> {
    const row = await this.prisma.fieldVisibility.findFirst({
      where: { organizationId: org, fieldId, roleId },
    });
    if (!row) return null;
    await this.prisma.fieldVisibility.delete({
      where: { organizationId_fieldId_roleId: { organizationId: org, roleId, fieldId } },
    });
    return row as ConfigRow;
  }
  async writeSystemAudit(input: ConfigurationAuditInput): Promise<void> {
    await this.prisma.systemAuditLog.create({ data: input as never });
  }
  async writeActivity(input: LeadActivityInput): Promise<void> {
    await this.prisma.activityLog.create({ data: input as never });
  }

  private async update(
    model: ModelOps,
    organizationId: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<ConfigRow | null> {
    const row = await model.findFirst({ where: { organizationId, id } });
    return row
      ? model.update({ where: { organizationId_id: { organizationId, id } }, data })
      : null;
  }
  private async deactivate(
    model: ModelOps,
    where: Record<string, string>,
  ): Promise<ConfigRow | null> {
    const row = await model.findFirst({ where });
    if (!row) return null;
    const configRow = row as ConfigRow;
    return model.update({
      where: {
        organizationId_id: { organizationId: configRow.organizationId, id: configRow.id },
      },
      data: { active: false },
    });
  }
}

interface ModelOps {
  findFirst(args: object): Promise<unknown>;
  update(args: object): Promise<ConfigRow>;
}
