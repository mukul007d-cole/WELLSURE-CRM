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
  createJourney(input: Record<string, unknown>): Promise<ConfigRow> {
    return this.prisma.journey.create({ data: input as never }) as Promise<ConfigRow>;
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
