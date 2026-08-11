import type { FieldDefinition } from '../../types/domain';

/**
 * Client-side mirror of the server's filter model.
 *
 * The operator lists here decide what the picker *offers*; the server derives
 * the same catalog from each Field's configured type and re-validates every
 * condition, so a hand-written URL can't widen anything this file allows.
 */

export type FilterKind = 'text' | 'number' | 'date' | 'select' | 'boolean' | 'opaque';

export type FilterTarget =
  { kind: 'field'; fieldId: string } | { kind: 'core'; column: CoreColumn };

export const coreColumns = ['name', 'phone', 'email', 'createdAt', 'status', 'journey'] as const;
export type CoreColumn = (typeof coreColumns)[number];

export interface FilterCondition {
  target: FilterTarget;
  operator: string;
  values: unknown[];
}

const operatorsByKind: Record<FilterKind, readonly string[]> = {
  text: ['equals', 'contains', 'starts_with', 'is_empty', 'is_not_empty'],
  number: ['equals', 'greater_than', 'less_than', 'between', 'is_empty'],
  date: ['before', 'after', 'between', 'is_empty'],
  select: ['in', 'not_in'],
  boolean: ['is_true', 'is_false'],
  opaque: ['is_empty', 'is_not_empty'],
};

export const operatorLabels: Record<string, string> = {
  equals: 'is',
  contains: 'contains',
  starts_with: 'starts with',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  greater_than: 'greater than',
  less_than: 'less than',
  between: 'between',
  before: 'before',
  after: 'after',
  in: 'is any of',
  not_in: 'is none of',
  is_true: 'is true',
  is_false: 'is false',
};

export const coreColumnLabels: Record<CoreColumn, string> = {
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  createdAt: 'Created',
  status: 'Status',
  journey: 'Journey',
};

export const coreColumnKinds: Record<CoreColumn, FilterKind> = {
  name: 'text',
  phone: 'text',
  email: 'text',
  createdAt: 'date',
  status: 'select',
  journey: 'select',
};

/** Null for a type this client has no comparison UI for. */
export function filterKindForFieldType(fieldType: string): FilterKind | null {
  switch (fieldType) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'phone':
      return 'text';
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'select':
      return 'select';
    case 'boolean':
      return 'boolean';
    case 'json':
      return 'opaque';
    default:
      return null;
  }
}

export function operatorsForKind(kind: FilterKind): readonly string[] {
  return operatorsByKind[kind];
}

/** How many value inputs an operator needs. */
export function valueCountForOperator(operator: string): 0 | 1 | 2 {
  if (['is_empty', 'is_not_empty', 'is_true', 'is_false'].includes(operator)) return 0;
  if (operator === 'between') return 2;
  return 1;
}

export function kindForTarget(
  target: FilterTarget,
  fields: readonly FieldDefinition[],
): FilterKind | null {
  if (target.kind === 'core') return coreColumnKinds[target.column];
  const field = fields.find((candidate) => candidate.id === target.fieldId);
  return field === undefined ? null : filterKindForFieldType(field.type);
}

/** Serialize for the URL, omitting conditions that aren't answerable yet. */
export function encodeFilter(conditions: readonly FilterCondition[]): string {
  const ready = conditions.filter(
    (condition) =>
      condition.values.length === valueCountForOperator(condition.operator) &&
      condition.values.every((value) => value !== '' && value !== undefined),
  );
  return ready.length === 0 ? '' : JSON.stringify({ conditions: ready });
}

export function decodeFilter(raw: string | null): FilterCondition[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { conditions?: FilterCondition[] };
    return Array.isArray(parsed.conditions) ? parsed.conditions : [];
  } catch {
    // A malformed URL shouldn't blank the page; the list just renders unfiltered.
    return [];
  }
}

export function describeTarget(target: FilterTarget, fields: readonly FieldDefinition[]): string {
  if (target.kind === 'core') return coreColumnLabels[target.column];
  return fields.find((field) => field.id === target.fieldId)?.label ?? 'Unknown field';
}
