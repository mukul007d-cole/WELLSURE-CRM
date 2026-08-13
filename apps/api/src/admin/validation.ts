import { isDataScope, isPermissionPair } from '@falcon/permission-engine';

import { AdminError } from './errors.js';
import type {
  FieldVisibilityInput,
  PageRequest,
  PermissionInput,
  RoleVisibilityInput,
  TeamMemberInput,
} from './types.js';

export function pagination(page: unknown, pageSize: unknown): PageRequest {
  const parsedPage = Number(page ?? 1);
  const parsedSize = Number(pageSize ?? 25);
  if (
    !Number.isInteger(parsedPage) ||
    parsedPage < 1 ||
    !Number.isInteger(parsedSize) ||
    parsedSize < 1 ||
    parsedSize > 100
  )
    throw new AdminError(
      'validation_error',
      'page must be positive and pageSize must be between 1 and 100',
    );
  return { page: parsedPage, pageSize: parsedSize };
}

export function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new AdminError('validation_error', `${field} is required`);
  return value.trim();
}

export function configKey(value: unknown): string {
  const key = text(value, 'key');
  if (!/^[a-z][a-z0-9_]*$/.test(key))
    throw new AdminError('validation_error', 'key must be a stable lowercase identifier');
  return key;
}

export function permissions(value: unknown): PermissionInput[] {
  if (!Array.isArray(value))
    throw new AdminError('validation_error', 'permissions must be an array');
  const result = value.map((item) => {
    const row = item as Record<string, unknown>;
    const module = text(row.module, 'module');
    const action = text(row.action, 'action');
    const scope = text(row.scope, 'scope');
    if (!isPermissionPair(module, action) || !isDataScope(scope))
      throw new AdminError('validation_error', 'unknown permission or scope');
    return { module, action, scope };
  });
  unique(
    result.map((row) => `${row.module}:${row.action}`),
    'duplicate permission',
  );
  return result.sort((a, b) => `${a.module}:${a.action}`.localeCompare(`${b.module}:${b.action}`));
}

export function ids(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || id === ''))
    throw new AdminError('validation_error', `${field} must be an array of IDs`);
  const result = value.map((id) => String(id));
  unique(result, `duplicate ${field}`);
  return result.sort();
}

export function visibility(value: unknown): FieldVisibilityInput[] {
  if (!Array.isArray(value))
    throw new AdminError('validation_error', 'fieldVisibility must be an array');
  const result = value.map((item) => {
    const row = item as Record<string, unknown>;
    const fieldId = text(row.fieldId, 'fieldId');
    const access = text(row.accessLevel, 'accessLevel');
    if (access !== 'VIEW' && access !== 'EDIT')
      throw new AdminError('validation_error', 'accessLevel must be VIEW or EDIT');
    const accessLevel: 'VIEW' | 'EDIT' = access;
    return { fieldId, accessLevel };
  });
  unique(
    result.map((row) => row.fieldId),
    'duplicate fieldId',
  );
  return result.sort((a, b) => a.fieldId.localeCompare(b.fieldId));
}

/**
 * The Field-side transpose of `visibility`: one field's access for a set of
 * roles. Same row shape, same access levels, opposite key.
 */
export function roleVisibility(value: unknown): RoleVisibilityInput[] {
  if (!Array.isArray(value))
    throw new AdminError('validation_error', 'visibility must be an array');
  const result = value.map((item) => {
    const row = item as Record<string, unknown>;
    const roleId = text(row.roleId, 'roleId');
    const access = text(row.accessLevel, 'accessLevel');
    if (access !== 'VIEW' && access !== 'EDIT')
      throw new AdminError('validation_error', 'accessLevel must be VIEW or EDIT');
    const accessLevel: 'VIEW' | 'EDIT' = access;
    return { roleId, accessLevel };
  });
  unique(
    result.map((row) => row.roleId),
    'duplicate roleId',
  );
  return result.sort((a, b) => a.roleId.localeCompare(b.roleId));
}

/**
 * A Team's complete member set.
 *
 * At least one member must be a leader. This system already refuses states with
 * no accountable party — `replacePermissions` rejects a replacement leaving no
 * permission administrator — and a Team nobody leads is the same shape of
 * mistake. The rule binds *configuration*: it is enforced here and on every
 * write path an admin drives. A leader later leaving the Department is not a
 * configuration act, and the repository resolves that case by deactivating the
 * team rather than by refusing the personnel change (see ADR-0014).
 */
export function teamMembers(value: unknown): TeamMemberInput[] {
  if (!Array.isArray(value)) throw new AdminError('validation_error', 'members must be an array');
  const result = value.map((item) => {
    const row = item as Record<string, unknown>;
    const userId = text(row.userId, 'userId');
    if (row.isLeader !== undefined && typeof row.isLeader !== 'boolean')
      throw new AdminError('validation_error', 'isLeader must be a boolean');
    return { userId, isLeader: row.isLeader === true };
  });
  unique(
    result.map((row) => row.userId),
    'duplicate userId',
  );
  if (!result.some((row) => row.isLeader))
    throw new AdminError('validation_error', 'a Team requires at least one Team Leader');
  return result.sort((a, b) => a.userId.localeCompare(b.userId));
}

function unique(values: string[], message: string): void {
  if (new Set(values).size !== values.length) throw new AdminError('validation_error', message);
}
