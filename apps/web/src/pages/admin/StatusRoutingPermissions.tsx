import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { adminApi, routingApi } from '../../lib/api-client';
import { loadAllPages } from './shared';
import type { RoutingGrant, RoutingAction } from '../../types/domain';

const actions: readonly RoutingAction[] = ['view', 'configure', 'operate'];
const labels: Record<RoutingAction, string> = {
  view: 'View',
  configure: 'Configure',
  operate: 'Operate',
};

const key = (grant: RoutingGrant) => `${grant.roleId}:${grant.action}`;

/**
 * Which roles may do what with this Status's routing.
 *
 * Rendered only for a `roles_permissions:edit` holder, and written through an
 * endpoint gated on the same action — granting routing rights is a permissions
 * act. A routing administrator who cannot edit permissions must not be able to
 * grant them, including to their own role, which is the rule `field_visibility`
 * already follows.
 *
 * Allow-list semantics: an unchecked box is not a "deny" row, it is the absence
 * of a grant.
 */
export function StatusRoutingPermissions({
  statusId,
  journeyId,
}: {
  statusId: string;
  journeyId: string;
}) {
  const qc = useQueryClient();
  /**
   * Local edits only. Null means "nothing edited yet", and the grid renders the
   * server's set directly.
   *
   * Derived rather than copied into state by an effect: a copy goes stale, which
   * is the defect 13a fixed for field grants — reopening the editor silently
   * revoked what another admin had granted in the meantime. Saving clears this
   * back to null, so the next render reads the refetched set.
   */
  const [edited, setEdited] = useState<RoutingGrant[] | null>(null);

  const roles = useQuery({
    queryKey: ['admin', 'roles', 'routing-grants'],
    queryFn: () => loadAllPages((page, pageSize) => adminApi.roles(page, true, pageSize)),
  });
  const stored = useQuery({
    queryKey: ['admin', 'routing-grants', statusId],
    queryFn: () => routingApi.grants(statusId),
  });

  const grants = edited ?? stored.data ?? null;

  const save = useMutation({
    mutationFn: () => routingApi.saveGrants(statusId, grants ?? []),
    onSuccess: async () => {
      setEdited(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'routing-grants', statusId] });
      await qc.invalidateQueries({ queryKey: ['admin', 'routing', statusId] });
      await qc.invalidateQueries({ queryKey: ['admin', 'journey', journeyId] });
    },
  });

  const has = (roleId: string, action: RoutingAction) =>
    (grants ?? []).some((grant) => grant.roleId === roleId && grant.action === action);
  const toggle = (roleId: string, action: RoutingAction, granted: boolean) =>
    setEdited((current) => {
      const base = current ?? stored.data ?? [];
      const without = base.filter((grant) => key(grant) !== `${roleId}:${action}`);
      return granted ? [...without, { roleId, action }] : without;
    });

  return (
    <fieldset className="border-t pt-3">
      <legend className="text-sm font-bold text-ink">Role permissions for this Status</legend>
      <p className="mb-2 text-xs text-ink-soft">
        A role also needs the matching Lead Routing permission on its role page. Both are required —
        this grid decides which Statuses that permission reaches.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="py-1 text-left font-medium">Role</th>
              {actions.map((action) => (
                <th className="px-2 py-1 text-left font-medium" key={action}>
                  {labels[action]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {(roles.data ?? []).map((role) => (
              <tr key={role.id}>
                <td className="py-1.5">{role.name}</td>
                {actions.map((action) => (
                  <td className="px-2 py-1.5" key={action}>
                    <Checkbox
                      label=""
                      aria-label={`${role.name} ${labels[action]} routing`}
                      checked={has(role.id, action)}
                      onChange={(event) => toggle(role.id, action, event.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        className="mt-2"
        size="sm"
        loading={save.isPending}
        disabled={grants === null}
        onClick={() => save.mutate()}
      >
        Save role permissions
      </Button>
    </fieldset>
  );
}
