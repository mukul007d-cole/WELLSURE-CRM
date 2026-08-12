import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { adminApi, routingApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import { loadAllPages } from './shared';
import { StatusRoutingPermissions } from './StatusRoutingPermissions';
import type { RoutingRule } from '../../types/domain';

type Draft = {
  assignmentType: string;
  algorithm: 'round_robin' | 'least_loaded';
  poolType: 'team' | 'users';
  teamId: string;
  userIds: string[];
};

const emptyDraft: Draft = {
  assignmentType: '',
  algorithm: 'round_robin',
  poolType: 'users',
  teamId: '',
  userIds: [],
};

function toDraft(rule: RoutingRule | null): Draft {
  if (rule === null) return emptyDraft;
  return {
    assignmentType: rule.assignmentType,
    algorithm: rule.algorithm,
    poolType: rule.poolType,
    teamId: rule.teamId ?? '',
    userIds: rule.members.map((member) => member.userId),
  };
}

/**
 * Routing for one Status, inside the Journey's Statuses list.
 *
 * Two sections, as specified: the rule itself, and the per-Status role grants.
 * The second only renders for someone who can edit permissions — granting
 * routing rights is a permissions act, not a routing one, so a routing
 * administrator cannot use this panel to widen their own access.
 */
export function StatusRoutingPanel({
  statusId,
  journeyId,
  assignmentTypeSuggestions,
}: {
  statusId: string;
  journeyId: string;
  assignmentTypeSuggestions: readonly string[];
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const state = useQuery({
    queryKey: ['admin', 'routing', statusId],
    queryFn: () => routingApi.state(statusId),
  });
  const teams = useQuery({
    queryKey: ['admin', 'routing-teams'],
    queryFn: () =>
      loadAllPages((page, pageSize) => adminApi.departments(page, true, pageSize)).then(
        async (departments) => {
          const perDepartment = await Promise.all(
            departments.map((department) =>
              loadAllPages((page, pageSize) => adminApi.teams(department.id, page, true, pageSize)),
            ),
          );
          return perDepartment.flat();
        },
      ),
    enabled: draft?.poolType === 'team',
  });
  const users = useQuery({
    queryKey: ['admin', 'routing-users'],
    queryFn: () =>
      loadAllPages((page, pageSize) => adminApi.users({ page, pageSize, active: true })),
    enabled: draft?.poolType === 'users',
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'routing', statusId] });
  const save = useMutation({
    mutationFn: () =>
      routingApi.saveRule(statusId, {
        assignmentType: draft?.assignmentType ?? '',
        algorithm: draft?.algorithm ?? 'round_robin',
        poolType: draft?.poolType ?? 'users',
        ...(draft?.poolType === 'team'
          ? { teamId: draft.teamId }
          : { userIds: draft?.userIds ?? [] }),
      }),
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
  });
  const clear = useMutation({
    mutationFn: () => routingApi.deactivateRule(statusId),
    onSuccess: refresh,
  });

  const rule = state.data?.rule ?? null;
  const error = state.error ?? save.error ?? clear.error;
  const listId = `routing-types-${statusId}`;

  if (state.isPending)
    return (
      <p className="py-2 text-sm text-ink-soft" role="status">
        Loading routing…
      </p>
    );

  return (
    <div className="space-y-3 rounded-control border bg-paper p-3">
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}

      {rule === null || !rule.active ? (
        <p className="text-sm text-ink-soft">
          Leads entering this Status keep whatever assignment they already have.
        </p>
      ) : (
        <div className="text-sm">
          <span className="font-medium">{rule.assignmentType}</span>
          <span className="ml-2 text-ink-soft">
            {rule.algorithm === 'round_robin' ? 'round robin' : 'least loaded'} ·{' '}
            {rule.poolType === 'team' ? 'Team pool' : `${rule.members.length} named users`}
          </span>
        </div>
      )}

      {(state.data?.candidates ?? []).length > 0 ? (
        <ul className="divide-y text-sm">
          {state.data!.candidates.map((candidate) => (
            <li className="flex justify-between gap-3 py-1.5" key={candidate.userId}>
              <span>
                {candidate.name}
                {candidate.isNext ? (
                  <span className="ml-2 text-xs text-ink-soft">last assigned</span>
                ) : null}
              </span>
              <span className="text-ink-soft">{candidate.openCount} open</span>
            </li>
          ))}
        </ul>
      ) : null}

      {can('lead_routing', 'configure') ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setDraft(toDraft(rule))}>
            {rule === null || !rule.active ? 'Add routing rule' : 'Edit routing rule'}
          </Button>
          {rule !== null && rule.active ? (
            <Button
              size="sm"
              variant="danger"
              loading={clear.isPending}
              onClick={() => clear.mutate()}
            >
              Clear rule
            </Button>
          ) : null}
        </div>
      ) : null}

      {draft ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Assignment type"
            required
            hint="Which assignment this rule writes. Free text — it does not have to exist yet."
          >
            {({ inputId }) => (
              <>
                <Input
                  id={inputId}
                  list={listId}
                  value={draft.assignmentType}
                  onChange={(event) => setDraft({ ...draft, assignmentType: event.target.value })}
                />
                {/* Suggestions only. The API derives these from assignments that
                    already exist, so a Journey with no leads offers none — which
                    must not stop a rule being created. */}
                <datalist id={listId}>
                  {assignmentTypeSuggestions.map((type) => (
                    <option key={type} value={type} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Algorithm">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={draft.algorithm}
                onChange={(event) =>
                  setDraft({ ...draft, algorithm: event.target.value as Draft['algorithm'] })
                }
              >
                <option value="round_robin">Round robin</option>
                <option value="least_loaded">Least loaded</option>
              </Select>
            )}
          </Field>
          <Field label="Pool">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={draft.poolType}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    poolType: event.target.value as Draft['poolType'],
                    teamId: '',
                    userIds: [],
                  })
                }
              >
                <option value="users">Named users</option>
                <option value="team">A Team</option>
              </Select>
            )}
          </Field>
          {draft.poolType === 'team' ? (
            <Field label="Team" required>
              {({ inputId }) => (
                <Select
                  id={inputId}
                  value={draft.teamId}
                  onChange={(event) => setDraft({ ...draft, teamId: event.target.value })}
                >
                  <option value="">Select Team</option>
                  {(teams.data ?? []).map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium">Pool members</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {(users.data ?? []).map((user) => (
                  <Checkbox
                    key={user.id}
                    label={`${user.name} (${user.email})`}
                    checked={draft.userIds.includes(user.id)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        userIds: event.target.checked
                          ? [...draft.userIds, user.id]
                          : draft.userIds.filter((id) => id !== user.id),
                      })
                    }
                  />
                ))}
              </div>
            </fieldset>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button
              loading={save.isPending}
              disabled={
                !draft.assignmentType ||
                (draft.poolType === 'team' ? !draft.teamId : draft.userIds.length === 0)
              }
              onClick={() => save.mutate()}
            >
              Save routing rule
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {can('roles_permissions', 'edit') ? (
        <StatusRoutingPermissions statusId={statusId} journeyId={journeyId} />
      ) : null}
    </div>
  );
}
