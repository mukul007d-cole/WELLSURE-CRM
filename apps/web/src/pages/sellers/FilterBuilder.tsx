import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import type { FieldDefinition, Status } from '../../types/domain';
import {
  coreColumnLabels,
  coreColumns,
  filterKindForFieldType,
  kindForTarget,
  operatorLabels,
  operatorsForKind,
  valueCountForOperator,
  type CoreColumn,
  type FilterCondition,
  type FilterTarget,
} from './filter-state';

/**
 * The Seller List filter builder.
 *
 * Operators follow the chosen target's configured type — picking a different
 * Field re-derives them and drops values that no longer apply, so a condition
 * can never carry an operator its type doesn't support. The server derives the
 * same catalog independently and rejects anything outside it.
 */
export function FilterBuilder({
  conditions,
  onChange,
  fields,
  statuses,
  journeys,
}: {
  conditions: readonly FilterCondition[];
  onChange: (conditions: FilterCondition[]) => void;
  fields: readonly FieldDefinition[];
  statuses: readonly Status[];
  journeys: readonly { id: string; name: string }[];
}) {
  // A Field whose configured type this client has no comparison UI for isn't
  // offered at all, rather than offered and then rejected by the server.
  const filterableFields = fields.filter((field) => filterKindForFieldType(field.type) !== null);

  const update = (index: number, next: FilterCondition) =>
    onChange(conditions.map((condition, position) => (position === index ? next : condition)));

  const addCondition = () =>
    onChange([
      ...conditions,
      { target: { kind: 'core', column: 'name' }, operator: 'contains', values: [''] },
    ]);

  const targetValue = (target: FilterTarget) =>
    target.kind === 'core' ? `core:${target.column}` : `field:${target.fieldId}`;

  const parseTarget = (raw: string): FilterTarget =>
    raw.startsWith('core:')
      ? { kind: 'core', column: raw.slice('core:'.length) as CoreColumn }
      : { kind: 'field', fieldId: raw.slice('field:'.length) };

  return (
    <div className="space-y-2" data-testid="filter-builder">
      {conditions.map((condition, index) => {
        const kind = kindForTarget(condition.target, fields) ?? 'text';
        const operators = operatorsForKind(kind);
        const valueCount = valueCountForOperator(condition.operator);
        const optionsFor = optionValues(condition.target, fields, statuses, journeys);
        return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={`Condition ${index + 1} field`}
              className="w-52"
              value={targetValue(condition.target)}
              onChange={(event) => {
                const target = parseTarget(event.target.value);
                // A new target means a new operator catalog; keeping the old
                // operator would send something the server rejects.
                const nextKind = kindForTarget(target, fields) ?? 'text';
                const operator = operatorsForKind(nextKind)[0] ?? 'equals';
                update(index, {
                  target,
                  operator,
                  values: Array.from({ length: valueCountForOperator(operator) }, () => ''),
                });
              }}
            >
              <optgroup label="Record">
                {coreColumns.map((column) => (
                  <option key={column} value={`core:${column}`}>
                    {coreColumnLabels[column]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Fields">
                {filterableFields.map((field) => (
                  <option key={field.id} value={`field:${field.id}`}>
                    {field.label}
                  </option>
                ))}
              </optgroup>
            </Select>
            <Select
              aria-label={`Condition ${index + 1} operator`}
              className="w-40"
              value={condition.operator}
              onChange={(event) =>
                update(index, {
                  ...condition,
                  operator: event.target.value,
                  values: Array.from(
                    { length: valueCountForOperator(event.target.value) },
                    (_, position) => condition.values[position] ?? '',
                  ),
                })
              }
            >
              {operators.map((operator) => (
                <option key={operator} value={operator}>
                  {operatorLabels[operator] ?? operator}
                </option>
              ))}
            </Select>
            {Array.from({ length: valueCount }, (_, position) =>
              optionsFor === null ? (
                <Input
                  key={position}
                  aria-label={`Condition ${index + 1} value${valueCount > 1 ? ` ${position + 1}` : ''}`}
                  className="w-44"
                  type={kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'}
                  value={inputValue(condition.values[position])}
                  onChange={(event) =>
                    update(index, {
                      ...condition,
                      values: condition.values.map((value, slot) =>
                        slot === position ? event.target.value : value,
                      ),
                    })
                  }
                />
              ) : (
                <Select
                  key={position}
                  aria-label={`Condition ${index + 1} value`}
                  className="w-44"
                  value={inputValue(condition.values[position])}
                  onChange={(event) =>
                    update(index, { ...condition, values: [event.target.value] })
                  }
                >
                  <option value="">Select a value…</option>
                  {optionsFor.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              ),
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove condition ${index + 1}`}
              onClick={() => onChange(conditions.filter((_, position) => position !== index))}
            >
              Remove
            </Button>
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={addCondition}>
          Add condition
        </Button>
        {conditions.length > 1 ? (
          <span className="text-xs text-ink-soft">All conditions must match.</span>
        ) : null}
      </div>
    </div>
  );
}

/** Filter values arrive from the URL as JSON scalars; anything else is blank. */
function inputValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}

/** Null means a free-text input; otherwise the value is chosen from a list. */
function optionValues(
  target: FilterTarget,
  fields: readonly FieldDefinition[],
  statuses: readonly Status[],
  journeys: readonly { id: string; name: string }[],
): Array<{ value: string; label: string }> | null {
  if (target.kind === 'core') {
    if (target.column === 'status')
      return statuses.map((status) => ({ value: status.id, label: status.name }));
    if (target.column === 'journey')
      return journeys.map((journey) => ({ value: journey.id, label: journey.name }));
    return null;
  }
  const field = fields.find((candidate) => candidate.id === target.fieldId);
  // Select Fields carry their choices in validationRule.options — the only
  // source of truth for them.
  return field?.options === undefined
    ? null
    : field.options.map((option) => ({ value: option, label: option }));
}
