import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '../../types/domain';
import { defaultFieldValues, toFieldValues } from './schema';

const FIELDS: FieldDefinition[] = [
  { id: 'f1', key: 'company_name', label: 'Company Name', type: 'text', editMode: 'manual' },
  {
    id: 'f2',
    key: 'monthly_revenue',
    label: 'Monthly Revenue',
    type: 'number',
    editMode: 'manual',
  },
  { id: 'f3', key: 'is_priority', label: 'Priority', type: 'boolean', editMode: 'manual' },
];

describe('defaultFieldValues', () => {
  it('stringifies existing non-boolean values and coerces booleans', () => {
    // `existing` is the server's own fieldValues object — keyed by Field id,
    // never by key. The result is the *form's* namespace, keyed by key.
    const result = defaultFieldValues(FIELDS, {
      f1: 'Acme',
      f2: 5000,
      f3: true,
    });
    expect(result).toEqual({ company_name: 'Acme', monthly_revenue: '5000', is_priority: true });
  });

  it('falls back to empty string / false when no existing value is given', () => {
    const result = defaultFieldValues(FIELDS);
    expect(result).toEqual({ company_name: '', monthly_revenue: '', is_priority: false });
  });
});

describe('toFieldValues', () => {
  it('parses numbers, keeps booleans, and drops empty strings', () => {
    // `formFields` is the form's own namespace, keyed by key. The result goes
    // straight into the API request body, so it must be keyed by Field id.
    const result = toFieldValues(FIELDS, {
      company_name: '',
      monthly_revenue: '12000',
      is_priority: true,
    });
    expect(result).toEqual({ f2: 12000, f3: true });
  });

  it('drops a number field entirely when it fails to parse', () => {
    const result = toFieldValues(FIELDS, {
      company_name: 'Acme',
      monthly_revenue: 'not-a-number',
      is_priority: false,
    });
    expect(result.f2).toBeUndefined();
    expect(result.f1).toBe('Acme');
    expect(result.f3).toBe(false);
  });
});
