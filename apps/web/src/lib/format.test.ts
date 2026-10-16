import { describe, expect, it } from 'vitest';

import type { FieldDefinition } from '../types/domain';
import { formatFieldValue } from './format';

const field = (type: FieldDefinition['type']): FieldDefinition => ({
  id: 'field',
  key: 'field',
  label: 'Field',
  type,
  editMode: 'manual',
});

describe('formatFieldValue (Phase 24 types)', () => {
  it('lists multiple-choice values instead of printing JSON', () => {
    expect(formatFieldValue(field('multi_select'), ['Listing', 'Advertising'])).toBe(
      'Listing, Advertising',
    );
    expect(formatFieldValue(field('multi_select'), [])).toBe('—');
  });

  it('shows a date-time as a local date and time, and a bad value as stored', () => {
    expect(formatFieldValue(field('datetime'), '2026-07-03T10:28:13.000Z')).toMatch(/2026/);
    expect(formatFieldValue(field('datetime'), '2026-07-03T10:28:13.000Z')).not.toContain('T10');
    expect(formatFieldValue(field('datetime'), 'not a date')).toBe('not a date');
  });
});
