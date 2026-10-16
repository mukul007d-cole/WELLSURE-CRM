import { describe, expect, it } from 'vitest';

import {
  coreColumnKinds,
  decodeFilter,
  encodeFilter,
  filterKindForFieldType,
  kindForTarget,
  operatorsForKind,
  valueCountForOperator,
} from './filter-state';
import type { FieldDefinition } from '../../types/domain';

const fields: FieldDefinition[] = [
  {
    id: 'field-text',
    key: 'synthetic_text',
    label: 'Synthetic Text',
    type: 'text',
    editMode: 'manual',
  },
  {
    id: 'field-number',
    key: 'synthetic_number',
    label: 'Synthetic Number',
    type: 'number',
    editMode: 'manual',
  },
];

describe('seller list filter state', () => {
  it('derives operators from the field type, matching the server catalog', () => {
    expect(operatorsForKind('text')).toEqual([
      'equals',
      'contains',
      'starts_with',
      'is_empty',
      'is_not_empty',
    ]);
    expect(operatorsForKind('select')).toEqual(['in', 'not_in']);
    expect(operatorsForKind('boolean')).toEqual(['is_true', 'is_false']);
    expect(coreColumnKinds.createdAt).toBe('date');
  });

  it('offers presence checks on a multi-select, which a single select has no use for', () => {
    expect(filterKindForFieldType('multi_select')).toBe('multi');
    expect(operatorsForKind('multi')).toEqual(['in', 'not_in', 'is_empty', 'is_not_empty']);
    expect(
      kindForTarget({ kind: 'field', fieldId: 'field-multi' }, [
        ...fields,
        {
          id: 'field-multi',
          key: 'synthetic_multi',
          label: 'Synthetic Multi',
          type: 'multi_select',
          options: ['Option A', 'Option B'],
          editMode: 'manual',
        },
      ]),
    ).toBe('multi');
  });

  it('filters a datetime field by calendar day, with the same operators as a date', () => {
    expect(filterKindForFieldType('datetime')).toBe('datetime');
    expect(operatorsForKind('datetime')).toEqual(operatorsForKind('date'));
    expect(valueCountForOperator('before')).toBe(1);
  });

  it('round-trips multi-select and datetime conditions through the URL', () => {
    const conditions = [
      {
        target: { kind: 'field' as const, fieldId: 'field-multi' },
        operator: 'in',
        values: ['Option B'],
      },
      {
        target: { kind: 'field' as const, fieldId: 'field-datetime' },
        operator: 'between',
        values: ['2026-01-01', '2026-01-31'],
      },
      {
        target: { kind: 'field' as const, fieldId: 'field-multi' },
        operator: 'is_not_empty',
        values: [],
      },
    ];
    expect(decodeFilter(encodeFilter(conditions))).toEqual(conditions);
  });

  it('treats an unknown field type as not filterable', () => {
    expect(filterKindForFieldType('currency')).toBeNull();
    expect(kindForTarget({ kind: 'field', fieldId: 'field-text' }, fields)).toBe('text');
    expect(kindForTarget({ kind: 'field', fieldId: 'missing' }, fields)).toBeNull();
  });

  it('knows how many value inputs each operator needs', () => {
    expect(valueCountForOperator('is_empty')).toBe(0);
    expect(valueCountForOperator('between')).toBe(2);
    expect(valueCountForOperator('contains')).toBe(1);
  });

  it('round-trips through the URL', () => {
    const conditions = [
      {
        target: { kind: 'core' as const, column: 'name' as const },
        operator: 'contains',
        values: ['Synthetic'],
      },
    ];
    expect(decodeFilter(encodeFilter(conditions))).toEqual(conditions);
  });

  it('omits conditions that have no value yet, so a half-built row filters nothing', () => {
    expect(
      encodeFilter([
        { target: { kind: 'core', column: 'name' }, operator: 'contains', values: [''] },
      ]),
    ).toBe('');
    expect(
      encodeFilter([
        { target: { kind: 'core', column: 'email' }, operator: 'is_empty', values: [] },
      ]),
    ).toContain('is_empty');
  });

  it('renders unfiltered rather than blank when the URL is malformed', () => {
    expect(decodeFilter('{not json')).toEqual([]);
    expect(decodeFilter(null)).toEqual([]);
  });
});
