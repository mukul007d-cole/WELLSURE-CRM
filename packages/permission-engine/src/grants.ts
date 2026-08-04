import type { DirectGrantSnapshot } from './types.js';

export function isGrantActive(grant: DirectGrantSnapshot, now: Date, action?: string): boolean {
  return (
    grant.revokedAt === null &&
    (grant.expiresAt === null || grant.expiresAt > now) &&
    (action === undefined || grant.actions.includes(action))
  );
}
