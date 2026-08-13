import { isRoutingAlgorithm, type RoutingAlgorithm } from './algorithms.js';
import { RoutingError } from './errors.js';

export const routingActions = ['view', 'configure', 'operate'] as const;
export type RoutingAction = (typeof routingActions)[number];

export interface RuleInput {
  assignmentType: string;
  algorithm: RoutingAlgorithm;
  poolType: 'team' | 'users';
  teamId: string | null;
  userIds: string[];
}

export interface RoutingGrantInput {
  roleId: string;
  action: RoutingAction;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new RoutingError('validation_error', `${field} is required`);
  return value.trim();
}

/**
 * A complete routing rule.
 *
 * `assignmentType` is free text on purpose. `assignments.assignment_type` is
 * configurable throughout this system and `GET /journeys/:id` derives its
 * `assignmentTypes` list from rows that already exist — on a Journey with no
 * leads that list is empty, so a rule could never be created if this were a
 * picker over a closed set. `docs/api/endpoints.md` is explicit that the API
 * must not invent a canonical owner string.
 */
export function parseRule(body: Record<string, unknown>): RuleInput {
  const assignmentType = text(body.assignmentType, 'assignmentType');
  const algorithm = text(body.algorithm, 'algorithm');
  if (!isRoutingAlgorithm(algorithm))
    throw new RoutingError('validation_error', 'unknown routing algorithm');

  const poolType = text(body.poolType, 'poolType');
  if (poolType !== 'team' && poolType !== 'users')
    throw new RoutingError('validation_error', 'poolType must be team or users');

  if (poolType === 'team') {
    // Carrying both a team and a user list would leave the real pool ambiguous;
    // the database refuses it too, and a 400 explaining it beats a constraint
    // violation surfacing as a 500.
    if (Array.isArray(body.userIds) && body.userIds.length > 0)
      throw new RoutingError('validation_error', 'a team pool cannot also carry a user list');
    return {
      assignmentType,
      algorithm,
      poolType,
      teamId: text(body.teamId, 'teamId'),
      userIds: [],
    };
  }

  if (typeof body.teamId === 'string' && body.teamId !== '')
    throw new RoutingError('validation_error', 'a user pool cannot also carry a teamId');
  if (!Array.isArray(body.userIds))
    throw new RoutingError('validation_error', 'userIds must be an array');
  const userIds = body.userIds.map((id, index) => text(id, `userIds[${index}]`));
  if (userIds.length === 0)
    throw new RoutingError('validation_error', 'a user pool needs at least one member');
  if (new Set(userIds).size !== userIds.length)
    throw new RoutingError('validation_error', 'duplicate userId');
  return { assignmentType, algorithm, poolType, teamId: null, userIds: [...userIds].sort() };
}

/** One Status's complete set of per-role routing grants. */
export function parseGrants(value: unknown): RoutingGrantInput[] {
  if (!Array.isArray(value))
    throw new RoutingError('validation_error', 'permissions must be an array');
  const rows = value.map((item) => {
    const row = item as Record<string, unknown>;
    const roleId = text(row.roleId, 'roleId');
    const action = text(row.action, 'action');
    if (!(routingActions as readonly string[]).includes(action))
      throw new RoutingError('validation_error', 'unknown routing action');
    return { roleId, action: action as RoutingAction };
  });
  const keys = rows.map((row) => `${row.roleId}:${row.action}`);
  if (new Set(keys).size !== keys.length)
    throw new RoutingError('validation_error', 'duplicate role grant');
  return rows.sort((a, b) => `${a.roleId}:${a.action}`.localeCompare(`${b.roleId}:${b.action}`));
}
