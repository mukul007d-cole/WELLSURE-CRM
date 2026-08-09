import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Pagination } from '../../components/ui/Pagination';
import { DataCell, DataRow, RowActions } from '../../components/ui/DataTable';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import type { AdminField } from '../../types/domain';
import { PageBody, PageHeader } from '../../components/layout/PageFrame';
import { usePageChrome } from '../../app/page-chrome';
import { ActiveFilter, AdminTable, activeValue, ADMIN_PAGE_SIZE } from './shared';

type FieldDraft = {
  id?: string;
  key: string;
  name: string;
  fieldType: string;
  options: string;
  section: string;
  editMode: string;
  source: string;
};
const emptyField = (): FieldDraft => ({
  key: '',
  name: '',
  fieldType: 'text',
  options: '',
  section: '',
  editMode: 'manual',
  source: 'manual',
});
export function FieldsPage() {
  usePageChrome('Fields', [['admin', 'fields']]);
  const { can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [active, setActive] = useState('true');
  const [draft, setDraft] = useState<FieldDraft | null>(null);
  const query = useQuery({
    queryKey: ['admin', 'fields', page, active],
    queryFn: () => adminApi.fields(page, activeValue(active)),
  });
  const save = useMutation({
    mutationFn: () => {
      const body = fieldBody(draft ?? emptyField());
      return draft?.id ? adminApi.editField(draft.id, body) : adminApi.createField(body);
    },
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'fields'] });
    },
  });
  const deactivate = useMutation({
    mutationFn: adminApi.deactivateField,
    onSuccess: async () => qc.invalidateQueries({ queryKey: ['admin', 'fields'] }),
  });
  const error = query.error ?? save.error ?? deactivate.error;
  return (
    <PageBody>
      <PageHeader
        title="Fields"
        description="Manage reusable Field definitions independently from Journeys."
        actions={
          can('fields', 'create') ? (
            <Button onClick={() => setDraft(emptyField())}>Create Field</Button>
          ) : undefined
        }
      />
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      {draft ? (
        <FieldEditor
          draft={draft}
          setDraft={setDraft}
          save={() => save.mutate()}
          cancel={() => setDraft(null)}
          loading={save.isPending}
        />
      ) : null}
      <ActiveFilter
        id="field-active"
        value={active}
        onChange={(value) => {
          setActive(value);
          setPage(1);
        }}
      />
      <AdminTable
        loading={query.isPending}
        headers={[
          'Name',
          'Type',
          'Options',
          'State',
          { label: 'Actions', align: 'right' as const },
        ]}
        empty={!query.isPending && !query.data?.items.length}
      >
        {query.data?.items.map((field) => (
          <DataRow key={field.id}>
            <DataCell primary>
              <span className="block">{field.name}</span>
              <span className="text-xs text-ink-soft">{field.key}</span>
            </DataCell>
            <DataCell>{field.fieldType}</DataCell>
            <DataCell>{field.validationRule?.options?.join(', ') ?? '—'}</DataCell>
            <DataCell>{field.active ? 'Active' : 'Inactive'}</DataCell>
            <DataCell align="right">
              <RowActions>
                {can('fields', 'edit') ? (
                  <Button size="sm" variant="ghost" onClick={() => setDraft(fromField(field))}>
                    Edit
                  </Button>
                ) : null}
                {can('fields', 'delete') && field.active ? (
                  <Button size="sm" variant="danger" onClick={() => deactivate.mutate(field.id)}>
                    Deactivate
                  </Button>
                ) : null}
              </RowActions>
            </DataCell>
          </DataRow>
        ))}
      </AdminTable>
      {query.data ? (
        <Pagination
          page={query.data.page}
          pageSize={query.data.pageSize || ADMIN_PAGE_SIZE}
          total={query.data.total}
          onPageChange={setPage}
        />
      ) : null}
    </PageBody>
  );
}
function fieldBody(draft: FieldDraft) {
  return {
    key: draft.key,
    name: draft.name,
    fieldType: draft.fieldType,
    validationRule:
      draft.fieldType === 'select'
        ? {
            options: draft.options
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean),
          }
        : null,
    section: draft.section || null,
    editMode: draft.editMode,
    source: draft.source,
  };
}
function fromField(field: AdminField): FieldDraft {
  return {
    id: field.id,
    key: field.key,
    name: field.name,
    fieldType: field.fieldType,
    options: field.validationRule?.options?.join('\n') ?? '',
    section: field.section ?? '',
    editMode: field.editMode,
    source: field.source,
  };
}
function FieldEditor({
  draft,
  setDraft,
  save,
  cancel,
  loading,
}: {
  draft: FieldDraft;
  setDraft: (draft: FieldDraft) => void;
  save: () => void;
  cancel: () => void;
  loading: boolean;
}) {
  const update = (key: keyof FieldDraft, value: string) => setDraft({ ...draft, [key]: value });
  return (
    <Card className="grid gap-3 p-4 sm:grid-cols-2">
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
      <Field label="Type" required>
        {({ inputId }) => (
          <Select
            id={inputId}
            value={draft.fieldType}
            onChange={(event) => update('fieldType', event.target.value)}
          >
            {[
              'text',
              'textarea',
              'email',
              'phone',
              'date',
              'select',
              'number',
              'boolean',
              'json',
            ].map((type) => (
              <option key={type}>{type}</option>
            ))}
          </Select>
        )}
      </Field>
      {draft.fieldType === 'select' ? (
        <Field label="Options" hint="One unique option per line." required>
          {({ inputId }) => (
            <textarea
              id={inputId}
              className="min-h-28 rounded-control border bg-surface p-3 text-sm"
              value={draft.options}
              onChange={(event) => update('options', event.target.value)}
            />
          )}
        </Field>
      ) : null}
      <Field label="Edit mode">
        {({ inputId }) => (
          <Select
            id={inputId}
            value={draft.editMode}
            onChange={(event) => update('editMode', event.target.value)}
          >
            {['manual', 'locked', 'calculated', 'system', 'api-only'].map((mode) => (
              <option key={mode}>{mode}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Source">
        {({ inputId }) => (
          <Select
            id={inputId}
            value={draft.source}
            onChange={(event) => update('source', event.target.value)}
          >
            {['manual', 'system', 'api', 'import', 'calculated'].map((source) => (
              <option key={source}>{source}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Section">
        {({ inputId }) => (
          <Input
            id={inputId}
            value={draft.section}
            onChange={(event) => update('section', event.target.value)}
          />
        )}
      </Field>
      <div className="flex items-end gap-2">
        <Button
          loading={loading}
          disabled={
            !draft.key || !draft.name || (draft.fieldType === 'select' && !draft.options.trim())
          }
          onClick={save}
        >
          Save Field
        </Button>
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
