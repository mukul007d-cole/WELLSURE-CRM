import { useId, useState } from 'react';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Field } from '../../../components/ui/Field';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { friendlyErrorMessage } from '../../../lib/api-error';
import { cn } from '../../../lib/cn';
import { STATUS_COLORS, type Status, type StatusColor } from '../../../types/domain';
import { CheckboxMultiSelect, type MultiSelectOption } from './CheckboxMultiSelect';
import { STATUS_SWATCH_CLASS, colorLabel } from './status-colors';

/** The API's limit on `statuses.reason_options`. */
const MAX_REASONS = 50;

export type StatusDraft = {
  id?: string;
  key?: string;
  name: string;
  outcomeType: string;
  behaviorType: string;
  sortOrder: number;
  color: StatusColor | null;
  reasonOptions: string[];
  /** ADR-0026 status rules — saved through their own endpoint, see `rulesChanged`. */
  allowedRoleIds: string[];
  requiredFieldIds: string[];
};

export function newStatusDraft(sortOrder: number): StatusDraft {
  return {
    name: '',
    outcomeType: 'open',
    behaviorType: 'default',
    sortOrder,
    color: null,
    reasonOptions: [],
    allowedRoleIds: [],
    requiredFieldIds: [],
  };
}

export function fromStatus(status: Status): StatusDraft {
  return {
    id: status.id,
    key: status.key,
    name: status.name,
    outcomeType: status.outcomeType,
    behaviorType: status.behaviorType,
    sortOrder: status.sortOrder,
    color: status.color ?? null,
    reasonOptions: status.reasonOptions ?? [],
    allowedRoleIds: (status.allowedRoles ?? []).map((row) => row.roleId),
    requiredFieldIds: (status.requiredFields ?? []).map((row) => row.fieldId),
  };
}

/** What PATCH /statuses/:id and POST /journeys/:id/statuses take. */
export function statusBody(draft: StatusDraft) {
  return {
    name: draft.name,
    outcomeType: draft.outcomeType,
    behaviorType: draft.behaviorType,
    sortOrder: draft.sortOrder,
    color: draft.color,
    reasonOptions: draft.reasonOptions,
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * Whether the rules need a PUT. The endpoint is a full replace that writes an
 * audit row, so an edit that only renamed the Status must not send one.
 */
export function rulesChanged(draft: StatusDraft, stored: Status | undefined): boolean {
  const before = stored
    ? fromStatus(stored)
    : { allowedRoleIds: [] as string[], requiredFieldIds: [] as string[] };
  return (
    !sameSet(draft.allowedRoleIds, before.allowedRoleIds) ||
    !sameSet(draft.requiredFieldIds, before.requiredFieldIds)
  );
}

export function StatusEditor({
  draft,
  setDraft,
  save,
  cancel,
  loading,
  error,
  roleOptions,
  rolesLoading,
  fieldOptions,
}: {
  draft: StatusDraft;
  setDraft: (draft: StatusDraft) => void;
  save: () => void;
  cancel: () => void;
  loading: boolean;
  error: unknown;
  /**
   * Active roles, or null when the viewer cannot list roles. The picker is then
   * left out and the stored allow-list is sent back untouched.
   */
  roleOptions: readonly MultiSelectOption[] | null;
  rolesLoading: boolean;
  /** Fields shown on this Journey — the only ones the API accepts as required. */
  fieldOptions: readonly MultiSelectOption[];
}) {
  const update = (
    key: 'name' | 'outcomeType' | 'behaviorType' | 'sortOrder',
    value: string | number,
  ) => setDraft({ ...draft, [key]: value });
  return (
    <div className="grid gap-3 rounded-control border bg-paper p-3 sm:grid-cols-3">
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
      <div className="sm:col-span-3">
        <ColorPicker value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
      </div>
      <div className="sm:col-span-3">
        <ReasonsEditor
          reasons={draft.reasonOptions}
          onChange={(reasonOptions) => setDraft({ ...draft, reasonOptions })}
        />
      </div>
      {roleOptions ? (
        <div className="sm:col-span-3">
          <CheckboxMultiSelect
            legend="Who can choose this status"
            hint="Leave every role unticked and everyone can choose it. Landing here as a Journey's default on create, and routing moves, are never blocked."
            options={roleOptions}
            loading={rolesLoading}
            value={draft.allowedRoleIds}
            onChange={(allowedRoleIds) => setDraft({ ...draft, allowedRoleIds })}
          />
        </div>
      ) : null}
      <div className="sm:col-span-3">
        <CheckboxMultiSelect
          legend="Required to enter"
          hint="These Fields must hold a value before a lead can move into this status. Only Fields shown on this Journey can be required."
          options={fieldOptions}
          emptyText="No Fields are shown on this Journey yet — attach some on the Fields tab."
          value={draft.requiredFieldIds}
          onChange={(requiredFieldIds) => setDraft({ ...draft, requiredFieldIds })}
        />
      </div>
      {error ? (
        <div className="sm:col-span-3">
          <Banner tone="error">{friendlyErrorMessage(error)}</Banner>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <Button loading={loading} disabled={!draft.name} onClick={save}>
          Save Status
        </Button>
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Swatches for each palette token, plus "none". A radio group, keyboard-reachable. */
function ColorPicker({
  value,
  onChange,
}: {
  value: StatusColor | null;
  onChange: (color: StatusColor | null) => void;
}) {
  const labelId = useId();
  const swatch = 'h-7 w-7 rounded-pill border-2 transition-shadow';
  const ring = (selected: boolean) =>
    selected ? 'border-ink ring-2 ring-focus-ring/30' : 'border-surface hover:border-line-strong';
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-ink" id={labelId}>
        Color
      </span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={labelId}>
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          aria-label="No color"
          title="No color"
          className={cn(
            swatch,
            ring(value === null),
            'bg-surface text-xs text-ink-soft shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
          )}
          onClick={() => onChange(null)}
        >
          ∅
        </button>
        {STATUS_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={value === color}
            aria-label={colorLabel(color)}
            title={colorLabel(color)}
            className={cn(swatch, ring(value === color), STATUS_SWATCH_CLASS[color])}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The reasons a user may pick when entering this status. Order is kept as
 * entered — it is the order the picker offers them in.
 */
function ReasonsEditor({
  reasons,
  onChange,
}: {
  reasons: string[];
  onChange: (reasons: string[]) => void;
}) {
  const [next, setNext] = useState('');
  const trimmed = next.trim();
  // The API refuses blanks, duplicates and more than MAX_REASONS; say so here
  // rather than as a 400 on save.
  const duplicate = reasons.includes(trimmed);
  const full = reasons.length >= MAX_REASONS;
  const add = () => {
    if (!trimmed || duplicate || full) return;
    onChange([...reasons, trimmed]);
    setNext('');
  };
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-ink">Reasons</span>
      <p className="text-xs text-ink-soft">
        Optional. When set, whoever moves a lead here picks one of these reasons.
      </p>
      {reasons.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {reasons.map((reason) => (
            <li
              key={reason}
              className="inline-flex items-center gap-1 rounded-pill border border-line-strong bg-surface py-0.5 pl-2.5 pr-1 text-sm"
            >
              {reason}
              <button
                type="button"
                className="rounded-pill px-1.5 text-ink-soft hover:bg-surface-hover hover:text-ink"
                aria-label={`Remove reason ${reason}`}
                onClick={() => onChange(reasons.filter((value) => value !== reason))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Input
          aria-label="New reason"
          placeholder="Add a reason"
          value={next}
          disabled={full}
          onChange={(event) => setNext(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            add();
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          className="self-center"
          disabled={!trimmed || duplicate || full}
          onClick={add}
        >
          Add reason
        </Button>
      </div>
      {duplicate && trimmed ? (
        <p className="text-xs text-status-lost">That reason is already in the list.</p>
      ) : full ? (
        <p className="text-xs text-ink-soft">A status can have at most {MAX_REASONS} reasons.</p>
      ) : null}
    </div>
  );
}
