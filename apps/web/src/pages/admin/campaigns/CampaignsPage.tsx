import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useAuth } from '../../../app/AuthContext';
import { usePageChrome } from '../../../app/page-chrome';
import { useUnsavedDraft } from '../../../app/use-unsaved-changes';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { DataCell, DataRow, RowActions } from '../../../components/ui/DataTable';
import { PageBody, PageHeader } from '../../../components/layout/PageFrame';
import { campaignsApi, configApi } from '../../../lib/api-client';
import { friendlyErrorMessage } from '../../../lib/api-error';
import type { Campaign, CampaignDocument, FieldDefinition, Status } from '../../../types/domain';
import { FilterBuilder } from '../../sellers/FilterBuilder';
import { decodeFilter, encodeFilter, type FilterCondition } from '../../sellers/filter-state';
import { AdminTable } from '../shared';
import { RichTextComposer } from './RichTextComposer';
import { documentPreview, emptyDocument } from './campaign-document';

type Draft = {
  id?: string;
  key: string;
  name: string;
  subject: string;
  bodyDocument: CampaignDocument;
  type: 'manual' | 'triggered';
  conditions: FilterCondition[];
  journeyId: string;
  statusId: string;
};

const emptyDraft = (): Draft => ({
  key: '',
  name: '',
  subject: '',
  bodyDocument: emptyDocument(),
  type: 'manual',
  conditions: [],
  journeyId: '',
  statusId: '',
});

export function CampaignsPage() {
  usePageChrome('Campaigns', [['campaigns']]);
  const { can } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  // The draft as it was opened, so looking at a campaign and closing the tab
  // does not raise a warning about work that does not exist.
  const [pristine, setPristine] = useState<Draft | null>(null);
  const openDraft = (next: Draft) => {
    setDraft(next);
    setPristine(next);
  };
  const closeDraft = () => {
    setDraft(null);
    setPristine(null);
  };
  useUnsavedDraft(draft, pristine);
  /*
   * The composer hands its "insert this token" function up so the variable
   * picker can call it. Held in a ref, not state: the composer re-registers on
   * every render, and storing that in state would set state during render and
   * loop forever.
   */
  const insertToken = useRef<(token: string) => void>(() => {});

  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: campaignsApi.list });
  const journeys = useQuery({ queryKey: ['journeys'], queryFn: configApi.journeys });
  const fields = useQuery({ queryKey: ['fields'], queryFn: configApi.fields });
  const statuses = useQuery({
    queryKey: ['statuses', draft?.journeyId],
    queryFn: () => configApi.statuses(draft?.journeyId ?? ''),
    enabled: Boolean(draft?.journeyId),
  });

  const invalidate = async () => qc.invalidateQueries({ queryKey: ['campaigns'] });
  const save = useMutation({
    mutationFn: () => {
      const current = draft ?? emptyDraft();
      const body = {
        key: current.key,
        name: current.name,
        subject: current.subject,
        bodyDocument: current.bodyDocument,
        type: current.type,
        ...(current.type === 'manual'
          ? {
              filter: JSON.parse(
                encodeFilter(current.conditions) || '{"conditions":[]}',
              ) as unknown,
            }
          : { journeyId: current.journeyId, statusId: current.statusId }),
      };
      return current.id ? campaignsApi.update(current.id, body) : campaignsApi.create(body);
    },
    onSuccess: async () => {
      closeDraft();
      await invalidate();
    },
  });
  const activation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      campaignsApi.setActive(id, active),
    onSuccess: invalidate,
  });
  const send = useMutation({ mutationFn: campaignsApi.send, onSuccess: invalidate });

  const error = campaigns.error ?? save.error ?? activation.error ?? send.error;
  const rows = campaigns.data?.items ?? [];

  return (
    <PageBody>
      <PageHeader
        title="Campaigns"
        description="Email your sellers — once, or automatically when they reach a status."
        actions={
          can('campaigns', 'create') ? (
            <Button onClick={() => openDraft(emptyDraft())}>Create campaign</Button>
          ) : undefined
        }
      />
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      {send.data ? (
        <Banner tone="success">
          {`Queued ${send.data.queued}, sent ${send.data.sent}, failed ${send.data.failed}.`}
        </Banner>
      ) : null}

      {draft ? (
        <CampaignEditor
          draft={draft}
          setDraft={setDraft}
          fields={fields.data ?? []}
          journeys={journeys.data ?? []}
          statuses={statuses.data ?? []}
          onInsertToken={(run) => {
            insertToken.current = run;
          }}
          insertToken={(token) => insertToken.current(token)}
          save={() => save.mutate()}
          cancel={closeDraft}
          loading={save.isPending}
        />
      ) : null}

      <AdminTable
        loading={campaigns.isPending}
        headers={['Name', 'Type', 'State', 'Sent', { label: 'Actions', align: 'right' as const }]}
        empty={!campaigns.isPending && rows.length === 0}
      >
        {rows.map((campaign) => (
          <DataRow key={campaign.id}>
            <DataCell primary>
              <span className="block">{campaign.name}</span>
              <span className="text-xs text-ink-soft">
                {documentPreview(campaign.bodyDocument)}
              </span>
            </DataCell>
            <DataCell>{campaign.type === 'manual' ? 'Manual' : 'On status change'}</DataCell>
            <DataCell>{campaign.active ? 'Active' : 'Inactive'}</DataCell>
            <DataCell>
              {`${campaign.stats.sent} sent`}
              {campaign.stats.failed > 0 ? `, ${campaign.stats.failed} failed` : ''}
              {campaign.stats.skippedNoEmail > 0
                ? `, ${campaign.stats.skippedNoEmail} without an email`
                : ''}
            </DataCell>
            <DataCell align="right">
              <RowActions>
                {can('campaigns', 'edit') ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => openDraft(toDraft(campaign))}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        activation.mutate({ id: campaign.id, active: !campaign.active })
                      }
                    >
                      {campaign.active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </>
                ) : null}
                {can('campaigns', 'send') && campaign.type === 'manual' && campaign.active ? (
                  <Button size="sm" onClick={() => send.mutate(campaign.id)}>
                    Send now
                  </Button>
                ) : null}
              </RowActions>
            </DataCell>
          </DataRow>
        ))}
      </AdminTable>
    </PageBody>
  );
}

function toDraft(campaign: Campaign): Draft {
  return {
    id: campaign.id,
    key: campaign.key,
    name: campaign.name,
    subject: campaign.subject,
    bodyDocument: campaign.bodyDocument,
    type: campaign.type,
    conditions: decodeFilter(campaign.filter ? JSON.stringify(campaign.filter) : null),
    journeyId: campaign.journeyId ?? '',
    statusId: campaign.statusId ?? '',
  };
}

function CampaignEditor({
  draft,
  setDraft,
  fields,
  journeys,
  statuses,
  onInsertToken,
  insertToken,
  save,
  cancel,
  loading,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  fields: readonly FieldDefinition[];
  journeys: readonly { id: string; name: string }[];
  statuses: readonly Status[];
  onInsertToken: (run: (token: string) => void) => void;
  insertToken: (token: string) => void;
  save: () => void;
  cancel: () => void;
  loading: boolean;
}) {
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });

  return (
    <Card className="grid gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
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
        <Field label="Subject" required>
          {({ inputId }) => (
            <Input
              id={inputId}
              value={draft.subject}
              onChange={(event) => update('subject', event.target.value)}
            />
          )}
        </Field>
        <Field label="When to send" required>
          {({ inputId }) => (
            <Select
              id={inputId}
              value={draft.type}
              onChange={(event) => update('type', event.target.value as Draft['type'])}
            >
              <option value="manual">Manually, to everyone matching a filter</option>
              <option value="triggered">Automatically, when a lead reaches a status</option>
            </Select>
          )}
        </Field>
      </div>

      {draft.type === 'triggered' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Journey" required>
            {({ inputId }) => (
              <Select
                id={inputId}
                value={draft.journeyId}
                onChange={(event) =>
                  // Changing journey invalidates the chosen status: statuses
                  // belong to exactly one journey.
                  setDraft({ ...draft, journeyId: event.target.value, statusId: '' })
                }
              >
                <option value="">Select a journey…</option>
                {journeys.map((journey) => (
                  <option key={journey.id} value={journey.id}>
                    {journey.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Status" required hint="Sends once, the first time a lead reaches it.">
            {({ inputId }) => (
              <Select
                id={inputId}
                disabled={!draft.journeyId}
                value={draft.statusId}
                onChange={(event) => update('statusId', event.target.value)}
              >
                <option value="">
                  {draft.journeyId ? 'Select a status…' : 'Select a journey first'}
                </option>
                {statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      ) : (
        <fieldset>
          <legend className="mb-2 font-display text-sm font-bold text-ink">Who receives it</legend>
          <FilterBuilder
            conditions={draft.conditions}
            fields={fields}
            statuses={statuses}
            journeys={journeys}
            onChange={(conditions) => update('conditions', conditions)}
          />
        </fieldset>
      )}

      <fieldset>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <legend className="font-display text-sm font-bold text-ink">Message</legend>
          <VariablePicker fields={fields} onInsert={insertToken} />
        </div>
        <RichTextComposer
          value={draft.bodyDocument}
          onChange={(bodyDocument) => update('bodyDocument', bodyDocument)}
          onInsertToken={onInsertToken}
        />
      </fieldset>

      <div className="flex items-end gap-2">
        <Button
          loading={loading}
          disabled={
            !draft.key ||
            !draft.name ||
            !draft.subject ||
            (draft.type === 'triggered' && (!draft.journeyId || !draft.statusId))
          }
          onClick={save}
        >
          Save campaign
        </Button>
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

/**
 * Only Fields the author can view are offered — the same visibility the server
 * re-checks on save. One template serves a whole batch, so availability is the
 * author's, decided here and at save time rather than per recipient.
 */
function VariablePicker({
  fields,
  onInsert,
}: {
  fields: readonly FieldDefinition[];
  onInsert: (token: string) => void;
}) {
  return (
    <Select
      aria-label="Insert a variable"
      className="w-56"
      value=""
      onChange={(event) => {
        if (event.target.value) onInsert(event.target.value);
      }}
    >
      <option value="">Insert a variable…</option>
      <optgroup label="Record">
        <option value="name">Name</option>
        <option value="email">Email</option>
        <option value="phone">Phone</option>
      </optgroup>
      <optgroup label="Fields">
        {fields.map((field) => (
          <option key={field.id} value={`field:${field.id}`}>
            {field.label}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}
