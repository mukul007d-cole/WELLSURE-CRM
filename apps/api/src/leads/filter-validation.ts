import { LeadError } from './errors.js';
import {
  arityForOperator,
  coreColumnKinds,
  filterKindForFieldType,
  isCoreColumn,
  isFilterOperator,
  supportsOperator,
  type Filter,
  type FilterCondition,
  type FilterKind,
  type FilterOperator,
} from './filter-model.js';

/** Bounds parse cost and query size; a filter this long is a UI accident. */
export const maxFilterConditions = 20;

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse the wire form into a Filter, checking shape only. Whether a Field
 * exists, what type it has, and whether the caller may see it are all resolved
 * later, against the database and the permission engine — never from anything
 * the client asserts.
 */
export function parseFilter(raw: unknown): Filter {
  if (raw === undefined || raw === null || raw === '') return { conditions: [] };
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new LeadError('validation_error', 'filter must be an object');
  const conditions = (parsed as { conditions?: unknown }).conditions ?? [];
  if (!Array.isArray(conditions))
    throw new LeadError('validation_error', 'filter.conditions must be an array');
  if (conditions.length > maxFilterConditions)
    throw new LeadError('validation_error', 'too many filter conditions', {
      maxFilterConditions,
    });
  return { conditions: conditions.map(parseCondition) };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new LeadError('validation_error', 'filter must be valid JSON');
  }
}

function parseCondition(raw: unknown): FilterCondition {
  if (typeof raw !== 'object' || raw === null)
    throw new LeadError('validation_error', 'filter condition must be an object');
  const row = raw as Record<string, unknown>;
  const operator = typeof row.operator === 'string' ? row.operator : '';
  if (!isFilterOperator(operator))
    throw new LeadError('validation_error', 'unknown filter operator');
  const values = row.values === undefined ? [] : row.values;
  if (!Array.isArray(values))
    throw new LeadError('validation_error', 'filter condition values must be an array');
  return { target: parseTarget(row.target), operator, values };
}

function parseTarget(raw: unknown): FilterCondition['target'] {
  if (typeof raw !== 'object' || raw === null)
    throw new LeadError('validation_error', 'filter target must be an object');
  const row = raw as Record<string, unknown>;
  if (row.kind === 'core') {
    const column = typeof row.column === 'string' ? row.column : '';
    // A fixed allow-list: without it the "core" path would be a way to name an
    // arbitrary column.
    if (!isCoreColumn(column)) throw new LeadError('validation_error', 'unknown core column');
    return { kind: 'core', column };
  }
  if (row.kind === 'field') {
    const fieldId = typeof row.fieldId === 'string' ? row.fieldId.trim() : '';
    if (fieldId === '')
      throw new LeadError('validation_error', 'filter target fieldId is required');
    return { kind: 'field', fieldId };
  }
  throw new LeadError('validation_error', 'filter target kind must be field or core');
}

export interface ResolvedCondition extends FilterCondition {
  kind: FilterKind;
}

/**
 * Bind every condition to the comparison kind it will actually be evaluated
 * with, and reject anything the kind does not support.
 *
 * `fieldTypes` comes from the `fields` table, so the operator catalog follows
 * the admin's configuration rather than the request.
 */
export function resolveFilter(input: {
  filter: Filter;
  fieldTypes: ReadonlyMap<string, string>;
}): ResolvedCondition[] {
  return input.filter.conditions.map((condition) => {
    const kind =
      condition.target.kind === 'core'
        ? coreColumnKinds[condition.target.column]
        : resolveFieldKind(condition.target.fieldId, input.fieldTypes);
    if (!supportsOperator(kind, condition.operator))
      throw new LeadError('validation_error', 'operator is not available for this field type', {
        operator: condition.operator,
      });
    return { ...condition, kind, values: coerceValues(condition.operator, kind, condition.values) };
  });
}

function resolveFieldKind(fieldId: string, fieldTypes: ReadonlyMap<string, string>): FilterKind {
  const fieldType = fieldTypes.get(fieldId);
  // Absent means the Field is not in this organization, is inactive, or does
  // not exist. All three are the same answer to the caller.
  if (fieldType === undefined)
    throw new LeadError('validation_error', 'unknown or inactive filter field');
  const kind = filterKindForFieldType(fieldType);
  if (kind === null)
    throw new LeadError('validation_error', 'field type is not filterable', { fieldType });
  return kind;
}

function coerceValues(
  operator: FilterOperator,
  kind: FilterKind,
  values: readonly unknown[],
): readonly unknown[] {
  const arity = arityForOperator(operator);
  if (arity === 'many') {
    if (values.length === 0)
      throw new LeadError('validation_error', 'operator requires at least one value', { operator });
  } else if (values.length !== arity) {
    throw new LeadError('validation_error', 'wrong number of values for operator', {
      operator,
      expected: arity,
    });
  }
  return values.map((value) => coerceValue(kind, value));
}

function coerceValue(kind: FilterKind, value: unknown): unknown {
  switch (kind) {
    case 'number': {
      const parsed = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(parsed))
        throw new LeadError('validation_error', 'filter value must be a number');
      return parsed;
    }
    case 'date': {
      const text = typeof value === 'string' ? value.trim() : '';
      /*
       * Date Fields store unvalidated strings, so comparison is lexicographic.
       * That is correct for ISO-8601 and silently wrong for anything else, so
       * inputs are pinned to YYYY-MM-DD here. Stored values are left alone —
       * normalising them is a data migration, not a filter change.
       */
      if (!isoDate.test(text))
        throw new LeadError('validation_error', 'filter date must be formatted YYYY-MM-DD');
      return text;
    }
    case 'text':
    case 'select': {
      if (typeof value !== 'string')
        throw new LeadError('validation_error', 'filter value must be a string');
      return value;
    }
    default:
      return value;
  }
}
