import { describe, expect, it } from 'vitest';
import type { RecordPredicate } from '@falcon/permission-engine';

import { LeadError } from '../leads/errors.js';
import {
  coreColumnKinds,
  filterFieldIds,
  filterKindForFieldType,
  operatorsForKind,
} from '../leads/filter-model.js';
import { parseFilter, resolveFilter } from '../leads/filter-validation.js';
import { buildSellerListQuery } from '../leads/filter-sql.js';

const organizationId = '11111111-1111-1111-1111-111111111111';
const journeyId = '22222222-2222-2222-2222-222222222222';
const userId = '33333333-3333-3333-3333-333333333333';
const textField = '66666666-6666-6666-6666-666666666666';
const numberField = '66666666-6666-6666-6666-666666666667';
const selectField = '66666666-6666-6666-6666-666666666668';
const dateField = '66666666-6666-6666-6666-666666666669';
const boolField = '66666666-6666-6666-6666-66666666666a';

const fieldTypes = new Map([
  [textField, 'text'],
  [numberField, 'number'],
  [selectField, 'select'],
  [dateField, 'date'],
  [boolField, 'boolean'],
]);

const predicate = (overrides: Partial<RecordPredicate> = {}): RecordPredicate => ({
  organizationId,
  scope: 'ORGANIZATION',
  allowedUserIds: 'ALL_ORGANIZATION_USERS',
  assignmentTypes: [],
  journeyIds: [journeyId],
  includeDirectGrantsForUserId: userId,
  directGrantAction: 'view',
  ...overrides,
});

const condition = (target: unknown, operator: string, values: unknown[] = []) =>
  resolveFilter({
    filter: parseFilter({ conditions: [{ target, operator, values }] }),
    fieldTypes,
  });

const sqlFor = (conditions: ReturnType<typeof resolveFilter>) =>
  buildSellerListQuery({
    organizationId,
    predicate: predicate(),
    conditions,
    page: 1,
    pageSize: 25,
  });

describe('filter operator catalog', () => {
  it('derives the kind from the configured field type, not the value', () => {
    for (const type of ['text', 'textarea', 'email', 'phone'])
      expect(filterKindForFieldType(type)).toBe('text');
    expect(filterKindForFieldType('number')).toBe('number');
    expect(filterKindForFieldType('date')).toBe('date');
    expect(filterKindForFieldType('select')).toBe('select');
    expect(filterKindForFieldType('boolean')).toBe('boolean');
    expect(filterKindForFieldType('json')).toBe('opaque');
  });

  it('reports an unknown or future field type as not filterable', () => {
    // An admin can create a Field with any type string. Guessing operators from
    // stored values is exactly the business-data coupling AGENTS.md forbids.
    expect(filterKindForFieldType('currency')).toBeNull();
    expect(filterKindForFieldType('linked_account')).toBeNull();
  });

  it('offers each kind exactly its documented operators', () => {
    expect(operatorsForKind('text')).toEqual([
      'equals',
      'contains',
      'starts_with',
      'is_empty',
      'is_not_empty',
    ]);
    expect(operatorsForKind('number')).toEqual([
      'equals',
      'greater_than',
      'less_than',
      'between',
      'is_empty',
    ]);
    expect(operatorsForKind('date')).toEqual(['before', 'after', 'between', 'is_empty']);
    expect(operatorsForKind('select')).toEqual(['in', 'not_in']);
    expect(operatorsForKind('boolean')).toEqual(['is_true', 'is_false']);
  });

  it('gives core columns the same catalog through their equivalent kind', () => {
    expect(coreColumnKinds).toEqual({
      name: 'text',
      phone: 'text',
      email: 'text',
      createdAt: 'date',
      status: 'select',
      journey: 'select',
    });
  });
});

describe('filter validation', () => {
  it('accepts an absent filter as no conditions', () => {
    expect(parseFilter(undefined).conditions).toEqual([]);
    expect(parseFilter('').conditions).toEqual([]);
  });

  it('parses the JSON wire form', () => {
    const filter = parseFilter(
      JSON.stringify({
        conditions: [
          { target: { kind: 'field', fieldId: textField }, operator: 'equals', values: ['x'] },
        ],
      }),
    );
    expect(filterFieldIds(filter)).toEqual([textField]);
  });

  it('rejects malformed payloads', () => {
    expect(() => parseFilter('{not json')).toThrow(LeadError);
    expect(() => parseFilter({ conditions: 'nope' })).toThrow(LeadError);
    expect(() =>
      parseFilter({ conditions: [{ target: { kind: 'field' }, operator: 'equals' }] }),
    ).toThrow(LeadError);
    expect(() =>
      parseFilter({
        conditions: [{ target: { kind: 'field', fieldId: 'f' }, operator: 'invented' }],
      }),
    ).toThrow(LeadError);
  });

  it('rejects a core column outside the allow-list', () => {
    // Without the allow-list, `core` would be a way to name any column.
    expect(() =>
      parseFilter({
        conditions: [
          { target: { kind: 'core', column: 'password_hash' }, operator: 'equals', values: ['x'] },
        ],
      }),
    ).toThrow(LeadError);
  });

  it('caps the number of conditions', () => {
    const conditions = Array.from({ length: 21 }, () => ({
      target: { kind: 'field', fieldId: textField },
      operator: 'equals',
      values: ['x'],
    }));
    expect(() => parseFilter({ conditions })).toThrow(LeadError);
  });

  it('rejects an operator the field type does not support', () => {
    expect(() => condition({ kind: 'field', fieldId: selectField }, 'greater_than', [1])).toThrow(
      LeadError,
    );
    expect(() => condition({ kind: 'field', fieldId: textField }, 'is_true')).toThrow(LeadError);
  });

  it('rejects an unknown or inactive field', () => {
    expect(() =>
      condition({ kind: 'field', fieldId: 'not-a-known-field' }, 'equals', ['x']),
    ).toThrow(LeadError);
  });

  it('enforces operator arity', () => {
    expect(() => condition({ kind: 'field', fieldId: numberField }, 'between', [1])).toThrow(
      LeadError,
    );
    expect(() => condition({ kind: 'field', fieldId: selectField }, 'in', [])).toThrow(LeadError);
    expect(() => condition({ kind: 'field', fieldId: textField }, 'is_empty', ['x'])).toThrow(
      LeadError,
    );
  });

  it('coerces numbers and pins dates to ISO-8601', () => {
    expect(condition({ kind: 'field', fieldId: numberField }, 'equals', ['42'])[0]?.values).toEqual(
      [42],
    );
    expect(() => condition({ kind: 'field', fieldId: numberField }, 'equals', ['abc'])).toThrow(
      LeadError,
    );
    // Stored dates are unvalidated strings compared lexicographically, so a
    // non-ISO input would compare wrongly rather than fail loudly.
    expect(() =>
      condition({ kind: 'field', fieldId: dateField }, 'before', ['01/02/2026']),
    ).toThrow(LeadError);
    expect(
      condition({ kind: 'field', fieldId: dateField }, 'before', ['2026-01-02'])[0]?.values,
    ).toEqual(['2026-01-02']);
  });
});

describe('filter SQL compilation', () => {
  it('uses column-level containment for equality, which is what reaches the GIN index', () => {
    const { ids } = sqlFor(condition({ kind: 'field', fieldId: textField }, 'equals', ['blue']));
    expect(ids.text).toContain('l.field_values @> ');
    expect(ids.text).not.toContain('#>');
    expect(ids.values).toContain(JSON.stringify({ [textField]: 'blue' }));
  });

  it('expands IN into OR-ed containments so each arm can use the index', () => {
    const { ids } = sqlFor(
      condition({ kind: 'field', fieldId: selectField }, 'in', ['alpha', 'beta']),
    );
    expect(ids.text.match(/@>/g)).toHaveLength(2);
    expect(ids.values).toContain(JSON.stringify({ [selectField]: 'alpha' }));
    expect(ids.values).toContain(JSON.stringify({ [selectField]: 'beta' }));
  });

  it('uses the ? operator for presence, not jsonb_exists', () => {
    // Measured: the function form is not matched to the GIN index; the
    // operator form is.
    const { ids } = sqlFor(condition({ kind: 'field', fieldId: textField }, 'is_not_empty'));
    expect(ids.text).toContain('l.field_values ? ');
    expect(ids.text).not.toContain('jsonb_exists');
  });

  it('binds booleans as JSON booleans rather than strings', () => {
    const { ids } = sqlFor(condition({ kind: 'field', fieldId: boolField }, 'is_true'));
    expect(ids.values).toContain(JSON.stringify({ [boolField]: true }));
  });

  it('guards the numeric cast so non-numeric values cannot abort the query', () => {
    const { ids } = sqlFor(condition({ kind: 'field', fieldId: numberField }, 'greater_than', [5]));
    expect(ids.text).toContain('::numeric');
    expect(ids.text).toContain('CASE WHEN');
  });

  it('never interpolates a value or a field id into SQL text', () => {
    const { ids, count } = sqlFor([
      ...condition({ kind: 'field', fieldId: textField }, 'contains', ["100%' OR 1=1 --"]),
      ...condition({ kind: 'core', column: 'name' }, 'starts_with', ['Synthetic']),
    ]);
    for (const fragment of [ids, count]) {
      expect(fragment.text).not.toContain('OR 1=1');
      expect(fragment.text).not.toContain(textField);
      expect(fragment.text).not.toContain('Synthetic');
    }
    // LIKE metacharacters in user input are data, not syntax.
    expect(ids.values).toContain("%100\\%' OR 1=1 --%");
  });

  it('builds the page and the count from the same predicate', () => {
    const conditions = condition({ kind: 'field', fieldId: textField }, 'equals', ['blue']);
    const { ids, count } = sqlFor(conditions);
    const clauseOf = (text: string) => text.slice(text.indexOf('WHERE'), text.indexOf('ORDER BY'));
    expect(clauseOf(ids.text).trim()).toBe(count.text.slice(count.text.indexOf('WHERE')).trim());
  });

  it('sorts with a tiebreak so pagination cannot repeat or skip rows', () => {
    const { ids } = sqlFor([]);
    expect(ids.text).toContain('ORDER BY l.updated_at DESC, l.id ASC');
  });

  it('keeps scope in the same clause as the filter', () => {
    const { ids } = sqlFor(condition({ kind: 'field', fieldId: textField }, 'equals', ['blue']));
    // Filters are ANDed alongside the scope EXISTS, never in place of it.
    expect(ids.text).toContain('EXISTS (SELECT 1 FROM process_instances p');
    expect(ids.text).toContain('l.organization_id = $1::uuid');
  });

  it('applies no assignment-type filter when the caller named no types', () => {
    const { ids } = buildSellerListQuery({
      organizationId,
      predicate: predicate({ assignmentTypes: [] }),
      conditions: [],
      page: 1,
      pageSize: 25,
    });
    expect(ids.text).not.toContain('a.assignment_type');
  });

  it('still restricts by user when the scope is narrower than the organization', () => {
    const { ids } = buildSellerListQuery({
      organizationId,
      predicate: predicate({ scope: 'SELF', allowedUserIds: [userId] }),
      conditions: [],
      page: 1,
      pageSize: 25,
    });
    expect(ids.text).toContain('a.user_id = ANY(');
    expect(ids.values).toContainEqual([userId]);
  });
});
