import { resolveAuthorization, type PermissionRepository } from '@falcon/permission-engine';

import type { AuthenticatedContext } from '../auth/middleware.js';
import { isConfigurationError } from '../configuration/errors.js';
import type { ConfigurationError } from '../configuration/errors.js';
import { ConfigurationService, type ConfigurationRepository } from '../configuration/service.js';

export const configurationModules = {
  journeys: 'journeys',
  statuses: 'statuses',
  services: 'services',
  fields: 'fields',
  journeyServices: 'journey_services',
  fieldJourneySettings: 'field_journey_settings',
  fieldVisibility: 'field_visibility',
} as const;

export type ConfigurationRouteResult =
  | { status: 200 | 201; body: unknown }
  | { status: 400 | 403 | 404 | 409; body: { error: string; details?: Record<string, unknown> } };

type ModuleName = (typeof configurationModules)[keyof typeof configurationModules];
type ActionName = 'create' | 'edit' | 'deactivate' | 'delete';

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
