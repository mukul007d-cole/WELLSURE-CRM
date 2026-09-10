import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { adminApi, statusVisibilityApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { loadAllPages } from './shared';

export const statusVisibilityKey = (statusId: string) => ['admin', 'status-visibility', statusId];

/**
 * Which Roles may see a lead while it sits in this Status (Phase 19).
 *
 * Rendered only for a `roles_permissions:edit` holder, and written through an
 * endpoint gated on the same action — granting or narrowing visibility is a
 * permissions act, exactly like `StatusRoutingPermissions`. A distinct axis
 * from that panel despite the identical surface (both per-`(status, role)`
 * allow-lists, both edited here): routing decides who may *configure or
 * operate* assignment for this Status; this decides who may *see a lead at
 * all* while it sits here — on the Seller List, search, the record page, and
 * its activity timeline.
 *
 * Allow-list semantics, with a default that differs from every other allow-
 * list in this app on purpose: an unchecked box is not "denied" the way a
 * missing Field-visibility row is. With **no** Role checked, this Status is
 * unrestricted — every Role that can otherwise see a lead here keeps seeing
 * it, unchanged. Checking a Role only ever narrows from there; unchecking
 * every Role returns to unrestricted, never to "visible to no one" — that
 * state cannot be configured.
 */
export function StatusVisibilityPanel({ statusId }: { statusId: string }) {
  const qc = useQueryClient();
  /**
   * Local edits only, derived rather than copied into state by an effect —
   * the same reason `StatusRoutingPermissions` avoids a stale copy:
   * reopening this panel must reflect whatever another admin saved in the
   * meantime, not a snapshot taken when it was first opened.
   */
  const [edited, setEdited] = useState<string[] | null>(null);

  const roles = useQuery({
    queryKey: ['admin', 'roles', 'status-visibility'],
    queryFn: () => loadAllPages((page, pageSize) => adminApi.roles(page, true, pageSize)),
  });
  const stored = useQuery({
    queryKey: statusVisibilityKey(statusId),
    queryFn: () => statusVisibilityApi.list(statusId),
  });
  const storedRoleIds = (stored.data ?? []).map((grant) => grant.roleId);
  const roleIds = edited ?? storedRoleIds;

  const save = useMutation({
    mutationFn: (nextRoleIds: string[]) => statusVisibilityApi.save(statusId, nextRoleIds),
    onSuccess: async () => {
      setEdited(null);
      await qc.invalidateQueries({ queryKey: statusVisibilityKey(statusId) });
      // The Statuses list's per-row "Visible to N roles" indicator reads
      // through the same key prefix — see JourneyDetailPage.
      await qc.invalidateQueries({ queryKey: ['admin', 'status-visibility'] });
    },
  });

  const toggle = (roleId: string, checked: boolean) =>
    setEdited((current) => {
      const base = current ?? storedRoleIds;
      return checked ? [...base, roleId] : base.filter((id) => id !== roleId);
    });

  const restricted = roleIds.length > 0;
  const error = roles.error ?? stored.error ?? save.error;

  if (roles.isPending || stored.isPending)
    return (
      <p className="py-2 text-sm text-ink-soft" role="status">
        Loading visibility…
      </p>
    );

  return (
    <fieldset className="space-y-3 rounded-control border bg-paper p-3">
      <legend className="text-sm font-bold text-ink">Who can see a lead in this Status</legend>
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}

      <p
        className={`rounded-control border px-2.5 py-2 text-xs ${
          restricted ? 'border-brand/30 bg-brand/5 text-ink' : 'border-transparent text-ink-soft'
        }`}
      >
        {restricted ? (
          <>
            <span className="font-medium">Restricted.</span> Only the roles checked below can see a
            lead while it sits here — on the Seller List, search, the record page, and its activity.
            Every other role loses the lead the moment it arrives, even the role that just moved it
            in. This narrows each role's ordinary record scope and Journey access; it never grants
            more than either already allows.
          </>
        ) : (
          <>
            <span className="font-medium">Unrestricted.</span> No role is checked, so every role
            that can otherwise see a lead in this Journey can see it here too — unchanged from
            today. Check a role below to limit this Status to just the checked roles.
          </>
        )}
      </p>

      <div className="grid gap-1 sm:grid-cols-2">
        {(roles.data ?? []).map((role) => (
          <Checkbox
            key={role.id}
            label={role.name}
            checked={roleIds.includes(role.id)}
            onChange={(event) => toggle(role.id, event.target.checked)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          loading={save.isPending}
          disabled={roles.data === undefined}
          onClick={() => save.mutate(roleIds)}
        >
          Save visibility
        </Button>
        {restricted ? (
          <Button
            size="sm"
            variant="ghost"
            loading={save.isPending}
            onClick={() => save.mutate([])}
          >
            Clear restriction
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}
