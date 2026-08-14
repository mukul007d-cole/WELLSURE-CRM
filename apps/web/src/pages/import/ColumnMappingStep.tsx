import { Banner } from '../../components/ui/Banner';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { Eyebrow, Heading } from '../../components/ui/Heading';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { cn } from '../../lib/cn';
import type {
  ImportAnalysis,
  ImportAnalysisColumn,
  ImportColumnTarget,
  ImportMatchKey,
} from '../../types/domain';
import {
  availableMatchKeys,
  claimedTargets,
  mappedCount,
  matchKeyValue,
  targetValue,
  type MappingDraft,
  type TargetOption,
} from './import-state';

/**
 * Step two: source column → target.
 *
 * Not a table of dropdowns. Each column is a card showing what is actually in
 * it — three real values and how full it is — beside the target it will be
 * written to, because an admin mapping a legacy export is reading the *data* to
 * work out what a column called `pcid` holds, not the header.
 *
 * A mapped card is connected to its target and sits on `surface`; a skipped one
 * recedes. That distinction is carried by more than colour: a skipped card's
 * target reads "Don't import" in words.
 */
export function ColumnMappingStep({
  analysis,
  draft,
  options,
  journeys,
  statuses,
  users,
  fields,
  problems,
  onChange,
}: {
  analysis: ImportAnalysis;
  draft: MappingDraft;
  options: TargetOption[];
  journeys: readonly { id: string; name: string }[];
  statuses: readonly { id: string; name: string }[];
  users: readonly { id: string; name: string }[];
  fields: readonly { id: string; label: string }[];
  problems: string[];
  onChange: (next: MappingDraft) => void;
}) {
  const mapped = mappedCount(draft.columns);
  const total = analysis.columns.length;
  const groups = [...new Set(options.map((option) => option.group))];
  const matchKeyChoices = availableMatchKeys(draft.columns, fields);
  const selectedKeys = new Set(draft.matchKeys.map(matchKeyValue));

  const setColumn = (name: string, target: ImportColumnTarget) => {
    const columns = { ...draft.columns, [name]: target };
    // A match key whose column just stopped being mapped would be rejected by
    // the server; drop it here so the admin never has to work that out.
    const stillAvailable = new Set(
      availableMatchKeys(columns, fields).map((entry) => matchKeyValue(entry.key)),
    );
    onChange({
      ...draft,
      columns,
      matchKeys: draft.matchKeys.filter((key) => stillAvailable.has(matchKeyValue(key))),
    });
  };

  const toggleMatchKey = (key: ImportMatchKey, checked: boolean) => {
    const value = matchKeyValue(key);
    onChange({
      ...draft,
      matchKeys: checked
        ? [...draft.matchKeys, key]
        : draft.matchKeys.filter((existing) => matchKeyValue(existing) !== value),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {analysis.raggedRowNumbers.length > 0 ? (
        <Banner tone="info">
          {analysis.raggedRowNumbers.length === 1
            ? `Row ${analysis.raggedRowNumbers[0]} has a different number of columns from the header.`
            : `${analysis.raggedRowNumbers.length} rows have a different number of columns from the header (first: row ${analysis.raggedRowNumbers[0]}).`}{' '}
          Missing values are read as blank — check the preview before committing.
        </Banner>
      ) : null}

      <Card>
        <CardHeader title="Where these leads go" description="Applied to every row in the file." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Journey" required>
            {({ inputId }) => (
              <Select
                id={inputId}
                value={draft.journeyId}
                onChange={(event) =>
                  onChange({ ...draft, journeyId: event.target.value, statusId: '' })
                }
              >
                <option value="">Choose a journey…</option>
                {journeys.map((journey) => (
                  <option key={journey.id} value={journey.id}>
                    {journey.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Starting status"
            hint="Leave as the journey default unless a column sets it per row."
          >
            {({ inputId, describedBy }) => (
              <Select
                id={inputId}
                aria-describedby={describedBy}
                value={draft.statusId}
                disabled={draft.journeyId === ''}
                onChange={(event) => onChange({ ...draft, statusId: event.target.value })}
              >
                <option value="">Journey default</option>
                {statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Owner type"
            hint="A free-text assignment type, e.g. the one your journey already uses."
          >
            {({ inputId, describedBy }) => (
              <input
                id={inputId}
                aria-describedby={describedBy}
                value={draft.assignmentType}
                onChange={(event) => onChange({ ...draft, assignmentType: event.target.value })}
                className="h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-soft hover:border-ink-soft"
                placeholder="lead_owner"
              />
            )}
          </Field>
          <Field label="Owner" hint="Or map a column of owner email addresses below.">
            {({ inputId, describedBy }) => (
              <Select
                id={inputId}
                aria-describedby={describedBy}
                value={draft.assignmentUserId}
                onChange={(event) => onChange({ ...draft, assignmentUserId: event.target.value })}
              >
                <option value="">No file-wide owner</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Columns"
          description="Every column is left out until you choose where it goes."
          actions={
            <span className="flex items-center gap-3">
              <span className="text-sm font-medium text-ink">
                {mapped} of {total} mapped
              </span>
              <span aria-hidden="true" className="h-1.5 w-24 overflow-hidden rounded-pill bg-line">
                <span
                  className="block h-full rounded-pill bg-gold transition-[width]"
                  style={{ width: `${total === 0 ? 0 : (mapped / total) * 100}%` }}
                />
              </span>
            </span>
          }
        />
        <CardBody className="flex flex-col gap-2">
          {analysis.columns.map((column) => (
            <ColumnRow
              key={column.name}
              column={column}
              target={draft.columns[column.name] ?? { kind: 'skip' }}
              options={options}
              groups={groups}
              claimed={claimedTargets(draft.columns, column.name)}
              onChange={(target) => setColumn(column.name, target)}
            />
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Duplicate matching"
          description="Off unless you choose at least one. A row matches only when every chosen value is filled in and identical."
        />
        <CardBody className="flex flex-col gap-2">
          {matchKeyChoices.length === 0 ? (
            <p className="text-sm text-ink-soft">
              Map a column to a lead detail or a field first — matching can only use something the
              file actually writes.
            </p>
          ) : (
            matchKeyChoices.map((choice) => (
              <Checkbox
                key={matchKeyValue(choice.key)}
                label={choice.label}
                checked={selectedKeys.has(matchKeyValue(choice.key))}
                onChange={(event) => toggleMatchKey(choice.key, event.target.checked)}
              />
            ))
          )}
        </CardBody>
      </Card>

      {problems.length > 0 ? (
        <Banner tone="error">
          <ul className="list-inside list-disc space-y-0.5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
    </div>
  );
}

function ColumnRow({
  column,
  target,
  options,
  groups,
  claimed,
  onChange,
}: {
  column: ImportAnalysisColumn;
  target: ImportColumnTarget;
  options: TargetOption[];
  groups: string[];
  claimed: ReadonlySet<string>;
  onChange: (target: ImportColumnTarget) => void;
}) {
  const skipped = target.kind === 'skip';
  const byValue = new Map(options.map((option) => [option.value, option.target]));
  const percent = Math.round(column.fillRate * 100);

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-control border p-3 transition-colors sm:flex-row sm:items-center',
        skipped ? 'border-line bg-surface-sunken/60' : 'border-line-strong bg-surface',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn('truncate text-sm font-semibold', skipped ? 'text-ink-soft' : 'text-ink')}
          >
            {column.name}
          </span>
          <span
            className="shrink-0 text-xs text-ink-soft"
            title={`${percent}% of rows have a value`}
          >
            {percent}% filled
          </span>
        </div>
        <span
          aria-hidden="true"
          className="mt-1 block h-1 w-full overflow-hidden rounded-pill bg-line-soft"
        >
          <span
            className={cn('block h-full rounded-pill', skipped ? 'bg-line-strong' : 'bg-gold-deep')}
            style={{ width: `${percent}%` }}
          />
        </span>
        <p className="mt-1.5 truncate text-xs text-ink-soft">
          {column.samples.length === 0 ? (
            <span className="italic">every row is blank</span>
          ) : (
            column.samples.join('  ·  ')
          )}
        </p>
      </div>

      <span
        aria-hidden="true"
        className={cn(
          'hidden shrink-0 sm:block',
          skipped ? 'text-line-strong' : 'text-gold-foreground',
        )}
      >
        <svg width="28" height="12" viewBox="0 0 28 12" fill="none">
          <path
            d={skipped ? 'M2 6h10' : 'M2 6h20m0 0-4-4m4 4-4 4'}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={skipped ? '3 3' : undefined}
          />
        </svg>
      </span>

      <div className="w-full shrink-0 sm:w-64">
        <Eyebrow as="label" className="mb-1 block" id={`target-${column.index}`}>
          Import as
        </Eyebrow>
        <Select
          aria-labelledby={`target-${column.index}`}
          value={targetValue(target)}
          onChange={(event) => onChange(byValue.get(event.target.value) ?? { kind: 'skip' })}
        >
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {options
                .filter((option) => option.group === group)
                .map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={claimed.has(option.value)}
                  >
                    {option.label}
                    {claimed.has(option.value) ? ' — already used' : ''}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
      </div>
    </div>
  );
}

export function MappingSummary({ mapped, total }: { mapped: number; total: number }) {
  return (
    <Heading level="subsection">
      {mapped} of {total} columns mapped
    </Heading>
  );
}
