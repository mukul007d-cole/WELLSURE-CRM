import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../app/AuthContext';
import { useUnsavedChanges } from '../../../app/use-unsaved-changes';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Checkbox } from '../../../components/ui/Checkbox';
import { adminApi } from '../../../lib/api-client';
import { friendlyErrorMessage } from '../../../lib/api-error';
import type { JourneyMembers } from '../../../types/domain';
import { loadAllPages } from '../shared';
import { CheckboxMultiSelect } from './CheckboxMultiSelect';

/**
 * Journey members and the "members only" switch (ADR-0026).
 *
 * Gated on `users` rather than `journeys_statuses`: who may work a Journey is a
 * personnel assignment, like Team membership, and the API checks users:view to
 * read it and users:edit to change it. The page only mounts this tab for a
 * users:view holder; without users:edit everything here is read-only.
 */
export function JourneyMembersTab({ journeyId }: { journeyId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canEdit = can('users', 'edit');
  /**
   * Local edits only; null renders the server's set. Derived rather than
   * copied in by an effect, for the reason `StatusRoutingPermissions` gives —
   * a copy goes stale and the full-replace save then reverts someone else's
   * change.
   */
  const [edited, setEdited] = useState<JourneyMembers | null>(null);
  const [saved, setSaved] = useState(false);
  const stored = useQuery({
    queryKey: ['admin', 'journey-members', journeyId],
    queryFn: () => adminApi.journeyMembers(journeyId),
  });
  const users = useQuery({
    queryKey: ['admin', 'users', 'active-all'],
    queryFn: () =>
      loadAllPages((page, pageSize) => adminApi.users({ page, pageSize, active: true })),
  });
  const members = edited ?? stored.data ?? null;
  const save = useMutation({
    mutationFn: () => adminApi.saveJourneyMembers(journeyId, members ?? emptyMembers),
    onSuccess: async () => {
      setEdited(null);
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ['admin', 'journey-members', journeyId] });
      await qc.invalidateQueries({ queryKey: ['admin', 'journey', journeyId] });
    },
  });
  useUnsavedChanges(edited !== null);
  const edit = (next: Partial<JourneyMembers>) => {
    setSaved(false);
    setEdited({ ...(members ?? emptyMembers), ...next });
  };
  const error = stored.error ?? users.error ?? save.error;
  return (
    <Card className="space-y-4 p-4">
      <div>
        <h3 className="font-display text-lg font-semibold">Members & access</h3>
        <p className="text-sm text-ink-soft">
          Who may work leads in this Journey, beyond what their role allows.
        </p>
      </div>
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      {saved ? <Banner tone="success">Members saved.</Banner> : null}
      {members === null ? (
        <p className="text-sm text-ink-soft" role="status">
          Loading members…
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <Checkbox
              role="switch"
              label="Only members can work this journey"
              disabled={!canEdit}
              checked={members.restrictToMembers}
              onChange={(event) => edit({ restrictToMembers: event.target.checked })}
            />
            <p className="text-xs text-ink-soft">
              {members.restrictToMembers
                ? 'On: a user needs their role’s access to this Journey and to be listed below.'
                : 'Off: anyone whose role can access this Journey may work it. The list below is kept, but has no effect until this is switched on.'}
            </p>
          </div>
          <CheckboxMultiSelect
            legend="Members"
            searchLabel="Search users"
            options={(users.data ?? []).map((user) => ({
              id: user.id,
              name: user.name,
              detail: user.email,
            }))}
            loading={users.isPending}
            emptyText="No active users."
            disabled={!canEdit}
            value={members.userIds}
            onChange={(userIds) => edit({ userIds })}
          />
          {canEdit ? (
            <div className="flex gap-2">
              <Button
                loading={save.isPending}
                disabled={edited === null}
                onClick={() => save.mutate()}
              >
                Save members
              </Button>
              {edited !== null ? (
                <Button variant="ghost" onClick={() => setEdited(null)}>
                  Reset
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-ink-soft">
              Changing members needs permission to edit users.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

const emptyMembers: JourneyMembers = { restrictToMembers: false, userIds: [] };
