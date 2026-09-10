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
import { PurgeDialog } from '../../components/ui/PurgeDialog';
import { DataCell, DataRow, RowActions } from '../../components/ui/DataTable';
import { adminApi } from '../../lib/api-client';
import { friendlyErrorMessage } from '../../lib/api-error';
import type {
  AdminField,
  CalculationConfig,
  FieldAccessLevel,
  FieldRoleVisibility,
} from '../../types/domain';
import { PageBody, PageHeader } from '../../components/layout/PageFrame';
import { usePageChrome } from '../../app/page-chrome';
import { useUnsavedChanges, useUnsavedDraft } from '../../app/use-unsaved-changes';
import { ActiveFilter, AdminTable, activeValue, ADMIN_PAGE_SIZE, loadAllPages } from './shared';

const EDIT_MODES = ['manual', 'locked', 'calculated', 'system', 'api-only'] as const;
const SOURCES = ['manual', 'system', 'api', 'import', 'calculated'] as const;
/**
 * What `source` defaults to when an admin picks an edit mode, so the two
 * axes don't have to be set independently for the common case — still
 * freely overridable afterward (e.g. a field whose *initial* value came from
 * `import` but that reps can hand-edit after is `source: import`,
 * `editMode: manual`, a combination this suggestion never produces on its
 * own but doesn't prevent either).
 */
const SOURCE_SUGGESTION: Record<string, string> = {
  manual: 'manual',
  locked: 'manual',
  calculated: 'calculated',
  system: 'system',
  'api-only': 'api',
};
/** The only two fieldTypes a calculated Field can have — arithmetic needs a number, a template needs text. */
const CALCULABLE_TYPES = new Set(['number', 'text', 'textarea']);

type OperandDraft = { kind: 'field' | 'constant'; fieldId: string; constant: string };
type CalculationDraft =
  | { mode: 'arithmetic'; left: OperandDraft; operator: string; right: OperandDraft }
  | { mode: 'template'; template: string };

const emptyOperand = (): OperandDraft => ({ kind: 'constant', fieldId: '', constant: '' });
const emptyCalculation = (): CalculationDraft => ({
  mode: 'arithmetic',
  left: emptyOperand(),
  operator: '+',
  right: emptyOperand(),
});

type FieldDraft = {
  id?: string;
  key?: string;
  name: string;
  fieldType: string;
  options: string;
  section: string;
  editMode: string;
  source: string;
  /** Stops the edit-mode → source auto-suggestion once the admin has picked their own. */
  sourceManuallySet: boolean;
  calculation: CalculationDraft;
  systemKey: string;
  /** Roles granted this Field. Absent from the list means hidden. */
  visibility: FieldRoleVisibility[];
};
const emptyField = (): FieldDraft => ({
  name: '',
  fieldType: 'text',
  options: '',
  section: '',
  editMode: 'manual',
  source: 'manual',
  sourceManuallySet: false,
  calculation: emptyCalculation(),
  systemKey: '',
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
  const [purging, setPurging] = useState<AdminField | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  // The draft as it was loaded. Compared against, so merely opening the editor
  // is not treated as unsaved work.
  const [pristine, setPristine] = useState<FieldDraft | null>(null);
  useUnsavedDraft(draft, pristine);
  useUnsavedChanges(order !== null);
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
  // Every active Field, unpaginated — the editor needs it to offer calculation
  // references and existing Section names, and the reorder panel needs it to
  // show every Field at once rather than one paginated page's worth. Fetched
  // only when one of those is actually open.
  const allFields = useQuery({
    queryKey: ['admin', 'fields', 'all-active'],
    queryFn: () => loadAllPages((page, pageSize) => adminApi.fields(page, true, pageSize)),
    enabled: draft !== null || reorderOpen,
  });
  const [syncedVisibilityFieldId, setSyncedVisibilityFieldId] = useState<string | null>(null);
  if (draft?.id && visibility.data && syncedVisibilityFieldId !== draft.id) {
    setSyncedVisibilityFieldId(draft.id);
    const hydrated = { ...draft, visibility: visibility.data };
    setDraft(hydrated);
    setPristine(hydrated);
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
    setPristine(next);
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
      setPristine(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'fields'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'field-visibility'] });
    },
  });
  const deactivate = useMutation({
    mutationFn: adminApi.deactivateField,
    onSuccess: async () => qc.invalidateQueries({ queryKey: ['admin', 'fields'] }),
  });
  const purge = useMutation({
    mutationFn: adminApi.purgeField,
    onSuccess: async () => {
      setPurging(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'fields'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'field-visibility'] });
    },
  });
  const reorder = useMutation({
    mutationFn: () => adminApi.reorderFields(order ?? []),
    onSuccess: async () => {
      setOrder(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'fields'] });
    },
  });
  const orderedFields = (order ?? (allFields.data ?? []).map((field) => field.id))
    .map((id) => (allFields.data ?? []).find((field) => field.id === id))
    .filter((field): field is AdminField => Boolean(field));
  const moveField = (index: number, direction: -1 | 1) => {
    const next = [...orderedFields.map((field) => field.id)];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    setOrder(next);
  };
  const sectionOptions = [
    ...new Set(
      (allFields.data ?? [])
        .map((field) => field.section?.trim())
        .filter((section): section is string => Boolean(section)),
    ),
  ];
  // Any other active Field the draft's calculation may reference: not itself
  // (no self-reference) and not another calculated Field (no chaining) —
  // matches the server's own `parseCalculationConfig` rules exactly, so the
  // picker never offers something Save would reject anyway.
  const eligibleCalculationFields = (allFields.data ?? []).filter(
    (field) => field.id !== draft?.id && field.editMode !== 'calculated',
  );
  // The purge failure belongs in its dialog beside what is being deleted, not
  // in the page banner.
  const error =
    query.error ??
    roles.error ??
    visibility.error ??
    save.error ??
    deactivate.error ??
    reorder.error;
  return (
    <PageBody>
      <PageHeader
        title="Fields"
        description="Manage reusable Field definitions independently from Journeys."
        actions={
          <>
            {can('fields', 'edit') ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setReorderOpen((open) => !open);
                  setOrder(null);
                }}
              >
                {reorderOpen ? 'Hide field order' : 'Reorder fields'}
              </Button>
            ) : null}
            {can('fields', 'create') ? (
              <Button onClick={() => openDraft(emptyField())}>Create Field</Button>
            ) : undefined}
          </>
        }
      />
      {error ? <Banner tone="error">{friendlyErrorMessage(error)}</Banner> : null}
      {reorderOpen ? (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-lg font-semibold">Field order</h3>
            <p className="text-xs text-ink-soft">
              Controls display order on the Details tab, the lead form, and this list — a Section's
              position follows its first Field's.
            </p>
          </div>
          {allFields.isPending ? (
            <p className="text-sm text-ink-soft">Loading…</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {orderedFields.map((field, index) => (
                <li
                  key={field.id}
                  className="flex items-center justify-between gap-2 rounded-control border border-line-soft px-3 py-2"
                >
                  <span className="text-sm text-ink">
                    {index + 1}. {field.name}
                    {field.section ? (
                      <span className="ml-2 text-xs text-ink-soft">({field.section})</span>
                    ) : null}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Move ${field.name} up`}
                      disabled={index === 0}
                      onClick={() => moveField(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Move ${field.name} down`}
                      disabled={index === orderedFields.length - 1}
                      onClick={() => moveField(index, 1)}
                    >
                      ↓
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {order ? (
            <div className="flex gap-2">
              <Button loading={reorder.isPending} onClick={() => reorder.mutate()}>
                Save Field order
              </Button>
              <Button variant="ghost" onClick={() => setOrder(null)}>
                Reset
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
      {draft ? (
        <FieldEditor
          draft={draft}
          setDraft={setDraft}
          save={() => save.mutate()}
          cancel={() => {
            setDraft(null);
            setPristine(null);
          }}
          loading={save.isPending}
          roles={roles.data ?? []}
          rolesLoading={roles.isPending || visibilityLoading}
          showVisibility={canSeeGrants}
          canEditVisibility={canGrant && visibilityKnown}
          sectionOptions={sectionOptions}
          eligibleCalculationFields={eligibleCalculationFields}
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
          'Edit mode',
          'Source',
          'Section',
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
            <DataCell>{field.editMode}</DataCell>
            <DataCell>{field.source}</DataCell>
            <DataCell>{field.section ?? '—'}</DataCell>
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
                {can('fields', 'purge') && !field.active ? (
                  <Button size="sm" variant="danger" onClick={() => setPurging(field)}>
                    Delete permanently
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
      {purging ? (
        <PurgeDialog
          entityLabel="Field"
          entityKey={purging.key}
          entityName={purging.name}
          loading={purge.isPending}
          error={purge.error}
          onCancel={() => {
            purge.reset();
            setPurging(null);
          }}
          onConfirm={() => purge.mutate(purging.id)}
        />
      ) : null}
    </PageBody>
  );
}

function operandToConfig(operand: OperandDraft) {
  return operand.kind === 'field'
    ? { type: 'field' as const, fieldId: operand.fieldId }
    : { type: 'constant' as const, value: Number(operand.constant) };
}
function calculationToConfig(draft: CalculationDraft) {
  if (draft.mode === 'template') return { kind: 'template' as const, template: draft.template };
  return {
    kind: 'arithmetic' as const,
    left: operandToConfig(draft.left),
    operator: draft.operator as '+' | '-' | '*' | '/',
    right: operandToConfig(draft.right),
  };
}
function operandFromConfig(
  operand: Extract<CalculationConfig, { kind: 'arithmetic' }>['left'],
): OperandDraft {
  return operand.type === 'field'
    ? { kind: 'field', fieldId: operand.fieldId, constant: '' }
    : { kind: 'constant', fieldId: '', constant: String(operand.value) };
}
function calculationFromField(field: AdminField): CalculationDraft {
  const calc = field.validationRule?.calculation;
  if (!calc) return emptyCalculation();
  if (calc.kind === 'template') return { mode: 'template', template: calc.template };
  return {
    mode: 'arithmetic',
    left: operandFromConfig(calc.left),
    operator: calc.operator,
    right: operandFromConfig(calc.right),
  };
}
/** Whether Save should be blocked because the calculation draft can't yet be sent as-is. */
function calculationIncomplete(calculation: CalculationDraft): boolean {
  if (calculation.mode === 'template') return calculation.template.trim() === '';
  const operandIncomplete = (operand: OperandDraft) =>
    operand.kind === 'field'
      ? operand.fieldId === ''
      : operand.constant.trim() === '' || Number.isNaN(Number(operand.constant));
  return operandIncomplete(calculation.left) || operandIncomplete(calculation.right);
}
function fieldBody(draft: FieldDraft) {
  return {
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
    ...(draft.editMode === 'calculated'
      ? { calculation: calculationToConfig(draft.calculation) }
      : {}),
    ...(draft.editMode === 'system' ? { system: { key: draft.systemKey } } : {}),
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
    // An existing Field's source was already deliberately set — don't let a
    // later edit-mode change in this session silently override it.
    sourceManuallySet: true,
    calculation: calculationFromField(field),
    systemKey: field.validationRule?.system?.key ?? '',
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

/** One operand of an arithmetic calculation: a Field's value, or a constant. */
function OperandEditor({
  label,
  operand,
  fields,
  onChange,
}: {
  label: string;
  operand: OperandDraft;
  fields: AdminField[];
  onChange: (operand: OperandDraft) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Field label={label}>
        {({ inputId }) => (
          <Select
            id={inputId}
            value={operand.kind}
            onChange={(event) =>
              onChange({ ...operand, kind: event.target.value as 'field' | 'constant' })
            }
          >
            <option value="constant">Constant</option>
            <option value="field">Field</option>
          </Select>
        )}
      </Field>
      {operand.kind === 'constant' ? (
        <Input
          aria-label={`${label} constant value`}
          type="number"
          value={operand.constant}
          onChange={(event) => onChange({ ...operand, constant: event.target.value })}
        />
      ) : (
        <Select
          aria-label={`${label} field`}
          value={operand.fieldId}
          onChange={(event) => onChange({ ...operand, fieldId: event.target.value })}
        >
          <option value="">Choose a field…</option>
          {fields.map((field) => (
            <option key={field.id} value={field.id}>
              {field.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

/**
 * The config panel for `editMode: 'calculated'`. The mode itself isn't a
 * choice here — it follows the Field's own type (a number Field can only be
 * arithmetic, a text/textarea Field can only be a template), matching what
 * the server's `parseCalculationConfig` accepts — so there is nothing to pick
 * beyond the operands or the template text.
 */
function CalculationEditor({
  calculation,
  onChange,
  eligibleFields,
}: {
  calculation: CalculationDraft;
  onChange: (calculation: CalculationDraft) => void;
  eligibleFields: AdminField[];
}) {
  if (calculation.mode === 'template') {
    return (
      <div className="flex flex-col gap-2 rounded-control border border-line-soft p-3 sm:col-span-2">
        <Field
          label="Template"
          hint="Click a field below to insert its value — or type {{field:<id>}} directly."
        >
          {({ inputId }) => (
            <textarea
              id={inputId}
              className="min-h-20 rounded-control border bg-surface p-3 text-sm"
              value={calculation.template}
              onChange={(event) => onChange({ ...calculation, template: event.target.value })}
            />
          )}
        </Field>
        {eligibleFields.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {eligibleFields.map((field) => (
              <button
                key={field.id}
                type="button"
                className="rounded-pill border border-line-strong px-2 py-1 text-xs text-ink-soft hover:border-ink hover:text-ink"
                onClick={() =>
                  onChange({
                    ...calculation,
                    template: `${calculation.template}{{field:${field.id}}}`,
                  })
                }
              >
                {field.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  const numericFields = eligibleFields.filter((field) => field.fieldType === 'number');
  return (
    <div className="grid grid-cols-1 gap-2 rounded-control border border-line-soft p-3 sm:col-span-2 sm:grid-cols-3">
      <OperandEditor
        label="Left"
        operand={calculation.left}
        fields={numericFields}
        onChange={(left) => onChange({ ...calculation, left })}
      />
      <Field label="Operator">
        {({ inputId }) => (
          <Select
            id={inputId}
            value={calculation.operator}
            onChange={(event) => onChange({ ...calculation, operator: event.target.value })}
          >
            {['+', '-', '*', '/'].map((operator) => (
              <option key={operator} value={operator}>
                {operator}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <OperandEditor
        label="Right"
        operand={calculation.right}
        fields={numericFields}
        onChange={(right) => onChange({ ...calculation, right })}
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
  sectionOptions,
  eligibleCalculationFields,
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
  sectionOptions: string[];
  eligibleCalculationFields: AdminField[];
}) {
  const update = (key: keyof FieldDraft, value: string) => setDraft({ ...draft, [key]: value });
  const updateFieldType = (nextType: string) => {
    // Keep the calculation mode valid for the new type rather than leaving a
    // stale arithmetic/template config the server would refuse on save.
    const impliedMode =
      nextType === 'number'
        ? 'arithmetic'
        : nextType === 'text' || nextType === 'textarea'
          ? 'template'
          : null;
    const calculation =
      impliedMode !== null && impliedMode !== draft.calculation.mode
        ? impliedMode === 'arithmetic'
          ? emptyCalculation()
          : ({ mode: 'template', template: '' } as const)
        : draft.calculation;
    setDraft({ ...draft, fieldType: nextType, calculation });
  };
  const updateEditMode = (nextEditMode: string) =>
    setDraft({
      ...draft,
      editMode: nextEditMode,
      source: draft.sourceManuallySet
        ? draft.source
        : (SOURCE_SUGGESTION[nextEditMode] ?? draft.source),
    });
  const updateSource = (value: string) =>
    setDraft({ ...draft, source: value, sourceManuallySet: true });
  const setRoleLevel = (roleId: string, level: FieldAccessLevel | undefined) =>
    setDraft({
      ...draft,
      visibility: [
        ...draft.visibility.filter((row) => row.roleId !== roleId),
        ...(level === undefined ? [] : [{ roleId, accessLevel: level }]),
      ],
    });
  const calculationUnsupportedType =
    draft.editMode === 'calculated' && !CALCULABLE_TYPES.has(draft.fieldType);
  const saveDisabled =
    !draft.name ||
    (draft.fieldType === 'select' && !draft.options.trim()) ||
    (draft.editMode === 'calculated' &&
      (calculationUnsupportedType || calculationIncomplete(draft.calculation))) ||
    (draft.editMode === 'system' && !draft.systemKey.trim());
  return (
    <Card className="grid gap-3 p-4 sm:grid-cols-2">
      {draft.id ? (
        // The key is computed from the name at creation and never changes
        // afterward — shown here read-only, for API/URL reference, not as an
        // editable field.
        <Field label="Stable key">
          {({ inputId }) => <Input id={inputId} disabled value={draft.key} />}
        </Field>
      ) : null}
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
            onChange={(event) => updateFieldType(event.target.value)}
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
            onChange={(event) => updateEditMode(event.target.value)}
          >
            {EDIT_MODES.map((mode) => (
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
            onChange={(event) => updateSource(event.target.value)}
          >
            {SOURCES.map((source) => (
              <option key={source}>{source}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Section" hint="Groups this Field with others on the Details tab and lead form.">
        {({ inputId }) => (
          <>
            <Input
              id={inputId}
              list="field-section-options"
              value={draft.section}
              onChange={(event) => update('section', event.target.value)}
            />
            <datalist id="field-section-options">
              {sectionOptions.map((section) => (
                <option key={section} value={section} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      {draft.editMode === 'calculated' ? (
        calculationUnsupportedType ? (
          <p className="text-sm text-status-lost sm:col-span-2">
            Calculated fields must be type Number (for an arithmetic calculation) or Text/Textarea
            (for a template).
          </p>
        ) : (
          <CalculationEditor
            calculation={draft.calculation}
            onChange={(calculation) => setDraft({ ...draft, calculation })}
            eligibleFields={eligibleCalculationFields}
          />
        )
      ) : null}
      {draft.editMode === 'system' ? (
        <Field
          label="System key"
          hint="Free text for now — no catalog of system-populated values exists yet, so nothing sets this automatically."
        >
          {({ inputId }) => (
            <Input
              id={inputId}
              value={draft.systemKey}
              onChange={(event) => update('systemKey', event.target.value)}
            />
          )}
        </Field>
      ) : null}
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
        <Button loading={loading} disabled={saveDisabled} onClick={save}>
          Save Field
        </Button>
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
