/** Provider-independent authorization boundary for the Falcon permission engine workspace. */
export const workspaceName = '@falcon/permission-engine' as const;

export { createPermissionAuditPayload } from './audit-hooks.js';
export { resolveAuthorization } from './decision.js';
export { resolveFieldDecision } from './fields.js';
export { isGrantActive } from './grants.js';
export {
  assignmentScopeAllowsLead,
  buildRecordPredicate,
  expandScopeUserIds,
  expandTeamUserIds,
} from './scope.js';
export type * from './audit-hooks.js';
export type * from './types.js';
