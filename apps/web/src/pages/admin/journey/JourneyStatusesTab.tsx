import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../app/AuthContext';
import { useUnsavedChanges } from '../../../app/use-unsaved-changes';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Select } from '../../../components/ui/Select';
import { adminApi } from '../../../lib/api-client';
import { friendlyErrorMessage } from '../../../lib/api-error';
import { cn } from '../../../lib/cn';
import type { Status } from '../../../types/domain';
import type { MultiSelectOption } from './CheckboxMultiSelect';
import {
  StatusEditor,
  fromStatus,
  newStatusDraft,
  rulesChanged,
  statusBody,
  type StatusDraft,
} from './StatusEditor';
import { STATUS_SWATCH_CLASS, colorLabel } from './status-colors';
import { useActiveRoleOptions, type JourneyFieldRow } from './queries';

/**
 * The Journey's ordered Statuses: create/edit (with the ADR-0026 status rules),
 * reorder, default-on-create and deactivation.
 */
export function JourneyStatusesTab({
  journeyId,
  statuses,
  journeyFields,
}: {
  journeyId: string;
  statuses: Status[];
  journeyFields: JourneyFieldRow[];
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [statusDraft, setStatusDraft] = useState<StatusDraft | null>(null);
  const [deactivatingStatus, setDeactivatingStatus] = useState<Status | null>(null);
  const [replacementStatusId, setReplacementStatusId] = useState('');
  const [order, setOrder] = useState<string[] | null>(null);
  // Listing roles is a permissions read; without it the picker is left out and
  // the stored allow-list goes back unchanged.
  const canListRoles = can('roles_permissions', 'view');
  const roles = useActiveRoleOptions(canListRoles && statusDraft !== null);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['admin', 'journey', journeyId] });
  };
  const saveStatus = useMutation({
    mutationFn: async (draft: StatusDraft) => {
      const saved = draft.id
        ? await adminApi.editStatus(draft.id, { ...statusBody(draft), journeyId })
        : await adminApi.createStatus(journeyId, statusBody(draft));
      // Two requests: the rules have their own endpoint. Once the Status
      // exists the draft points at it, so if the rules are refused (a 400
      // names why) a retry edits this Status instead of creating a second one.
      if (!draft.id)
        setStatusDraft((current) => current && { ...current, id: saved.id, key: saved.key });
      if (
        rulesChanged(
          draft,
          statuses.find((status) => status.id === draft.id),
        )
      )
        await adminApi.saveStatusRules(saved.id, {
          allowedRoleIds: draft.allowedRoleIds,
          requiredFieldIds: draft.requiredFieldIds,
        });
    },
    onSuccess: async () => {
      setStatusDraft(null);
      await refresh();
    },
    // A half-saved Status (created, rules refused) still belongs in the list.
    onError: refresh,
  });
  const deactivateStatus = useMutation({
    mutationFn: () =>
      adminApi.deactivateStatus(deactivatingStatus?.id ?? '', {
        ...(replacementStatusId ? { replacementStatusId } : {}),
      }),
    onSuccess: async () => {
      setDeactivatingStatus(null);
      setReplacementStatusId('');
      await refresh();
    },
  });
  const reorder = useMutation({
    mutationFn: () => adminApi.reorderStatuses(journeyId, order ?? []),
    onSuccess: async () => {
      setOrder(null);
      await refresh();
    },
  });
  const setDefault = useMutation({
    mutationFn: (statusId: string) => adminApi.setDefaultStatus(statusId),
    onSuccess: refresh,
  });
  // The save error is shown inside the editor, next to what was refused.
  const error = roles.error ?? deactivateStatus.error ?? reorder.error ?? setDefault.error;
  const orderedStatuses = (order ?? statuses.map((status) => status.id))
    .map((id) => statuses.find((status) => status.id === id))
    .filter((status): status is Status => Boolean(status));
  useUnsavedChanges(statusDraft !== null || order !== null);
  const move = (index: number, direction: -1 | 1) => {
    const next = [...orderedStatuses.map((status) => status.id)];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    setOrder(next);
  };
  const openDraft = (draft: StatusDraft) => {
    saveStatus.reset();
    setStatusDraft(draft);
  };
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-display text-lg font-semibold">Statuses</h3>
        {can('journeys_statuses', 'create') ? (
          <Button size="sm" onClick={() => openDraft(newStatusDraft(statuses.length))}>
            Create Status
          </Button>
        ) : null}
      </div>
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      {statusDraft ? (
        <StatusEditor
          draft={statusDraft}
          setDraft={setStatusDraft}
          save={() => saveStatus.mutate(statusDraft)}
          cancel={() => setStatusDraft(null)}
          loading={saveStatus.isPending}
          error={saveStatus.error}
          roleOptions={canListRoles ? (roles.data ?? []) : null}
          rolesLoading={roles.isPending}
          fieldOptions={requiredFieldOptions(journeyFields, statusDraft.requiredFieldIds)}
        />
      ) : null}
      {deactivatingStatus ? (
        <div className="grid gap-3 rounded-control border bg-paper p-3 sm:grid-cols-2">
          <Field label="Replacement Status">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={replacementStatusId}
                onChange={(event) => setReplacementStatusId(event.target.value)}
              >
                <option value="">No replacement</option>
                {statuses
                  .filter((status) => status.id !== deactivatingStatus.id)
                  .map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <div className="flex items-end gap-2">
            <Button
              variant="danger"
              loading={deactivateStatus.isPending}
              onClick={() => deactivateStatus.mutate()}
            >
              Deactivate Status
            </Button>
            <Button variant="ghost" onClick={() => setDeactivatingStatus(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <ol className="divide-y">
        {orderedStatuses.map((status, index) => (
          <li className="py-3" key={status.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <StatusSwatch status={status} />
                <span className="font-medium">
                  {index + 1}. {status.name}
                </span>
                <span className="text-sm text-ink-soft">
                  {status.outcomeType} · {status.behaviorType}
                </span>
                {status.isDefaultOnCreate ? (
                  <span className="rounded-pill bg-status-followup-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-status-followup">
                    Default
                  </span>
                ) : null}
                <StatusRuleBadges status={status} />
              </div>
              <div className="flex gap-1">
                {can('journeys_statuses', 'edit') ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Move ${status.name} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Move ${status.name} down`}
                      disabled={index === orderedStatuses.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openDraft(fromStatus(status))}>
                      Edit
                    </Button>
                    {!status.isDefaultOnCreate ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={setDefault.isPending && setDefault.variables === status.id}
                        onClick={() => setDefault.mutate(status.id)}
                      >
                        Set as default
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {can('journeys_statuses', 'delete') ? (
                  <Button size="sm" variant="danger" onClick={() => setDeactivatingStatus(status)}>
                    Deactivate
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {order ? (
        <div className="flex gap-2">
          <Button loading={reorder.isPending} onClick={() => reorder.mutate()}>
            Save Status order
          </Button>
          <Button variant="ghost" onClick={() => setOrder(null)}>
            Reset
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Fields the API accepts as "required to enter": mapped to this Journey and not
 * hidden there. A Field already required but since hidden is still listed, so
 * it can be unticked — leaving it would make every save a 400.
 */
function requiredFieldOptions(
  rows: JourneyFieldRow[],
  selected: readonly string[],
): MultiSelectOption[] {
  return rows
    .filter((row) => row.requirement !== 'hidden' || selected.includes(row.fieldId))
    .map((row) => ({
      id: row.fieldId,
      name: row.field.name,
      detail: row.requirement === 'hidden' ? 'hidden on this Journey' : undefined,
    }));
}

export function StatusSwatch({ status }: { status: Pick<Status, 'color'> }) {
  return (
    <span
      role="img"
      aria-label={status.color ? `Color: ${colorLabel(status.color)}` : 'No color'}
      title={status.color ? colorLabel(status.color) : 'No color'}
      className={cn(
        'inline-block h-3 w-3 shrink-0 rounded-pill',
        status.color
          ? STATUS_SWATCH_CLASS[status.color]
          : 'border border-dashed border-line-strong',
      )}
    />
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** "3 roles", "2 required", "4 reasons" — only the rules a Status actually has. */
function StatusRuleBadges({ status }: { status: Status }) {
  const roles = status.allowedRoles?.length ?? 0;
  const required = status.requiredFields?.length ?? 0;
  const reasons = status.reasonOptions?.length ?? 0;
  const badge = 'rounded-pill bg-surface-sunken px-1.5 py-0.5 text-xs tabular-nums text-ink-soft';
  return (
    <>
      {roles > 0 ? (
        <span className={badge} title="Only these roles can choose this status">
          {plural(roles, 'role', 'roles')}
        </span>
      ) : null}
      {required > 0 ? (
        <span className={badge} title="Fields required to enter this status">
          {required} required
        </span>
      ) : null}
      {reasons > 0 ? (
        <span className={badge} title="Reasons offered when entering this status">
          {plural(reasons, 'reason', 'reasons')}
        </span>
      ) : null}
    </>
  );
}
