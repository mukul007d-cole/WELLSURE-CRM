import { useCallback } from 'react';
import { useAuth } from '../../app/AuthContext';
import type { Status } from '../../types/domain';
import { canChooseStatus } from './status-entry';

/**
 * Narrows a status list to the ones the signed-in viewer may choose
 * (ADR-0026 allowed roles, skipped by `leads:bypass_status_rules`). Every
 * status picker runs its options through this; the server stays the
 * authority and refuses anything that slips past.
 */
export function useStatusChoices(): <T extends Pick<Status, 'allowedRoles'>>(
  statuses: readonly T[],
) => T[] {
  const { capabilities, user, can } = useAuth();
  // The capability set names the role; the session profile is the fallback
  // for a server that predates it.
  const roleId = capabilities?.roleId ?? user?.roleId;
  const bypass = can('leads', 'bypass_status_rules');

  return useCallback(
    <T extends Pick<Status, 'allowedRoles'>>(statuses: readonly T[]) =>
      statuses.filter((status) => canChooseStatus(status, { roleId, bypass })),
    [roleId, bypass],
  );
}
