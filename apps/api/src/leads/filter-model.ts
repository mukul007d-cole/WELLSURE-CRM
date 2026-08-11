/**
 * The Seller List filter model.
 *
 * An ordered list of conditions, combined with AND only. OR and grouping are
 * deliberately absent rather than stubbed: there is no `logic` discriminator
 * and no nesting, so adding them later is an explicit model change with its own
 * plan, not a half-built feature that quietly misbehaves.
 *
 * Operators come from each Field's configured `field_type`, never from the
 * shape of the value being filtered. That is what keeps the engine
 * configurable: retyping a Field in the admin UI changes its operators with no
 * code change, and no filter can depend on a Field being named anything in
 * particular.
 */

/** Relational columns that are filterable alongside custom Fields. */
export const coreColumns = ['name', 'phone', 'email', 'createdAt', 'status', 'journey'] as const;
export type CoreColumn = (typeof coreColumns)[number];

export type FilterTarget =
  { kind: 'field'; fieldId: string } | { kind: 'core'; column: CoreColumn };

export const filterOperators = [
  'equals',
  'contains',
  'starts_with',
  'is_empty',
  'is_not_empty',
  'greater_than',
  'less_than',
  'between',
  'before',
  'after',
  'in',
  'not_in',
  'is_true',
  'is_false',
] as const;
export type FilterOperator = (typeof filterOperators)[number];

export interface FilterCondition {
  target: FilterTarget;
  operator: FilterOperator;
  values: readonly unknown[];
}
export interface Filter {
  conditions: readonly FilterCondition[];
}

/**
 * The comparison behaviour a target supports. Several `field_type` values share
 * one kind — `text`, `textarea`, `email` and `phone` all compare as text — so
 * the catalog is keyed by kind rather than by type.
 */
export type FilterKind = 'text' | 'number' | 'date' | 'select' | 'boolean' | 'opaque';

const operatorsByKind: Record<FilterKind, readonly FilterOperator[]> = {
  text: ['equals', 'contains', 'starts_with', 'is_empty', 'is_not_empty'],
  number: ['equals', 'greater_than', 'less_than', 'between', 'is_empty'],
  date: ['before', 'after', 'between', 'is_empty'],
  select: ['in', 'not_in'],
  boolean: ['is_true', 'is_false'],
  // `json` values have no ordering or equality the engine can rely on, so only
  // presence is offered.
  opaque: ['is_empty', 'is_not_empty'],
};

/**
 * Null for a `field_type` this engine has no comparison semantics for — an
 * admin-invented type, or one added later. Such a Field is reported as not
 * filterable rather than guessed at from its stored values.
 */
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

/** Core columns carry the same catalog through their equivalent kind. */
export const coreColumnKinds: Record<CoreColumn, FilterKind> = {
  name: 'text',
  phone: 'text',
  email: 'text',
  createdAt: 'date',
  // Status and Journey filter by id, which behaves exactly like a select.
  status: 'select',
  journey: 'select',
};

export function operatorsForKind(kind: FilterKind): readonly FilterOperator[] {
  return operatorsByKind[kind];
}

export function supportsOperator(kind: FilterKind, operator: FilterOperator): boolean {
  return operatorsByKind[kind].includes(operator);
}

/** How many values an operator takes: a fixed count, or any number ≥ 1. */
export function arityForOperator(operator: FilterOperator): 0 | 1 | 2 | 'many' {
  switch (operator) {
    case 'is_empty':
    case 'is_not_empty':
    case 'is_true':
    case 'is_false':
      return 0;
    case 'between':
      return 2;
    case 'in':
    case 'not_in':
      return 'many';
    default:
      return 1;
  }
}

export function isCoreColumn(value: string): value is CoreColumn {
  return (coreColumns as readonly string[]).includes(value);
}

export function isFilterOperator(value: string): value is FilterOperator {
  return (filterOperators as readonly string[]).includes(value);
}

/** The custom-Field ids a filter names, for the permission re-check. */
export function filterFieldIds(filter: Filter): string[] {
  return [
    ...new Set(
      filter.conditions
        .filter((condition) => condition.target.kind === 'field')
        .map((condition) => (condition.target as { fieldId: string }).fieldId),
    ),
  ];
}
