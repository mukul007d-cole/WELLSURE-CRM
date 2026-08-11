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
  { id: 'field-text', key: 'synthetic_text', label: 'Synthetic Text', type: 'text' },
  { id: 'field-number', key: 'synthetic_number', label: 'Synthetic Number', type: 'number' },
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
