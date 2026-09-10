import { StatusVisibilityError } from './errors.js';

/**
 * One Status's complete Role allow-list.
 *
 * Membership only — no access-level dimension the way `field_visibility` has
 * VIEW/EDIT, since there is nothing to distinguish: a Role either can see a
 * lead while it sits in this Status, or the row is absent. Same shape as
 * `admin/validation.ts`'s `ids()`, kept as its own copy rather than a shared
 * import so this module doesn't reach into `admin/` for one array-of-ids
 * check with a different field name in its error message.
 */
export function parseRoleIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || id === ''))
    throw new StatusVisibilityError('validation_error', 'roleIds must be an array of IDs');
  const result = value.map((id) => String(id));
  if (new Set(result).size !== result.length)
    throw new StatusVisibilityError('validation_error', 'duplicate roleId');
  return result.sort();
}
