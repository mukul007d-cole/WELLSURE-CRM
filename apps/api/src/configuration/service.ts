import { nextAvailableKey, type ReferenceableField } from '@falcon/validation';

import type { ConfigurationAuditWriter, LeadActivityWriter } from './audit.js';
import { ConfigurationError } from './errors.js';
import {
  fieldAccessLevels,
  fieldEditModes,
  fieldRequirements,
  fieldSources,
  isRecordObject,
  requireCalculationConfig,
  requireConfigKey,
  requireFieldValidationRule,
  requireNonBlank,
  requireNonNegativeInteger,
  requireOneOf,
  requireSystemKey,
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
  listJourneys(
    organizationId: string,
    active: boolean | undefined,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; items: ConfigRow[] }>;
  getJourneyDetail(organizationId: string, id: string, active?: boolean): Promise<ConfigRow | null>;
  listJourneyAssignmentTypes(organizationId: string, journeyId: string): Promise<string[]>;
  grantJourneyAccessToConfigRoles(organizationId: string, journeyId: string): Promise<string[]>;
  /** Journey `key` is unique per organization. */
  journeyKeyExists(organizationId: string, key: string): Promise<boolean>;
  /** Status `key` is unique per Journey, not per organization — see the schema's `@@unique`. */
  statusKeyExists(organizationId: string, journeyId: string, key: string): Promise<boolean>;
  /** Service `key` is unique per organization. */
  serviceKeyExists(organizationId: string, key: string): Promise<boolean>;
  /** Field `key` is unique per organization. */
  fieldKeyExists(organizationId: string, key: string): Promise<boolean>;
  listServices(
    organizationId: string,
    active: boolean | undefined,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; items: ConfigRow[] }>;
  getServiceDetail(organizationId: string, id: string, active?: boolean): Promise<ConfigRow | null>;
  listFields(
    organizationId: string,
    active: boolean | undefined,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; items: ConfigRow[] }>;
  getFieldDetail(
    organizationId: string,
    id: string,
    active: boolean | undefined,
  ): Promise<ConfigRow | null>;
  /** For validating a calculated Field's config: every active Field's id/type/editMode. */
  listFieldSummaries(
    organizationId: string,
  ): Promise<Array<{ id: string; fieldType: string; editMode: string; active: boolean }>>;
  listJourneyFieldSettings(organizationId: string, journeyId: string): Promise<ConfigRow[]>;
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

  listJourneys(input: {
    organizationId: string;
    active: boolean | undefined;
    page: number;
    pageSize: number;
  }) {
    return this.repository
      .listJourneys(input.organizationId, input.active, input.page, input.pageSize)
      .then((x) => ({ page: input.page, pageSize: input.pageSize, ...x }));
  }
  async getJourney(input: {
    organizationId: string;
    journeyId: string;
    active: boolean | undefined;
  }) {
    const journey = await this.repository.getJourneyDetail(
      input.organizationId,
      input.journeyId,
      input.active,
    );
    if (journey === null) return null;
    // Additive and read-only: clients that assign users need to know which
    // assignment types this Journey actually uses, and no other endpoint
    // exposes them.
    const assignmentTypes = await this.repository.listJourneyAssignmentTypes(
      input.organizationId,
      input.journeyId,
    );
    return { ...journey, assignmentTypes };
  }
  listServices(input: {
    organizationId: string;
    active: boolean | undefined;
    page: number;
    pageSize: number;
  }) {
    return this.repository
      .listServices(input.organizationId, input.active, input.page, input.pageSize)
      .then((x) => ({ page: input.page, pageSize: input.pageSize, ...x }));
  }
  getService(input: { organizationId: string; serviceId: string; active: boolean | undefined }) {
    return this.repository.getServiceDetail(input.organizationId, input.serviceId, input.active);
  }
  listFields(input: {
    organizationId: string;
    active: boolean | undefined;
    page: number;
    pageSize: number;
  }) {
    return this.repository
      .listFields(input.organizationId, input.active, input.page, input.pageSize)
      .then((x) => ({ page: input.page, pageSize: input.pageSize, ...x }));
  }
  getField(input: { organizationId: string; fieldId: string; active: boolean | undefined }) {
    return this.repository.getFieldDetail(input.organizationId, input.fieldId, input.active);
  }

  async createJourney(input: { organizationId: string; actorUserId: string; name: string }) {
    return this.repository.transaction(async (tx) => {
      const name = requireNonBlank(input.name, 'journey name');
      const key = requireConfigKey(
        await nextAvailableKey(name, (candidate) =>
          tx.journeyKeyExists(input.organizationId, candidate),
        ),
      );
      const row = await tx.createJourney({
        organizationId: input.organizationId,
        key,
        name,
        createdById: input.actorUserId,
        updatedById: input.actorUserId,
      });
      await tx.writeSystemAudit(audit(input, 'journey', row.id, 'create', null, row));

      // Without this the Journey is visible to nobody, because access is an
      // explicit allow-list that creation never populated. Audited separately:
      // it grants visibility, and journey access gates which Leads a role sees.
      const grantedRoleIds = await tx.grantJourneyAccessToConfigRoles(input.organizationId, row.id);
      if (grantedRoleIds.length > 0) {
        await tx.writeSystemAudit(
          audit(input, 'journey', row.id, 'edit', null, { grantedRoleIds }),
        );
      }
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
    name: string;
    outcomeType: string;
    behaviorType: string;
    sortOrder: number;
  }) {
    return this.repository.transaction(async (tx) => {
      await requireFound(tx.findJourney(input.organizationId, input.journeyId));
      const name = requireNonBlank(input.name, 'status name');
      const key = requireConfigKey(
        await nextAvailableKey(name, (candidate) =>
          tx.statusKeyExists(input.organizationId, input.journeyId, candidate),
        ),
      );
      const row = await tx.createStatus({
        organizationId: input.organizationId,
        journeyId: input.journeyId,
        key,
        name,
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

  async updateStatus(input: {
    organizationId: string;
    actorUserId: string;
    journeyId: string;
    statusId: string;
    name: string;
    outcomeType: string;
    behaviorType: string;
    sortOrder: number;
  }) {
    return this.repository.transaction(async (tx) => {
      const oldValue = await requireFound(tx.findStatus(input.organizationId, input.statusId));
      if (oldValue.journeyId !== input.journeyId)
        throw new ConfigurationError('not_found', 'configuration record not found');
      const row = await requireFound(
        tx.updateStatus(input.organizationId, input.statusId, {
          name: requireNonBlank(input.name, 'status name'),
          outcomeType: requireOneOf(input.outcomeType, statusOutcomeTypes, 'outcome type'),
          behaviorType: requireOneOf(input.behaviorType, statusBehaviorTypes, 'behavior type'),
          sortOrder: requireNonNegativeInteger(input.sortOrder, 'sort order'),
          updatedById: input.actorUserId,
        }),
      );
      await tx.writeSystemAudit(audit(input, 'status', input.statusId, 'edit', oldValue, row));
      return row;
    });
  }

  async reorderStatuses(input: {
    organizationId: string;
    actorUserId: string;
    journeyId: string;
    statusIds: string[];
  }) {
    if (new Set(input.statusIds).size !== input.statusIds.length)
      throw new ConfigurationError('validation_error', 'statusIds must be unique');
    return this.repository.transaction(async (tx) => {
      const current = await Promise.all(
        input.statusIds.map((id) => requireFound(tx.findStatus(input.organizationId, id))),
      );
      if (current.some((row) => row.journeyId !== input.journeyId))
        throw new ConfigurationError('validation_error', 'all statuses must belong to the journey');
      const rows: ConfigRow[] = [];
      for (const [sortOrder, oldValue] of current.entries()) {
        const row = await requireFound(
          tx.updateStatus(input.organizationId, oldValue.id, {
            sortOrder,
            updatedById: input.actorUserId,
          }),
        );
        await tx.writeSystemAudit(audit(input, 'status', oldValue.id, 'reorder', oldValue, row));
        rows.push(row);
      }
      return rows;
    });
  }

  async createService(input: {
    organizationId: string;
    actorUserId: string;
    name: string;
    description?: string | null;
  }) {
    return this.repository.transaction(async (tx) => {
      const name = requireNonBlank(input.name, 'service name');
      const key = requireConfigKey(
        await nextAvailableKey(name, (candidate) =>
          tx.serviceKeyExists(input.organizationId, candidate),
        ),
      );
      const row = await tx.createService({
        organizationId: input.organizationId,
        key,
        name,
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
    name: string;
    fieldType: string;
    validationRule?: unknown;
    section?: string | null;
    editMode: string;
    source: string;
    /** Required when editMode is 'calculated'; rejected otherwise. */
    calculation?: unknown;
    /** Required when editMode is 'system'; rejected otherwise. Free-text key only — see `requireSystemKey`. */
    system?: unknown;
    /**
     * Defaults to append-to-end when omitted — unlike Status, where the admin
     * UI always computes and sends it, a Field's order is new enough that most
     * callers (existing tests among them) have no opinion on it.
     */
    sortOrder?: number;
  }) {
    return this.repository.transaction(async (tx) => {
      const name = requireNonBlank(input.name, 'field name');
      const key = requireConfigKey(
        await nextAvailableKey(name, (candidate) =>
          tx.fieldKeyExists(input.organizationId, candidate),
        ),
      );
      const fieldType = requireNonBlank(input.fieldType, 'field type');
      const editMode = requireOneOf(input.editMode, fieldEditModes, 'edit mode');
      const validationRule = await this.withModeConfig(tx, {
        organizationId: input.organizationId,
        fieldType,
        editMode,
        ownFieldId: null,
        baseValidationRule: requireFieldValidationRule(fieldType, input.validationRule),
        calculation: input.calculation,
        system: input.system,
      });
      const sortOrder =
        input.sortOrder === undefined
          ? (await tx.listFieldSummaries(input.organizationId)).length
          : requireNonNegativeInteger(input.sortOrder, 'sort order');
      const row = await tx.createField({
        organizationId: input.organizationId,
        key,
        name,
        fieldType,
        validationRule,
        section: input.section ?? null,
        editMode,
        source: requireOneOf(input.source, fieldSources, 'source'),
        sortOrder,
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

  async updateField(input: {
    organizationId: string;
    actorUserId: string;
    fieldId: string;
    name: string;
    fieldType: string;
    validationRule?: unknown;
    section?: string | null;
    editMode: string;
    source: string;
    calculation?: unknown;
    system?: unknown;
  }) {
    return this.repository.transaction(async (tx) => {
      const oldValue = await requireFound(tx.findField(input.organizationId, input.fieldId));
      const fieldType = requireNonBlank(input.fieldType, 'field type');
      const editMode = requireOneOf(input.editMode, fieldEditModes, 'edit mode');
      const validationRule = await this.withModeConfig(tx, {
        organizationId: input.organizationId,
        fieldType,
        editMode,
        ownFieldId: input.fieldId,
        baseValidationRule: requireFieldValidationRule(fieldType, input.validationRule),
        calculation: input.calculation,
        system: input.system,
      });
      const row = await requireFound(
        tx.updateField(input.organizationId, input.fieldId, {
          name: requireNonBlank(input.name, 'field name'),
          fieldType,
          validationRule,
          section: input.section ?? null,
          editMode,
          source: requireOneOf(input.source, fieldSources, 'source'),
          updatedById: input.actorUserId,
        }),
      );
      await tx.writeSystemAudit(audit(input, 'field', input.fieldId, 'edit', oldValue, row));
      return row;
    });
  }

  /** Mirrors `reorderStatuses` exactly — see there for why one bulk call, not N `updateField`s. */
  async reorderFields(input: { organizationId: string; actorUserId: string; fieldIds: string[] }) {
    if (new Set(input.fieldIds).size !== input.fieldIds.length)
      throw new ConfigurationError('validation_error', 'fieldIds must be unique');
    return this.repository.transaction(async (tx) => {
      const current = await Promise.all(
        input.fieldIds.map((id) => requireFound(tx.findField(input.organizationId, id))),
      );
      const rows: ConfigRow[] = [];
      for (const [sortOrder, oldValue] of current.entries()) {
        const row = await requireFound(
          tx.updateField(input.organizationId, oldValue.id, {
            sortOrder,
            updatedById: input.actorUserId,
          }),
        );
        await tx.writeSystemAudit(audit(input, 'field', oldValue.id, 'reorder', oldValue, row));
        rows.push(row);
      }
      return rows;
    });
  }

  /**
   * Folds a calculated/system Field's config into its `validationRule` JSON
   * — there's no dedicated column, same as `select`'s `options`. Refuses the
   * config when it doesn't match `editMode` in either direction: providing
   * one for the wrong mode is caller error, not something to silently drop.
   */
  private async withModeConfig(
    repository: ConfigurationRepository,
    input: {
      organizationId: string;
      fieldType: string;
      editMode: string;
      ownFieldId: string | null;
      baseValidationRule: unknown;
      calculation?: unknown;
      system?: unknown;
    },
  ): Promise<unknown> {
    let validationRule = input.baseValidationRule;
    if (input.editMode === 'calculated') {
      const referenceable = await this.referenceableFields(repository, input.organizationId);
      const calculation = requireCalculationConfig({
        raw: input.calculation,
        fieldType: input.fieldType,
        ownFieldId: input.ownFieldId,
        referenceable,
      });
      validationRule = {
        ...(isRecordObject(validationRule) ? validationRule : {}),
        calculation,
      };
    } else if (input.calculation !== undefined) {
      throw new ConfigurationError(
        'validation_error',
        'calculation config is only valid when edit mode is calculated',
      );
    }
    if (input.editMode === 'system') {
      const key = requireSystemKey(input.system);
      validationRule = {
        ...(isRecordObject(validationRule) ? validationRule : {}),
        system: { key },
      };
    } else if (input.system !== undefined) {
      throw new ConfigurationError(
        'validation_error',
        'system config is only valid when edit mode is system',
      );
    }
    return validationRule;
  }

  private async referenceableFields(
    repository: ConfigurationRepository,
    organizationId: string,
  ): Promise<ReadonlyMap<string, ReferenceableField>> {
    const fields = await repository.listFieldSummaries(organizationId);
    return new Map(
      fields.map((field) => [
        field.id,
        { fieldType: field.fieldType, editMode: field.editMode, active: field.active },
      ]),
    );
  }

  listJourneyFieldSettings(input: { organizationId: string; journeyId: string }) {
    return this.repository.listJourneyFieldSettings(input.organizationId, input.journeyId);
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
