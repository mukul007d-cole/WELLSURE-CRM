import { resolveFieldDecision } from './fields.js';
import {
  assignmentScopeAllowsLead,
  buildRecordPredicate,
  expandScopeUserIds,
  expandTeamUserIds,
} from './scope.js';
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

  const accessibleJourneyIds =
    input.request.journeyId === undefined
      ? await input.repository.listAccessibleJourneyIds({
          roleId: role.id,
          organizationId: input.request.organizationId,
        })
      : [];
  const journeyAllowed =
    input.request.journeyId === undefined
      ? true
      : await input.repository.hasJourneyAccess({
          roleId: role.id,
          organizationId: input.request.organizationId,
          journeyId: input.request.journeyId,
        });
  const predicateJourneyIds =
    input.request.journeyId === undefined ? accessibleJourneyIds : [input.request.journeyId];
  if (!journeyAllowed) {
    deniedReasons.push('JOURNEY_DENIED');
  }

  /*
   * Status Visibility (Phase 19, reworked Phase 20): routing decides
   * visibility. A Status with no active routing rule is unrestricted,
   * exactly Phase 19's "absence means unrestricted" default, now keyed off
   * routing rather than a separate allow-list. Once a Status has an active
   * rule, only the lead's current assignee and that assignee's
   * reporting-hierarchy ancestors (any depth, via `manager_id` — the same
   * relation `TEAM` scope already resolves, ADR-0006) may see it — no Role
   * plays any part in this check. `assignments`/`hierarchyUserIds` are
   * computed lazily and shared with the `recordAllowed` block below so a
   * request naming both a Status and a lead pays for each lookup once.
   *
   * ADR-0021's backstop is checked once, up front: a Role holding
   * `leads:bypass_status_visibility` skips this narrowing entirely, on
   * every request, so it never pays the routing-rule lookup or the
   * hierarchy walk for the single-record form of this check below.
   */
  const statusVisibilityBypass = await input.repository.hasStatusVisibilityBypass({
    roleId: role.id,
    organizationId: input.request.organizationId,
  });

  let assignmentsPromise: Promise<
    Awaited<ReturnType<PermissionRepository['listCurrentAssignments']>>
  > | null = null;
  const loadCurrentAssignments = () => {
    assignmentsPromise ??=
      input.request.leadId === undefined
        ? Promise.resolve([])
        : input.repository.listCurrentAssignments({
            organizationId: input.request.organizationId,
            assignmentTypes,
            journeyIds: predicateJourneyIds,
          });
    return assignmentsPromise;
  };
  let hierarchyUserIdsPromise: Promise<readonly string[]> | null = null;
  const loadHierarchyUserIds = () => {
    hierarchyUserIdsPromise ??= expandTeamUserIds(input.repository, user);
    return hierarchyUserIdsPromise;
  };

  const statusVisible = await (async () => {
    if (input.request.statusId === undefined) return true;
    if (statusVisibilityBypass) return true;
    const hasActiveRoutingRule = await input.repository.hasActiveRoutingRule({
      organizationId: input.request.organizationId,
      statusId: input.request.statusId,
    });
    if (!hasActiveRoutingRule) return true;
    if (input.request.leadId === undefined) return true;
    return assignmentScopeAllowsLead({
      assignments: await loadCurrentAssignments(),
      leadId: input.request.leadId,
      organizationId: input.request.organizationId,
      assignmentTypes,
      allowedUserIds: await loadHierarchyUserIds(),
      journeyIds: predicateJourneyIds,
    });
  })();
  if (!statusVisible) {
    deniedReasons.push('STATUS_VISIBILITY_DENIED');
  }

  const fieldVisibility = await input.repository.getFieldVisibility({
    roleId: role.id,
    organizationId: input.request.organizationId,
    fieldIds: [...requestedFieldIds, ...requestedEditFieldIds],
    ...(input.request.journeyId === undefined ? {} : { journeyId: input.request.journeyId }),
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
    const allowedUserIds =
      effectiveScope === 'TEAM'
        ? await loadHierarchyUserIds()
        : await expandScopeUserIds({
            repository: input.repository,
            user,
            scope: effectiveScope,
          });
    recordPredicate = buildRecordPredicate({
      organizationId: input.request.organizationId,
      scope: effectiveScope,
      allowedUserIds,
      assignmentTypes,
      journeyIds: predicateJourneyIds,
      userId: user.id,
      action: input.request.action,
      hierarchyUserIds: await loadHierarchyUserIds(),
      bypassesStatusVisibility: statusVisibilityBypass,
    });

    if (input.request.leadId !== undefined) {
      const assignments = await loadCurrentAssignments();
      recordAllowed = assignmentScopeAllowsLead({
        assignments,
        leadId: input.request.leadId,
        organizationId: input.request.organizationId,
        assignmentTypes,
        allowedUserIds,
        journeyIds: predicateJourneyIds,
      });

      const grant = await input.repository.getActiveDirectGrant({
        organizationId: input.request.organizationId,
        userId: user.id,
        leadId: input.request.leadId,
        now,
        action: input.request.action,
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
    ...(request.journeyId === undefined ? {} : { journeyId: request.journeyId }),
    effectiveScope: resolved.effectiveScope,
    journeyAllowed: resolved.journeyAllowed,
    recordAllowed: resolved.recordAllowed,
    directGrantId: resolved.directGrantId,
    fields: resolved.fields,
    recordPredicate: resolved.recordPredicate,
    workflowCheck: resolved.workflowCheck,
  };
}
