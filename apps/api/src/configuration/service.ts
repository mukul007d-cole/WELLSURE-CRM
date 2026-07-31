import type { ConfigurationAuditWriter, LeadActivityWriter } from './audit.js';
import { ConfigurationError } from './errors.js';
import {
  fieldAccessLevels,
  fieldEditModes,
  fieldRequirements,
  fieldSources,
  requireConfigKey,
  requireNonBlank,
  requireNonNegativeInteger,
  requireOneOf,
  statusBehaviorTypes,
  statusOutcomeTypes,
} from './validation.js';

export interface ConfigRow {
  id: string;
  organizationId: string;
  active?: boolean;
  journeyId?: string;
  [key: string]: unknown;
}

export interface ProcessInstanceStatusMove {
  id: string;
  organizationId: string;
  leadId: string;
  journeyId: string;
  currentStatusId: string;
}

export interface ConfigurationRepository extends ConfigurationAuditWriter, LeadActivityWriter {
  transaction<T>(work: (repository: ConfigurationRepository) => Promise<T>): Promise<T>;
  createJourney(input: Record<string, unknown>): Promise<ConfigRow>;
  updateJourney(
    organizationId: string,
    id: string,
    input: Record<string, unknown>,
  ): Promise<ConfigRow | null>;
  findJourney(organizationId: string, id: string): Promise<ConfigRow | null>;
  countActiveProcessInstancesForJourney(organizationId: string, journeyId: string): Promise<number>;
  createStatus(input: Record<string, unknown>): Promise<ConfigRow>;
  updateStatus(
    organizationId: string,
    id: string,
    input: Record<string, unknown>,
  ): Promise<ConfigRow | null>;
  findStatus(organizationId: string, id: string): Promise<ConfigRow | null>;
  listActiveProcessInstancesForStatus(
    organizationId: string,
    statusId: string,
  ): Promise<ProcessInstanceStatusMove[]>;
  reassignProcessInstances(input: {
    organizationId: string;
    fromStatusId: string;
    toStatusId: string;
  }): Promise<number>;
  createService(input: Record<string, unknown>): Promise<ConfigRow>;
  updateService(
    organizationId: string,
    id: string,
    input: Record<string, unknown>,
  ): Promise<ConfigRow | null>;
  findService(organizationId: string, id: string): Promise<ConfigRow | null>;
  countActiveLeadServicesForService(organizationId: string, serviceId: string): Promise<number>;
  createField(input: Record<string, unknown>): Promise<ConfigRow>;
  updateField(
    organizationId: string,
    id: string,
    input: Record<string, unknown>,
  ): Promise<ConfigRow | null>;
  findField(organizationId: string, id: string): Promise<ConfigRow | null>;
  countFieldSettings(organizationId: string, fieldId: string): Promise<number>;
  countFieldVisibility(organizationId: string, fieldId: string): Promise<number>;
  upsertJourneyService(input: {
    organizationId: string;
    journeyId: string;
    serviceId: string;
  }): Promise<ConfigRow>;
  deleteJourneyService(
    organizationId: string,
    journeyId: string,
    serviceId: string,
  ): Promise<ConfigRow | null>;
  upsertFieldJourneySetting(input: Record<string, unknown>): Promise<ConfigRow>;
  deleteFieldJourneySetting(
    organizationId: string,
    fieldId: string,
    journeyId: string,
  ): Promise<ConfigRow | null>;
  upsertFieldVisibility(input: {
    organizationId: string;
    fieldId: string;
    roleId: string;
    accessLevel: string;
  }): Promise<ConfigRow>;
  deleteFieldVisibility(
    organizationId: string,
    fieldId: string,
    roleId: string,
  ): Promise<ConfigRow | null>;
}

export class ConfigurationService {
  constructor(private readonly repository: ConfigurationRepository) {}

  async createJourney(input: {
    organizationId: string;
    actorUserId: string;
    key: string;
    name: string;
  }) {
    return this.repository.transaction(async (tx) => {
      const row = await tx.createJourney({
        organizationId: input.organizationId,
        key: requireConfigKey(input.key),
        name: requireNonBlank(input.name, 'journey name'),
        createdById: input.actorUserId,
        updatedById: input.actorUserId,
      });
      await tx.writeSystemAudit(audit(input, 'journey', row.id, 'create', null, row));
      return row;
    });
  }

  async updateJourney(input: {
    organizationId: string;
    actorUserId: string;
    journeyId: string;
    name: string;
  }) {
    return this.editPrimary(
      input,
      'journey',
      (tx) => tx.findJourney(input.organizationId, input.journeyId),
      (tx) =>
        tx.updateJourney(input.organizationId, input.journeyId, {
          name: requireNonBlank(input.name, 'journey name'),
          updatedById: input.actorUserId,
        }),
    );
  }

  async deactivateJourney(input: {
    organizationId: string;
    actorUserId: string;
    journeyId: string;
  }) {
    return this.repository.transaction(async (tx) => {
      const oldValue = await requireFound(tx.findJourney(input.organizationId, input.journeyId));
      const activeCount = await tx.countActiveProcessInstancesForJourney(
        input.organizationId,
        input.journeyId,
      );
      if (activeCount > 0)
        throw new ConfigurationError(
          'dependency_conflict',
          'journey has active process instances',
          { activeProcessInstances: activeCount },
        );
      const row = await requireFound(
        tx.updateJourney(input.organizationId, input.journeyId, {
          active: false,
          updatedById: input.actorUserId,
        }),
      );
      await tx.writeSystemAudit(
        audit(input, 'journey', input.journeyId, 'deactivate', oldValue, row),
      );
      return row;
    });
  }

  async createStatus(input: {
    organizationId: string;
    actorUserId: string;
    journeyId: string;
    key: string;
    name: string;
    outcomeType: string;
    behaviorType: string;
    sortOrder: number;
  }) {
    return this.repository.transaction(async (tx) => {
      await requireFound(tx.findJourney(input.organizationId, input.journeyId));
      const row = await tx.createStatus({
        organizationId: input.organizationId,
        journeyId: input.journeyId,
        key: requireConfigKey(input.key),
        name: requireNonBlank(input.name, 'status name'),
        outcomeType: requireOneOf(input.outcomeType, statusOutcomeTypes, 'outcome type'),
        behaviorType: requireOneOf(input.behaviorType, statusBehaviorTypes, 'behavior type'),
        sortOrder: requireNonNegativeInteger(input.sortOrder, 'sort order'),
        createdById: input.actorUserId,
        updatedById: input.actorUserId,
      });
      await tx.writeSystemAudit(audit(input, 'status', row.id, 'create', null, row));
      return row;
    });
  }

  async deactivateStatus(input: {
    organizationId: string;
    actorUserId: string;
    statusId: string;
    replacementStatusId?: string;
  }) {
    return this.repository.transaction(async (tx) => {
      const oldStatus = await requireFound(tx.findStatus(input.organizationId, input.statusId));
      const active = await tx.listActiveProcessInstancesForStatus(
        input.organizationId,
        input.statusId,
      );
      if (active.length > 0 && input.replacementStatusId === undefined)
        throw new ConfigurationError(
          'dependency_conflict',
          'status has active process instances; reassign them before deactivation',
          { activeProcessInstances: active.length },
        );
      let reassigned = 0;
      if (input.replacementStatusId !== undefined) {
        const replacement = await requireFound(
          tx.findStatus(input.organizationId, input.replacementStatusId),
        );
        if (replacement.journeyId !== oldStatus.journeyId || replacement.active === false)
          throw new ConfigurationError(
            'validation_error',
            'replacement status must be active and in the same journey',
          );
        reassigned = await tx.reassignProcessInstances({
          organizationId: input.organizationId,
          fromStatusId: input.statusId,
          toStatusId: input.replacementStatusId,
        });
        await Promise.all(
          active.map((process) =>
            tx.writeActivity({
              organizationId: input.organizationId,
              leadId: process.leadId,
              processInstanceId: process.id,
              actorUserId: input.actorUserId,
              actionType: 'status_change',
              source: 'configuration_engine',
              oldValue: { statusId: input.statusId },
              newValue: { statusId: input.replacementStatusId },
            }),
          ),
        );
      }
      const row = await requireFound(
        tx.updateStatus(input.organizationId, input.statusId, {
          active: false,
          updatedById: input.actorUserId,
        }),
      );
      await tx.writeSystemAudit(
        audit(
          input,
          'status',
          input.statusId,
          reassigned > 0 ? 'reassign_and_deactivate' : 'deactivate',
          oldStatus,
          { ...row, reassignedProcessInstances: reassigned },
        ),
      );
      return row;
    });
  }

  async createService(input: {
    organizationId: string;
    actorUserId: string;
    key: string;
    name: string;
    description?: string | null;
  }) {
    return this.repository.transaction(async (tx) => {
      const row = await tx.createService({
        organizationId: input.organizationId,
        key: requireConfigKey(input.key),
        name: requireNonBlank(input.name, 'service name'),
        description: input.description ?? null,
        createdById: input.actorUserId,
        updatedById: input.actorUserId,
      });
      await tx.writeSystemAudit(audit(input, 'service', row.id, 'create', null, row));
      return row;
    });
  }

  async deactivateService(input: {
    organizationId: string;
    actorUserId: string;
    serviceId: string;
  }) {
    return this.repository.transaction(async (tx) => {
      const oldValue = await requireFound(tx.findService(input.organizationId, input.serviceId));
      const activeCount = await tx.countActiveLeadServicesForService(
        input.organizationId,
        input.serviceId,
      );
      if (activeCount > 0)
        throw new ConfigurationError('dependency_conflict', 'service has active lead enrollments', {
          activeLeadServices: activeCount,
        });
      const row = await requireFound(
        tx.updateService(input.organizationId, input.serviceId, {
          active: false,
          updatedById: input.actorUserId,
        }),
      );
      await tx.writeSystemAudit(
        audit(input, 'service', input.serviceId, 'deactivate', oldValue, row),
      );
      return row;
    });
  }

  async createField(input: {
    organizationId: string;
    actorUserId: string;
    key: string;
    name: string;
    fieldType: string;
    validationRule?: unknown;
    section?: string | null;
    editMode: string;
    source: string;
  }) {
    return this.repository.transaction(async (tx) => {
      const row = await tx.createField({
        organizationId: input.organizationId,
        key: requireConfigKey(input.key),
        name: requireNonBlank(input.name, 'field name'),
        fieldType: requireNonBlank(input.fieldType, 'field type'),
        validationRule: input.validationRule ?? null,
        section: input.section ?? null,
        editMode: requireOneOf(input.editMode, fieldEditModes, 'edit mode'),
        source: requireOneOf(input.source, fieldSources, 'source'),
        createdById: input.actorUserId,
        updatedById: input.actorUserId,
      });
      await tx.writeSystemAudit(audit(input, 'field', row.id, 'create', null, row));
      return row;
    });
  }

  async deactivateField(input: { organizationId: string; actorUserId: string; fieldId: string }) {
    return this.repository.transaction(async (tx) => {
      const oldValue = await requireFound(tx.findField(input.organizationId, input.fieldId));
      const settings = await tx.countFieldSettings(input.organizationId, input.fieldId);
      const visibility = await tx.countFieldVisibility(input.organizationId, input.fieldId);
      if (settings + visibility > 0)
        throw new ConfigurationError(
          'dependency_conflict',
          'field has active settings or visibility rows; remove mappings first',
          { fieldJourneySettings: settings, fieldVisibility: visibility },
        );
      const row = await requireFound(
        tx.updateField(input.organizationId, input.fieldId, {
          active: false,
          updatedById: input.actorUserId,
        }),
      );
      await tx.writeSystemAudit(audit(input, 'field', input.fieldId, 'deactivate', oldValue, row));
      return row;
    });
  }

  async mapJourneyService(input: {
    organizationId: string;
    actorUserId: string;
    journeyId: string;
    serviceId: string;
  }) {
    return this.map(input, 'journey_service', (tx) => tx.upsertJourneyService(input));
  }
  async unmapJourneyService(input: {
    organizationId: string;
    actorUserId: string;
    journeyId: string;
    serviceId: string;
  }) {
    return this.deleteMapping(input, 'journey_service', (tx) =>
      tx.deleteJourneyService(input.organizationId, input.journeyId, input.serviceId),
    );
  }
  async upsertFieldJourneySetting(input: {
    organizationId: string;
    actorUserId: string;
    fieldId: string;
    journeyId: string;
    requirement: string;
    requiredFromStatusId?: string | null;
  }) {
    return this.map(input, 'field_journey_setting', async (tx) => {
      if (input.requiredFromStatusId !== undefined && input.requiredFromStatusId !== null) {
        const status = await requireFound(
          tx.findStatus(input.organizationId, input.requiredFromStatusId),
        );
        if (status.journeyId !== input.journeyId || status.active === false)
          throw new ConfigurationError(
            'validation_error',
            'required-from status must be active and in the same journey',
          );
      }
      return tx.upsertFieldJourneySetting({
        organizationId: input.organizationId,
        fieldId: input.fieldId,
        journeyId: input.journeyId,
        requirement: requireOneOf(input.requirement, fieldRequirements, 'field requirement'),
        requiredFromStatusId: input.requiredFromStatusId ?? null,
      });
    });
  }
  async deleteFieldJourneySetting(input: {
    organizationId: string;
    actorUserId: string;
    fieldId: string;
    journeyId: string;
  }) {
    return this.deleteMapping(input, 'field_journey_setting', (tx) =>
      tx.deleteFieldJourneySetting(input.organizationId, input.fieldId, input.journeyId),
    );
  }
  async upsertFieldVisibility(input: {
    organizationId: string;
    actorUserId: string;
    fieldId: string;
    roleId: string;
    accessLevel: string;
  }) {
    return this.map(input, 'field_visibility', (tx) =>
      tx.upsertFieldVisibility({
        organizationId: input.organizationId,
        fieldId: input.fieldId,
        roleId: input.roleId,
        accessLevel: requireOneOf(input.accessLevel, fieldAccessLevels, 'field access level'),
      }),
    );
  }
  async deleteFieldVisibility(input: {
    organizationId: string;
    actorUserId: string;
    fieldId: string;
    roleId: string;
  }) {
    return this.deleteMapping(input, 'field_visibility', (tx) =>
      tx.deleteFieldVisibility(input.organizationId, input.fieldId, input.roleId),
    );
  }

  private async editPrimary(
    input: { organizationId: string; actorUserId: string; journeyId: string },
    entityType: 'journey',
    findOld: (tx: ConfigurationRepository) => Promise<ConfigRow | null>,
    write: (tx: ConfigurationRepository) => Promise<ConfigRow | null>,
  ) {
    return this.repository.transaction(async (tx) => {
      const oldValue = await requireFound(findOld(tx));
      const row = await requireFound(write(tx));
      await tx.writeSystemAudit(audit(input, entityType, input.journeyId, 'edit', oldValue, row));
      return row;
    });
  }

  private async map(
    input: { organizationId: string; actorUserId: string },
    entityType: 'journey_service' | 'field_journey_setting' | 'field_visibility',
    write: (tx: ConfigurationRepository) => Promise<ConfigRow>,
  ) {
    return this.repository.transaction(async (tx) => {
      const row = await write(tx);
      await tx.writeSystemAudit(audit(input, entityType, row.id, 'create', null, row));
      return row;
    });
  }
  private async deleteMapping(
    input: { organizationId: string; actorUserId: string },
    entityType: 'journey_service' | 'field_journey_setting' | 'field_visibility',
    remove: (tx: ConfigurationRepository) => Promise<ConfigRow | null>,
  ) {
    return this.repository.transaction(async (tx) => {
      const row = await requireFound(remove(tx));
      await tx.writeSystemAudit(audit(input, entityType, row.id, 'delete', row, null));
      return row;
    });
  }
}

function audit(
  input: { organizationId: string; actorUserId: string },
  entityType: Parameters<ConfigurationAuditWriter['writeSystemAudit']>[0]['entityType'],
  entityId: string,
  action: Parameters<ConfigurationAuditWriter['writeSystemAudit']>[0]['action'],
  oldValue: unknown,
  newValue: unknown,
) {
  return {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType,
    entityId,
    action,
    oldValue,
    newValue,
  };
}

async function requireFound<T>(value: Promise<T | null>): Promise<T> {
  const row = await value;
  if (row === null) throw new ConfigurationError('not_found', 'configuration record not found');
  return row;
}
