import { resolveFieldDecision } from './fields.js';
import { assignmentScopeAllowsLead, buildRecordPredicate, expandScopeUserIds } from './scope.js';
import type {
  AuthorizationDecision,
  AuthorizationRequest,
  DataScope,
  FieldDecision,
  PermissionDeniedReason,
  PermissionRepository,
  RecordPredicate,
} from './types.js';

const emptyFields: FieldDecision = {
  visibleFieldIds: [],
  editableFieldIds: [],
  strippedFieldIds: [],
  rejectedEditFieldIds: [],
};

export async function resolveAuthorization(input: {
  repository: PermissionRepository;
  request: AuthorizationRequest;
}): Promise<AuthorizationDecision> {
  const now = input.request.now ?? new Date();
  const deniedReasons: PermissionDeniedReason[] = [];
  const workflowCheck = { status: 'not_enforced' } as const;
  const requestedFieldIds = input.request.requestedFieldIds ?? [];
  const requestedEditFieldIds = input.request.requestedEditFieldIds ?? [];
  const assignmentTypes = input.request.assignmentTypes ?? [];

  const user = await input.repository.getUser(input.request.userId, input.request.organizationId);
  if (user === null || !user.active) {
    deniedReasons.push('USER_INACTIVE');
    return buildDecision(input.request, deniedReasons, {
      roleId: user?.roleId ?? null,
      roleVersion: null,
      effectiveScope: null,
      journeyAllowed: false,
      recordAllowed: false,
      directGrantId: null,
      fields: emptyFields,
      recordPredicate: null,
      workflowCheck,
    });
  }

  const role = await input.repository.getRole(user.roleId, input.request.organizationId);
  if (role === null || !role.active) {
    deniedReasons.push('ROLE_INACTIVE');
    return buildDecision(input.request, deniedReasons, {
      roleId: user.roleId,
      roleVersion: role?.version ?? null,
      effectiveScope: null,
      journeyAllowed: false,
      recordAllowed: false,
      directGrantId: null,
      fields: emptyFields,
      recordPredicate: null,
      workflowCheck,
    });
  }

  const permission = await input.repository.getRolePermission({
    roleId: role.id,
    organizationId: input.request.organizationId,
    module: input.request.module,
    action: input.request.action,
  });

  if (permission === null) {
    deniedReasons.push('FEATURE_ACTION_DENIED');
  }

  const journeyAllowed = await input.repository.hasJourneyAccess({
    roleId: role.id,
    organizationId: input.request.organizationId,
    journeyId: input.request.journeyId,
  });
  if (!journeyAllowed) {
    deniedReasons.push('JOURNEY_DENIED');
  }

  const fieldVisibility = await input.repository.getFieldVisibility({
    roleId: role.id,
    organizationId: input.request.organizationId,
    fieldIds: [...requestedFieldIds, ...requestedEditFieldIds],
  });
  const fields = resolveFieldDecision({
    requestedFieldIds,
    requestedEditFieldIds,
    visibility: fieldVisibility,
  });
  if (fields.strippedFieldIds.length > 0) {
    deniedReasons.push('FIELD_VIEW_DENIED');
  }
  if (fields.rejectedEditFieldIds.length > 0) {
    deniedReasons.push('FIELD_EDIT_DENIED');
  }

  const effectiveScope = permission?.scope ?? null;
  let recordAllowed = input.request.leadId === undefined;
  let directGrantId: string | null = null;
  let recordPredicate: RecordPredicate | null = null;

  if (effectiveScope !== null) {
    const allowedUserIds = await expandScopeUserIds({
      repository: input.repository,
      user,
      scope: effectiveScope,
    });
    recordPredicate = buildRecordPredicate({
      organizationId: input.request.organizationId,
      scope: effectiveScope,
      allowedUserIds,
      assignmentTypes,
      userId: user.id,
    });

    if (input.request.leadId !== undefined) {
      const assignments = await input.repository.listCurrentAssignments({
        organizationId: input.request.organizationId,
        assignmentTypes,
      });
      recordAllowed = assignmentScopeAllowsLead({
        assignments,
        leadId: input.request.leadId,
        organizationId: input.request.organizationId,
        assignmentTypes,
        allowedUserIds,
      });

      const grant = await input.repository.getActiveDirectGrant({
        organizationId: input.request.organizationId,
        userId: user.id,
        leadId: input.request.leadId,
        now,
      });
      if (grant !== null) {
        recordAllowed = true;
        directGrantId = grant.id;
      }
    }
  }

  if (!recordAllowed) {
    deniedReasons.push('RECORD_SCOPE_DENIED');
  }

  return buildDecision(input.request, deniedReasons, {
    roleId: role.id,
    roleVersion: role.version,
    effectiveScope,
    journeyAllowed,
    recordAllowed,
    directGrantId,
    fields,
    recordPredicate,
    workflowCheck,
  });
}

function buildDecision(
  request: AuthorizationRequest,
  deniedReasons: readonly PermissionDeniedReason[],
  resolved: {
    roleId: string | null;
    roleVersion: number | null;
    effectiveScope: DataScope | null;
    journeyAllowed: boolean;
    recordAllowed: boolean;
    directGrantId: string | null;
    fields: FieldDecision;
    recordPredicate: RecordPredicate | null;
    workflowCheck: { status: 'not_enforced' };
  },
): AuthorizationDecision {
  return {
    allowed: deniedReasons.length === 0,
    deniedReasons,
    userId: request.userId,
    organizationId: request.organizationId,
    roleId: resolved.roleId,
    roleVersion: resolved.roleVersion,
    module: request.module,
    action: request.action,
    journeyId: request.journeyId,
    effectiveScope: resolved.effectiveScope,
    journeyAllowed: resolved.journeyAllowed,
    recordAllowed: resolved.recordAllowed,
    directGrantId: resolved.directGrantId,
    fields: resolved.fields,
    recordPredicate: resolved.recordPredicate,
    workflowCheck: resolved.workflowCheck,
  };
}
