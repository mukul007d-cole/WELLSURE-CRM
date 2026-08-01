import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import type { Status } from '../../types/domain';
import { AdminHeader } from './shared';

type StatusDraft = {
  id?: string;
  key: string;
  name: string;
  outcomeType: string;
  behaviorType: string;
  sortOrder: number;
};
type SettingDraft = { fieldId: string; requirement: string; requiredFromStatusId: string };
export function JourneyDetailPage() {
  const { journeyId = '' } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [journeyName, setJourneyName] = useState('');
  const [statusDraft, setStatusDraft] = useState<StatusDraft | null>(null);
  const [deactivatingStatus, setDeactivatingStatus] = useState<Status | null>(null);
  const [replacementStatusId, setReplacementStatusId] = useState('');
  const [order, setOrder] = useState<string[] | null>(null);
  const [settingDraft, setSettingDraft] = useState<SettingDraft | null>(null);
  const journey = useQuery({
    queryKey: ['admin', 'journey', journeyId],
    queryFn: () => adminApi.journey(journeyId),
  });
  const settings = useQuery({
    queryKey: ['admin', 'journey-fields', journeyId],
    queryFn: () => adminApi.journeyFields(journeyId),
  });
  const fields = useQuery({
    queryKey: ['admin', 'fields', 'journey-editor'],
    queryFn: () => adminApi.fields(1, true),
  });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['admin', 'journey', journeyId] });
    await qc.invalidateQueries({ queryKey: ['admin', 'journey-fields', journeyId] });
  };
  const editJourney = useMutation({
    mutationFn: () =>
      adminApi.editJourney(journeyId, { name: journeyName || journey.data?.name || '' }),
    onSuccess: refresh,
  });
  const saveStatus = useMutation({
    mutationFn: () =>
      statusDraft?.id
        ? adminApi.editStatus(statusDraft.id, { ...statusDraft, journeyId })
        : adminApi.createStatus(journeyId, statusDraft ?? {}),
    onSuccess: async () => {
      setStatusDraft(null);
      await refresh();
    },
  });
  const deactivateStatus = useMutation({
    mutationFn: () =>
      adminApi.deactivateStatus(deactivatingStatus?.id ?? '', {
        journeyId,
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
  const saveSetting = useMutation({
    mutationFn: () =>
      adminApi.setJourneyField(journeyId, settingDraft?.fieldId ?? '', {
        requirement: settingDraft?.requirement,
        requiredFromStatusId: settingDraft?.requiredFromStatusId || null,
      }),
    onSuccess: async () => {
      setSettingDraft(null);
      await refresh();
    },
  });
  const unmap = useMutation({
    mutationFn: (fieldId: string) => adminApi.unmapJourneyField(journeyId, fieldId),
    onSuccess: refresh,
  });
  const error =
    journey.error ??
    settings.error ??
    fields.error ??
    editJourney.error ??
    saveStatus.error ??
    deactivateStatus.error ??
    reorder.error ??
    saveSetting.error ??
    unmap.error;
  const statuses = journey.data?.statuses ?? [];
  const orderedStatuses = (order ?? statuses.map((status) => status.id))
    .map((id) => statuses.find((status) => status.id === id))
    .filter((status): status is Status => Boolean(status));
  const move = (index: number, direction: -1 | 1) => {
    const next = [...orderedStatuses.map((status) => status.id)];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    setOrder(next);
  };
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <AdminHeader
        title={journey.data?.name ?? 'Journey'}
        description="Manage this Journey's identity, ordered Statuses, and attached Field rules."
      />
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      {can('journeys_statuses', 'edit') ? (
        <Card className="flex gap-3 p-4">
          <Field label="Journey name" className="flex-1">
            {({ inputId }) => (
              <Input
                id={inputId}
                value={journeyName}
                placeholder={journey.data?.name}
                onChange={(event) => setJourneyName(event.target.value)}
              />
            )}
          </Field>
          <Button
            className="self-end"
            loading={editJourney.isPending}
            onClick={() => editJourney.mutate()}
          >
            Save Journey
          </Button>
        </Card>
      ) : null}
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap justify-between gap-2">
          <h3 className="font-display text-lg font-semibold">Statuses</h3>
          {can('journeys_statuses', 'create') ? (
            <Button
              size="sm"
              onClick={() =>
                setStatusDraft({
                  key: '',
                  name: '',
                  outcomeType: 'open',
                  behaviorType: 'default',
                  sortOrder: statuses.length,
                })
              }
            >
              Create Status
            </Button>
          ) : null}
        </div>
        {statusDraft ? (
          <StatusEditor
            draft={statusDraft}
            setDraft={setStatusDraft}
            save={() => saveStatus.mutate()}
            cancel={() => setStatusDraft(null)}
            loading={saveStatus.isPending}
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
            <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={status.id}>
              <div>
                <span className="font-medium">
                  {index + 1}. {status.name}
                </span>
                <span className="ml-2 text-sm text-ink-soft">
                  {status.outcomeType} · {status.behaviorType}
                </span>
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setStatusDraft(fromStatus(status))}
                    >
                      Edit
                    </Button>
                  </>
                ) : null}
                {can('journeys_statuses', 'delete') ? (
                  <Button size="sm" variant="danger" onClick={() => setDeactivatingStatus(status)}>
                    Deactivate
                  </Button>
                ) : null}
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
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap justify-between gap-2">
          <h3 className="font-display text-lg font-semibold">Journey Fields</h3>
          {can('fields', 'edit') ? (
            <Button
              size="sm"
              onClick={() =>
                setSettingDraft({ fieldId: '', requirement: 'optional', requiredFromStatusId: '' })
              }
            >
              Attach Field
            </Button>
          ) : null}
        </div>
        {settingDraft ? (
          <SettingEditor
            draft={settingDraft}
            setDraft={setSettingDraft}
            fields={fields.data?.items ?? []}
            statuses={statuses}
            save={() => saveSetting.mutate()}
            cancel={() => setSettingDraft(null)}
            loading={saveSetting.isPending}
          />
        ) : null}
        <ul className="divide-y">
          {settings.data?.map((setting) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 py-3"
              key={setting.fieldId}
            >
              <div>
                <span className="font-medium">{setting.field.name}</span>
                <span className="ml-2 text-sm text-ink-soft">
                  {setting.requirement}
                  {setting.requiredFromStatusId
                    ? ` from ${statuses.find((status) => status.id === setting.requiredFromStatusId)?.name ?? 'configured Status'}`
                    : ''}
                </span>
              </div>
              {can('fields', 'edit') ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSettingDraft({
                        fieldId: setting.fieldId,
                        requirement: setting.requirement,
                        requiredFromStatusId: setting.requiredFromStatusId ?? '',
                      })
                    }
                  >
                    Edit rule
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => unmap.mutate(setting.fieldId)}>
                    Unmap
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
function fromStatus(status: Status): StatusDraft {
  return {
    id: status.id,
    key: status.key,
    name: status.name,
    outcomeType: status.outcomeType,
    behaviorType: status.behaviorType,
    sortOrder: status.sortOrder,
  };
}
function StatusEditor({
  draft,
  setDraft,
  save,
  cancel,
  loading,
}: {
  draft: StatusDraft;
  setDraft: (draft: StatusDraft) => void;
  save: () => void;
  cancel: () => void;
  loading: boolean;
}) {
  const update = (key: keyof StatusDraft, value: string | number) =>
    setDraft({ ...draft, [key]: value });
  return (
    <div className="grid gap-3 rounded-control border bg-paper p-3 sm:grid-cols-3">
      <Field label="Stable key" required>
        {({ inputId }) => (
          <Input
            id={inputId}
            disabled={Boolean(draft.id)}
            value={draft.key}
            onChange={(event) => update('key', event.target.value)}
          />
        )}
      </Field>
      <Field label="Name" required>
        {({ inputId }) => (
          <Input
            id={inputId}
            value={draft.name}
            onChange={(event) => update('name', event.target.value)}
          />
        )}
      </Field>
      <Field label="Order" required>
        {({ inputId }) => (
          <Input
            id={inputId}
            type="number"
            min={0}
            value={draft.sortOrder}
            onChange={(event) => update('sortOrder', Number(event.target.value))}
          />
        )}
      </Field>
      <Field label="Outcome">
        {({ inputId }) => (
          <Select
            id={inputId}
            value={draft.outcomeType}
            onChange={(event) => update('outcomeType', event.target.value)}
          >
            {['open', 'closed_won', 'closed_lost'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Behavior">
        {({ inputId }) => (
          <Select
            id={inputId}
            value={draft.behaviorType}
            onChange={(event) => update('behaviorType', event.target.value)}
          >
            {['default', 'call_later', 'follow_up', 'archived'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex items-end gap-2">
        <Button loading={loading} disabled={!draft.key || !draft.name} onClick={save}>
          Save Status
        </Button>
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
function SettingEditor({
  draft,
  setDraft,
  fields,
  statuses,
  save,
  cancel,
  loading,
}: {
  draft: SettingDraft;
  setDraft: (draft: SettingDraft) => void;
  fields: Array<{ id: string; name: string }>;
  statuses: Status[];
  save: () => void;
  cancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-control border bg-paper p-3 sm:grid-cols-3">
      <Field label="Field" required>
        {({ inputId }) => (
          <Select
            id={inputId}
            disabled={Boolean(draft.fieldId && fields.some((field) => field.id === draft.fieldId))}
            value={draft.fieldId}
            onChange={(event) => setDraft({ ...draft, fieldId: event.target.value })}
          >
            <option value="">Select Field</option>
            {fields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Requirement">
        {({ inputId }) => (
          <Select
            id={inputId}
            value={draft.requirement}
            onChange={(event) => setDraft({ ...draft, requirement: event.target.value })}
          >
            {['required', 'optional', 'hidden'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Required from Status">
        {({ inputId }) => (
          <Select
            id={inputId}
            value={draft.requiredFromStatusId}
            onChange={(event) => setDraft({ ...draft, requiredFromStatusId: event.target.value })}
          >
            <option value="">No Status condition</option>
            {statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex gap-2 sm:col-span-3">
        <Button loading={loading} disabled={!draft.fieldId} onClick={save}>
          Save Field rule
        </Button>
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
