import { resolveAuthorization, type PermissionRepository } from '@falcon/permission-engine';

import type { AuthenticatedContext } from '../auth/middleware.js';
import { isConfigurationError } from '../configuration/errors.js';
import type { ConfigurationError } from '../configuration/errors.js';
import { ConfigurationService, type ConfigurationRepository } from '../configuration/service.js';

export const configurationModules = {
  journeys: 'journeys_statuses',
  statuses: 'journeys_statuses',
  services: 'services',
  fields: 'fields',
  journeyServices: 'services',
  fieldJourneySettings: 'fields',
  fieldVisibility: 'roles_permissions',
} as const;

export type ConfigurationRouteResult =
  | { status: 200 | 201; body: unknown }
  | { status: 400 | 403 | 404 | 409; body: { error: string; details?: Record<string, unknown> } };

type ModuleName = (typeof configurationModules)[keyof typeof configurationModules];
type ActionName = 'create' | 'edit' | 'deactivate' | 'delete';

export async function readConfiguration(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  kind: 'journeys' | 'services' | 'fields';
  id?: string;
  page: number;
  pageSize: number;
  active?: boolean;
}): Promise<ConfigurationRouteResult> {
  const module = input.kind === 'journeys' ? 'journeys_statuses' : input.kind;
  const decision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module,
      action: 'view',
      // Deliberately no journeyId. Passing it made the engine check
      // RoleJourneyAccess, so a role holding journeys_statuses:view but no
      // grants got a 403 reading a journey it could see in the list — and the
      // web app reads a journey's statuses from this same route, so its status
      // pickers came back empty too. Record access is enforced on the lead
      // routes, where it belongs; this is the configuration catalog.
    },
  });
  if (!decision.allowed) return { status: 403, body: { error: 'forbidden' } };
  if (
    !Number.isInteger(input.page) ||
    input.page < 1 ||
    !Number.isInteger(input.pageSize) ||
    input.pageSize < 1 ||
    input.pageSize > 100
  )
    return { status: 400, body: { error: 'validation_error' } };
  const service = new ConfigurationService(input.configurationRepository);
  const organizationId = input.auth.user.organizationId;
  const body =
    input.kind === 'journeys'
      ? input.id
        ? await service.getJourney({ organizationId, journeyId: input.id, active: input.active })
        : await service.listJourneys({
            organizationId,
            active: input.active,
            page: input.page,
            pageSize: input.pageSize,
          })
      : input.kind === 'services'
        ? input.id
          ? await service.getService({ organizationId, serviceId: input.id, active: input.active })
          : await service.listServices({
              organizationId,
              active: input.active,
              page: input.page,
              pageSize: input.pageSize,
            })
        : input.id
          ? await service.getField({
              organizationId,
              fieldId: input.id,
              active: input.active,
            })
          : await service.listFields({
              organizationId,
              active: input.active,
              page: input.page,
              pageSize: input.pageSize,
            });
  return body === null ? { status: 404, body: { error: 'not_found' } } : { status: 200, body };
}

export async function createJourney(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  key: string;
  name: string;
  now?: Date;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.journeys,
    'create',
    undefined,
    (service) =>
      service.createJourney({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        key: input.key,
        name: input.name,
      }),
    201,
  );
}
export async function updateJourney(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  journeyId: string;
  name: string;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.journeys,
    'edit',
    input.journeyId,
    (service) =>
      service.updateJourney({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        journeyId: input.journeyId,
        name: input.name,
      }),
    200,
  );
}
export async function deactivateJourney(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  journeyId: string;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.journeys,
    'deactivate',
    input.journeyId,
    (service) =>
      service.deactivateJourney({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        journeyId: input.journeyId,
      }),
    200,
  );
}
export async function updateStatus(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  journeyId: string;
  statusId: string;
  name: string;
  outcomeType: string;
  behaviorType: string;
  sortOrder: number;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.statuses,
    'edit',
    input.journeyId,
    (service) =>
      service.updateStatus({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        journeyId: input.journeyId,
        statusId: input.statusId,
        name: input.name,
        outcomeType: input.outcomeType,
        behaviorType: input.behaviorType,
        sortOrder: input.sortOrder,
      }),
    200,
  );
}
export async function reorderStatuses(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  journeyId: string;
  statusIds: string[];
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.statuses,
    'edit',
    input.journeyId,
    (service) =>
      service.reorderStatuses({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        journeyId: input.journeyId,
        statusIds: input.statusIds,
      }),
    200,
  );
}
export async function deactivateStatus(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  journeyId: string;
  statusId: string;
  replacementStatusId?: string;
  now?: Date;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.statuses,
    'deactivate',
    input.journeyId,
    (service) =>
      service.deactivateStatus({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        statusId: input.statusId,
        ...(input.replacementStatusId === undefined
          ? {}
          : { replacementStatusId: input.replacementStatusId }),
      }),
    200,
  );
}
export async function createStatus(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  journeyId: string;
  key: string;
  name: string;
  outcomeType: string;
  behaviorType: string;
  sortOrder: number;
  now?: Date;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.statuses,
    'create',
    input.journeyId,
    (service) =>
      service.createStatus({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        journeyId: input.journeyId,
        key: input.key,
        name: input.name,
        outcomeType: input.outcomeType,
        behaviorType: input.behaviorType,
        sortOrder: input.sortOrder,
      }),
    201,
  );
}
export async function createService(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  key: string;
  name: string;
  description?: string | null;
  now?: Date;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.services,
    'create',
    undefined,
    (service) =>
      service.createService({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        key: input.key,
        name: input.name,
        ...(input.description === undefined ? {} : { description: input.description }),
      }),
    201,
  );
}
export async function deactivateService(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  serviceId: string;
  now?: Date;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.services,
    'deactivate',
    undefined,
    (service) =>
      service.deactivateService({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        serviceId: input.serviceId,
      }),
    200,
  );
}
export async function createField(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  key: string;
  name: string;
  fieldType: string;
  validationRule?: unknown;
  section?: string | null;
  editMode: string;
  source: string;
  now?: Date;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.fields,
    'create',
    undefined,
    (service) =>
      service.createField({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        key: input.key,
        name: input.name,
        fieldType: input.fieldType,
        ...(input.validationRule === undefined ? {} : { validationRule: input.validationRule }),
        ...(input.section === undefined ? {} : { section: input.section }),
        editMode: input.editMode,
        source: input.source,
      }),
    201,
  );
}
export async function deactivateField(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  fieldId: string;
  now?: Date;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.fields,
    'deactivate',
    undefined,
    (service) =>
      service.deactivateField({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        fieldId: input.fieldId,
      }),
    200,
  );
}
export async function updateField(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  fieldId: string;
  name: string;
  fieldType: string;
  validationRule?: unknown;
  section?: string | null;
  editMode: string;
  source: string;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.fields,
    'edit',
    undefined,
    (service) =>
      service.updateField({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        fieldId: input.fieldId,
        name: input.name,
        fieldType: input.fieldType,
        ...(input.validationRule === undefined ? {} : { validationRule: input.validationRule }),
        ...(input.section === undefined ? {} : { section: input.section }),
        editMode: input.editMode,
        source: input.source,
      }),
    200,
  );
}
export async function readJourneyFields(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  journeyId: string;
}): Promise<ConfigurationRouteResult> {
  const decision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module: 'fields',
      action: 'view',
      journeyId: input.journeyId,
    },
  });
  if (!decision.allowed) return { status: 403, body: { error: 'forbidden' } };
  return {
    status: 200,
    body: await new ConfigurationService(input.configurationRepository).listJourneyFieldSettings({
      organizationId: input.auth.user.organizationId,
      journeyId: input.journeyId,
    }),
  };
}
export async function upsertFieldJourneySetting(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  journeyId: string;
  fieldId: string;
  requirement: string;
  requiredFromStatusId?: string | null;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.fieldJourneySettings,
    'edit',
    input.journeyId,
    (service) =>
      service.upsertFieldJourneySetting({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        journeyId: input.journeyId,
        fieldId: input.fieldId,
        requirement: input.requirement,
        ...(input.requiredFromStatusId === undefined
          ? {}
          : { requiredFromStatusId: input.requiredFromStatusId }),
      }),
    200,
  );
}
export async function unmapFieldJourneySetting(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  journeyId: string;
  fieldId: string;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.fieldJourneySettings,
    'edit',
    input.journeyId,
    (service) =>
      service.deleteFieldJourneySetting({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        journeyId: input.journeyId,
        fieldId: input.fieldId,
      }),
    200,
  );
}
export async function mapJourneyService(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  journeyId: string;
  serviceId: string;
  now?: Date;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.journeyServices,
    'create',
    input.journeyId,
    (service) =>
      service.mapJourneyService({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        journeyId: input.journeyId,
        serviceId: input.serviceId,
      }),
    201,
  );
}
export async function unmapJourneyService(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  journeyId: string;
  serviceId: string;
  now?: Date;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.journeyServices,
    'delete',
    input.journeyId,
    (service) =>
      service.unmapJourneyService({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        journeyId: input.journeyId,
        serviceId: input.serviceId,
      }),
    200,
  );
}
export async function upsertFieldVisibility(input: {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  configurationRepository: ConfigurationRepository;
  fieldId: string;
  roleId: string;
  accessLevel: string;
  now?: Date;
}): Promise<ConfigurationRouteResult> {
  return mutate(
    input,
    configurationModules.fieldVisibility,
    'edit',
    undefined,
    (service) =>
      service.upsertFieldVisibility({
        organizationId: input.auth.user.organizationId,
        actorUserId: input.auth.user.id,
        fieldId: input.fieldId,
        roleId: input.roleId,
        accessLevel: input.accessLevel,
      }),
    200,
  );
}

async function mutate(
  input: {
    auth: AuthenticatedContext;
    permissionRepository: PermissionRepository;
    configurationRepository: ConfigurationRepository;
    now?: Date;
  },
  module: ModuleName,
  action: ActionName,
  journeyId: string | undefined,
  work: (service: ConfigurationService) => Promise<unknown>,
  successStatus: 200 | 201,
): Promise<ConfigurationRouteResult> {
  const decision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module,
      action,
      ...(journeyId === undefined ? {} : { journeyId }),
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  });
  if (!decision.allowed) return { status: 403, body: { error: 'forbidden' } };
  try {
    return {
      status: successStatus,
      body: await work(new ConfigurationService(input.configurationRepository)),
    };
  } catch (error) {
    if (!isConfigurationError(error)) throw error;
    return toResponse(error);
  }
}

function toResponse(error: ConfigurationError): ConfigurationRouteResult {
  const status =
    error.code === 'not_found'
      ? 404
      : error.code === 'dependency_conflict'
        ? 409
        : error.code === 'forbidden'
          ? 403
          : 400;
  return {
    status,
    body: {
      error: error.code,
      ...(Object.keys(error.details).length === 0 ? {} : { details: error.details }),
    },
  };
}
