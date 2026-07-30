import type { DirectGrantSnapshot } from './types.js';

export function isGrantActive(grant: DirectGrantSnapshot, now: Date): boolean {
  return grant.revokedAt === null && (grant.expiresAt === null || grant.expiresAt > now);
}
