import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../../app/AuthContext';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { Field } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Pagination } from '../../components/ui/Pagination';
import { DataCell, DataRow, RowActions } from '../../components/ui/DataTable';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import type { AdminField, FieldAccessLevel, FieldRoleVisibility } from '../../types/domain';
import { PageBody, PageHeader } from '../../components/layout/PageFrame';
import { usePageChrome } from '../../app/page-chrome';
import { useUnsavedChanges } from '../../app/use-unsaved-changes';
import { ActiveFilter, AdminTable, activeValue, ADMIN_PAGE_SIZE, loadAllPages } from './shared';

type FieldDraft = {
  id?: string;
  key: string;
  name: string;
  fieldType: string;
  options: string;
  section: string;
  editMode: string;
  source: string;
  /** Roles granted this Field. Absent from the list means hidden. */
  visibility: FieldRoleVisibility[];
};
const emptyField = (): FieldDraft => ({
  key: '',
  name: '',
  fieldType: 'text',
  options: '',
  section: '',
  editMode: 'manual',
  source: 'manual',
  // A new Field starts granted to nobody, matching the server's default. The
  // picker must never pre-check anything.
  visibility: [],
});
export function FieldsPage() {
  usePageChrome('Fields', [['admin', 'fields']]);
  const { can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [active, setActive] = useState('true');
  const [draft, setDraft] = useState<FieldDraft | null>(null);
  useUnsavedChanges(draft !== null);
  const canGrant = can('roles_permissions', 'edit');
  const canSeeGrants = canGrant || can('roles_permissions', 'view');
  const query = useQuery({
    queryKey: ['admin', 'fields', page, active],
    queryFn: () => adminApi.fields(page, activeValue(active)),
  });
  // Every role, not just the active ones: a deactivated role keeps its
  // field_visibility rows, and a picker that couldn't show them would drop them
  // silently on the next full-replace save.
  const roles = useQuery({
    queryKey: ['admin', 'roles', 'field-editor'],
    queryFn: () => loadAllPages((page, pageSize) => adminApi.roles(page, undefined, pageSize)),
    enabled: draft !== null && canSeeGrants,
  });
  // An existing Field's grants load after the editor opens, then seed the
  // draft once — the same load-and-sync shape RoleDetailPage uses.
  const visibility = useQuery({
    queryKey: ['admin', 'field-visibility', draft?.id],
    queryFn: () => adminApi.fieldRoleVisibility(draft?.id ?? ''),
    enabled: Boolean(draft?.id) && canSeeGrants,
  });
  const [syncedVisibilityFieldId, setSyncedVisibilityFieldId] = useState<string | null>(null);
  if (draft?.id && visibility.data && syncedVisibilityFieldId !== draft.id) {
    setSyncedVisibilityFieldId(draft.id);
    setDraft({ ...draft, visibility: visibility.data });
  }
  /**
   * Opening the editor always re-syncs grants. Without clearing the marker,
   * reopening the *same* Field would leave it matching, the picker would show
   * the empty set `fromField` produces, and saving would full-replace the
   * Field's real grants with nothing.
   */
  const openDraft = (next: FieldDraft) => {
    setSyncedVisibilityFieldId(null);
    setDraft(next);
  };
  // Whether the draft's grants reflect what is stored. A brand-new Field is
  // ready immediately — granted to nobody is its real state. An existing one
  // isn't until its rows arrive, and until then Save leaves grants alone
  // rather than full-replacing them with a set it never read.
  const visibilityKnown = draft?.id === undefined || syncedVisibilityFieldId === draft.id;
  const visibilityLoading = Boolean(draft?.id) && canSeeGrants && visibility.isPending;
  const save = useMutation({
    mutationFn: async () => {
      const current = draft ?? emptyField();
      const body = fieldBody(current);
      const saved = current.id
        ? await adminApi.editField(current.id, body)
        : await adminApi.createField(body);
      // Two requests, not one: the Field itself is gated on `fields`, the
      // grants on `roles_permissions`. If this second call fails the Field
      // exists granted to nobody — the documented default, not a half-open
      // Field — and the banner says so.
      const writeGrants = current.id
        ? visibilityKnown
        : // No point sending an empty replacement for a Field that was just
          // created with no rows.
          current.visibility.length > 0;
      if (canGrant && writeGrants)
        await adminApi.saveFieldRoleVisibility(saved.id, current.visibility);
      return saved;
    },
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'fields'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'field-visibility'] });
    },
  });
  const deactivate = useMutation({
    mutationFn: adminApi.deactivateField,
    onSuccess: async () => qc.invalidateQueries({ queryKey: ['admin', 'fields'] }),
  });
  const error = query.error ?? roles.error ?? visibility.error ?? save.error ?? deactivate.error;
  return (
    <PageBody>
      <PageHeader
        title="Fields"
        description="Manage reusable Field definitions independently from Journeys."
        actions={
          can('fields', 'create') ? (
            <Button onClick={() => openDraft(emptyField())}>Create Field</Button>
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
          roles={roles.data ?? []}
          rolesLoading={roles.isPending || visibilityLoading}
          showVisibility={canSeeGrants}
          canEditVisibility={canGrant && visibilityKnown}
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
                  <Button size="sm" variant="ghost" onClick={() => openDraft(fromField(field))}>
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
    // Filled in by the caller from the Field's stored grants.
    visibility: [],
  };
}
/**
 * Two checkboxes over one tri-state cell.
 *
 * `field_visibility` stores VIEW, EDIT, or no row at all, and EDIT includes
 * viewing (`docs/permissions/access-model.md`). So the boxes are bound, not
 * independent: Edit implies View, and clearing View clears Edit. The fourth
 * combination — edit without view — is unrepresentable, which is exactly why
 * this isn't two free booleans.
 */
function RoleVisibilityRow({
  role,
  level,
  disabled,
  onChange,
}: {
  role: { id: string; name: string; active: boolean };
  level: FieldAccessLevel | undefined;
  disabled: boolean;
  onChange: (level: FieldAccessLevel | undefined) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 rounded-control px-2 py-1">
      <span className="truncate text-sm text-ink">
        {role.name}
        {role.active ? null : <span className="ml-1 text-xs text-ink-soft">(inactive)</span>}
      </span>
      <Checkbox
        label="View"
        disabled={disabled}
        aria-label={`${role.name} view`}
        checked={level !== undefined}
        onChange={(event) => onChange(event.target.checked ? 'VIEW' : undefined)}
      />
      <Checkbox
        label="Edit"
        disabled={disabled}
        aria-label={`${role.name} edit`}
        checked={level === 'EDIT'}
        onChange={(event) => onChange(event.target.checked ? 'EDIT' : 'VIEW')}
      />
    </div>
  );
}

function FieldEditor({
  draft,
  setDraft,
  save,
  cancel,
  loading,
  roles,
  rolesLoading,
  showVisibility,
  canEditVisibility,
}: {
  draft: FieldDraft;
  setDraft: (draft: FieldDraft) => void;
  save: () => void;
  cancel: () => void;
  loading: boolean;
  roles: Array<{ id: string; name: string; active: boolean }>;
  rolesLoading: boolean;
  showVisibility: boolean;
  canEditVisibility: boolean;
}) {
  const update = (key: keyof FieldDraft, value: string) => setDraft({ ...draft, [key]: value });
  const setRoleLevel = (roleId: string, level: FieldAccessLevel | undefined) =>
    setDraft({
      ...draft,
      visibility: [
        ...draft.visibility.filter((row) => row.roleId !== roleId),
        ...(level === undefined ? [] : [{ roleId, accessLevel: level }]),
      ],
    });
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
      {showVisibility ? (
        <fieldset className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-3 border-b border-line pb-1.5">
            <legend className="font-display text-sm font-bold text-ink">Role visibility</legend>
            {canEditVisibility ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      visibility: roles.map((role) => ({
                        roleId: role.id,
                        accessLevel: 'VIEW' as const,
                      })),
                    })
                  }
                >
                  Grant view to all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft({ ...draft, visibility: [] })}
                >
                  Clear all
                </Button>
              </div>
            ) : null}
          </div>
          <p className="mb-2 text-xs text-ink-soft">
            Roles with neither box ticked cannot see this Field at all — its values are stripped
            from every response server-side. New Fields start hidden from every role.
          </p>
          {rolesLoading ? (
            <p className="text-sm text-ink-soft">Loading roles…</p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {roles.map((role) => (
                <RoleVisibilityRow
                  key={role.id}
                  role={role}
                  level={draft.visibility.find((row) => row.roleId === role.id)?.accessLevel}
                  disabled={!canEditVisibility}
                  onChange={(level) => setRoleLevel(role.id, level)}
                />
              ))}
            </div>
          )}
        </fieldset>
      ) : null}
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
