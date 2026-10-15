import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../../lib/api-client';
import { loadAllPages } from '../shared';
import type { MultiSelectOption } from './CheckboxMultiSelect';

/**
 * One `GET /journeys/:id/fields` row. `requiredRoleIds` (ADR-0026) is on the
 * wire for every row; the client's response type does not declare it yet, so
 * it is optional here and read with a fallback.
 */
export type JourneyFieldRow = Awaited<ReturnType<typeof adminApi.journeyFields>>[number] & {
  requiredRoleIds?: string[] | null;
};

/**
 * Active roles, for every role picker on the Journey editor — one cache entry
 * however many tabs ask. Listing roles is gated on `roles_permissions:view`,
 * so callers pass whether the viewer holds it.
 */
export function useActiveRoleOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'roles', 'journey-editor'],
    queryFn: () => loadAllPages((page, pageSize) => adminApi.roles(page, true, pageSize)),
    enabled,
    select: (roles): MultiSelectOption[] => roles.map((role) => ({ id: role.id, name: role.name })),
  });
}
